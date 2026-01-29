import * as vscode from 'vscode';
import { StruggleContext, CombinedStruggleScore } from './types';
import { DiagnosticPersistenceService } from './diagnosticPersistenceService';
import { InactivityService } from './inactivityService';
import { ThrashingDetector } from './thrashingDetector';
import { BuildResultTracker } from './buildResultTracker';
import { StruggleScoreService } from './struggleScoreService';
import { InterventionService } from './interventionService';
import { InterventionFilter } from './interventionFilter';
import { ArtemisWebsocketService } from '../artemisWebsocketService';
import { VSCODE_CONFIG } from '../../utils/constants';

/**
 * Central orchestration service for all telemetry and struggle detection.
 * Initializes all sub-services and manages their lifecycle.
 */
export class TelemetryManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _diagnosticService: DiagnosticPersistenceService;
    private readonly _inactivityService: InactivityService;
    private readonly _thrashingDetector: ThrashingDetector;
    private readonly _buildTracker: BuildResultTracker;
    private readonly _scoreService: StruggleScoreService;
    private readonly _interventionService: InterventionService;
    private readonly _interventionFilter: InterventionFilter;
    
    private _websocketService: ArtemisWebsocketService | undefined;
    private _scoreCheckTimer: NodeJS.Timeout | undefined;
    private _isEnabled: boolean = true;

    /** Debug mode: shows live score in status bar */
    private _debugMode: boolean = false;
    private _debugStatusBarItem: vscode.StatusBarItem;
    private readonly _outputChannel: vscode.OutputChannel;

    /** Interval for periodic score checks (30 seconds) */
    private static readonly SCORE_CHECK_INTERVAL_MS = 30 * 1000;
    /** Interval for debug updates (5 seconds) */
    private static readonly DEBUG_UPDATE_INTERVAL_MS = 5 * 1000;
    private _debugUpdateTimer: NodeJS.Timeout | undefined;

    private readonly _onDidCalculateScore = new vscode.EventEmitter<CombinedStruggleScore>();
    public readonly onDidCalculateScore = this._onDidCalculateScore.event;

    constructor() {
        // Initialize output channel for debugging
        this._outputChannel = vscode.window.createOutputChannel('Artemis Telemetry');
        this._disposables.push(this._outputChannel);

        // Initialize debug status bar (hidden by default)
        this._debugStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            1000 // High priority to show on left
        );
        this._debugStatusBarItem.command = 'artemis.showStruggleScore';
        this._disposables.push(this._debugStatusBarItem);

        // Initialize all services
        this._diagnosticService = new DiagnosticPersistenceService();
        this._inactivityService = new InactivityService();
        this._thrashingDetector = new ThrashingDetector();
        this._buildTracker = new BuildResultTracker();
        
        this._scoreService = new StruggleScoreService(
            this._diagnosticService,
            this._inactivityService,
            this._thrashingDetector,
            this._buildTracker
        );
        
        this._interventionService = new InterventionService();
        this._interventionFilter = new InterventionFilter();

        // Register disposables
        this._disposables.push(this._diagnosticService);
        this._disposables.push(this._inactivityService);
        this._disposables.push(this._thrashingDetector);
        this._disposables.push(this._buildTracker);
        this._disposables.push(this._scoreService);
        this._disposables.push(this._interventionService);

        // Wire up event handlers
        this._setupEventHandlers();

        // Load configuration
        this._loadConfiguration();

        // Start periodic score checking
        this._startScoreChecking();

        // Listen for configuration changes
        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION) ||
                event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DEVELOPER_MODE_KEY}`)) {
                this._loadConfiguration();
            }
        });
        this._disposables.push(configListener);

        // Log initial state
        this._log('TelemetryManager initialized');
        this._logCurrentState();
    }

    public dispose(): void {
        if (this._scoreCheckTimer) {
            clearInterval(this._scoreCheckTimer);
            this._scoreCheckTimer = undefined;
        }

        if (this._debugUpdateTimer) {
            clearInterval(this._debugUpdateTimer);
            this._debugUpdateTimer = undefined;
        }

        this._debugStatusBarItem.hide();

        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }

        this._onDidCalculateScore.dispose();
        this._log('TelemetryManager disposed');
    }

    /**
     * Set the WebSocket service for receiving build results
     */
    public setWebsocketService(websocketService: ArtemisWebsocketService): void {
        this._websocketService = websocketService;
        
        // Register build tracker as a message handler
        websocketService.registerMessageHandler(this._buildTracker);
        
        console.log('[TelemetryManager] WebSocket service connected');
    }

    /**
     * Mark the start of an exercise session
     */
    public startExerciseSession(): void {
        this._interventionFilter.setExerciseStartTime();
        this._inactivityService.reset();
        this._thrashingDetector.reset();
        console.log('[TelemetryManager] Exercise session started');
    }

    /**
     * Record that the student made progress
     */
    public recordProgress(): void {
        this._interventionFilter.recordProgress();
    }

    /**
     * Setup event handlers between services
     */
    private _setupEventHandlers(): void {
        // When inactivity pattern changes to concerning levels, check score
        this._inactivityService.onDidChangePattern(pattern => {
            if (pattern === 'confusion' || pattern === 'giving-up') {
                this._checkScoreAndIntervene();
            }
        });

        // When thrashing is detected, check score
        this._thrashingDetector.onDidDetectThrashing(score => {
            if (score > 60) {
                this._checkScoreAndIntervene();
            }
        });

        // When build results arrive, check if it's a failure
        this._buildTracker.onDidReceiveBuildResult(result => {
            if (!result.success) {
                // Delay check to allow for quick retries
                setTimeout(() => this._checkScoreAndIntervene(), 5000);
            } else {
                // Build succeeded - record as progress
                this.recordProgress();
                this._interventionService.hideHint();
            }
        });

        // When diagnostics are fixed, record as progress
        this._diagnosticService.onDidUpdateDiagnostics(diagnostics => {
            const activeErrors = diagnostics.filter(d => !d.resolved);
            if (activeErrors.length === 0) {
                this.recordProgress();
            }
        });
    }

    /**
     * Load configuration from settings
     */
    private _loadConfiguration(): void {
        const struggleConfig = vscode.workspace.getConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION);
        this._isEnabled = struggleConfig.get<boolean>(VSCODE_CONFIG.STRUGGLE_DETECTION.ENABLED_KEY, true);

        // Developer mode shows live score in status bar (only works when struggle detection is enabled)
        const wasDebugMode = this._debugMode;
        const artemisConfig = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const developerMode = artemisConfig.get<boolean>(VSCODE_CONFIG.DEVELOPER_MODE_KEY, false);
        this._debugMode = this._isEnabled && developerMode;

        if (!this._isEnabled) {
            this._interventionService.hideHint();
            this._debugStatusBarItem.hide();
            this._log('Struggle detection disabled');
        } else {
            this._log('Struggle detection enabled');
        }

        // Handle debug mode changes
        if (this._debugMode && !wasDebugMode) {
            this._startDebugUpdates();
            this._log('Developer mode ENABLED - showing live score in status bar');
        } else if (!this._debugMode && wasDebugMode) {
            this._stopDebugUpdates();
            this._log('Developer mode DISABLED');
        }
    }

    /**
     * Start periodic score checking
     */
    private _startScoreChecking(): void {
        this._scoreCheckTimer = setInterval(() => {
            if (this._isEnabled) {
                this._checkScoreAndIntervene();
            }
        }, TelemetryManager.SCORE_CHECK_INTERVAL_MS);
    }

    /**
     * Check current score and trigger intervention if needed
     */
    private _checkScoreAndIntervene(): void {
        if (!this._isEnabled) {
            return;
        }

        const score = this._scoreService.calculateScore();
        this._onDidCalculateScore.fire(score);

        // Check if we should intervene
        const state = this._interventionService.getState();
        if (!this._interventionFilter.shouldIntervene(score, state)) {
            // Still show subtle hint if score warrants it
            if (score.recommendedAction === 'subtle') {
                this._interventionService.showSubtleHint(score);
            }
            return;
        }

        // Execute intervention based on recommended action
        switch (score.recommendedAction) {
            case 'subtle':
                this._interventionService.showSubtleHint(score);
                break;
            case 'notification':
                void this._interventionService.showNotification(score);
                break;
            case 'proactive':
                void this._interventionService.showProactiveHelp(score);
                break;
        }
    }

    /**
     * Get current struggle context for Iris chat integration
     */
    public getStruggleContext(): StruggleContext {
        const score = this._scoreService.calculateScore();

        return {
            isStruggling: score.combined >= 35,
            score: score.combined,
            persistentErrors: score.local.persistentErrors.slice(0, 5), // Limit to 5
            buildFailures: score.server.consecutiveBuildFailures,
            activityPattern: score.local.inactivityPattern,
            recommendedAction: score.recommendedAction,
        };
    }

    /**
     * Get current combined struggle score
     */
    public getCurrentScore(): CombinedStruggleScore {
        return this._scoreService.calculateScore();
    }

    /**
     * Check if telemetry is enabled
     */
    public isEnabled(): boolean {
        return this._isEnabled;
    }

    /**
     * Enable or disable telemetry
     */
    public setEnabled(enabled: boolean): void {
        this._isEnabled = enabled;
        if (!enabled) {
            this._interventionService.hideHint();
        }
    }

    // ==================== DEBUG FEATURES ====================

    /**
     * Start debug mode with live updates
     */
    private _startDebugUpdates(): void {
        this._updateDebugStatusBar();
        this._debugStatusBarItem.show();
        
        this._debugUpdateTimer = setInterval(() => {
            this._updateDebugStatusBar();
        }, TelemetryManager.DEBUG_UPDATE_INTERVAL_MS);
    }

    /**
     * Stop debug updates
     */
    private _stopDebugUpdates(): void {
        if (this._debugUpdateTimer) {
            clearInterval(this._debugUpdateTimer);
            this._debugUpdateTimer = undefined;
        }
        this._debugStatusBarItem.hide();
    }

    /**
     * Update debug status bar with current score
     */
    private _updateDebugStatusBar(): void {
        if (!this._debugMode) {
            return;
        }

        const score = this._scoreService.calculateScore();
        const emoji = this._getScoreEmoji(score.combined);
        const actionIcon = this._getActionIcon(score.recommendedAction);
        
        this._debugStatusBarItem.text = `${emoji} Score: ${score.combined} ${actionIcon}`;
        this._debugStatusBarItem.tooltip = this._buildDebugTooltip(score);
        this._debugStatusBarItem.backgroundColor = this._getScoreBackground(score.combined);
    }

    /**
     * Get emoji based on score
     */
    private _getScoreEmoji(score: number): string {
        if (score < 20) {
            return '$(pass-filled)';
        }
        if (score < 35) {
            return '$(circle-filled)';
        }
        if (score < 55) {
            return '$(warning)';
        }
        if (score < 75) {
            return '$(flame)';
        }
        return '$(alert)';
    }

    /**
     * Get action icon
     */
    private _getActionIcon(action: string): string {
        switch (action) {
            case 'subtle': return '$(lightbulb)';
            case 'notification': return '$(bell)';
            case 'proactive': return '$(megaphone)';
            default: return '';
        }
    }

    /**
     * Get background color based on score
     */
    private _getScoreBackground(score: number): vscode.ThemeColor | undefined {
        if (score < 35) {
            return undefined;
        }
        if (score < 55) {
            return new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        return new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    /**
     * Build detailed tooltip for debug status bar
     */
    private _buildDebugTooltip(score: CombinedStruggleScore): string {
        const lines: string[] = [
            '🔬 Artemis Telemetry Debug',
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '',
            `📊 Combined Score: ${score.combined}/100`,
            `📍 Recommended Action: ${score.recommendedAction}`,
            `🎯 Confidence: ${Math.round(score.confidence * 100)}%`,
            '',
            '── Local Metrics ──',
            `   Errors: ${score.local.persistentErrors.length} persistent`,
            `   Activity: ${score.local.inactivityPattern}`,
            `   Thrashing: ${score.local.thrashingScore}/100`,
            `   Time since edit: ${Math.round(score.local.timeSinceLastEdit / 1000)}s`,
            '',
            '── Server Metrics ──',
            `   Build Failures: ${score.server.consecutiveBuildFailures}`,
            `   Failed Tests: ${score.server.failingTestCases.length}`,
            '',
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '$(info) Click for detailed view',
        ];
        return lines.join('\n');
    }

    /**
     * Log to output channel
     */
    private _log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this._outputChannel.appendLine(`[${timestamp}] ${message}`);
        console.log(`[TelemetryManager] ${message}`);
    }

    /**
     * Log current state to output channel
     */
    private _logCurrentState(): void {
        const score = this._scoreService.calculateScore();
        const diagnostics = this._diagnosticService.getAllTrackedDiagnostics();
        const pattern = this._inactivityService.getCurrentPattern();
        const thrashing = this._thrashingDetector.getThrashingScore();

        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('═══════════════════════════════════════');
        this._outputChannel.appendLine('       TELEMETRY STATE SNAPSHOT');
        this._outputChannel.appendLine('═══════════════════════════════════════');
        this._outputChannel.appendLine(`Time: ${new Date().toLocaleString()}`);
        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('📊 SCORES');
        this._outputChannel.appendLine(`   Combined: ${score.combined}/100`);
        this._outputChannel.appendLine(`   Action: ${score.recommendedAction}`);
        this._outputChannel.appendLine(`   Confidence: ${Math.round(score.confidence * 100)}%`);
        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('🔴 DIAGNOSTICS');
        this._outputChannel.appendLine(`   Total tracked: ${diagnostics.length}`);
        this._outputChannel.appendLine(`   Persistent errors: ${score.local.persistentErrors.length}`);
        
        if (score.local.persistentErrors.length > 0) {
            this._outputChannel.appendLine('   Top errors:');
            score.local.persistentErrors.slice(0, 3).forEach((err, i) => {
                this._outputChannel.appendLine(`     ${i + 1}. ${err.substring(0, 50)}...`);
            });
        }
        
        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('⏱️ ACTIVITY');
        this._outputChannel.appendLine(`   Pattern: ${pattern}`);
        this._outputChannel.appendLine(`   Time since edit: ${Math.round(score.local.timeSinceLastEdit / 1000)}s`);
        this._outputChannel.appendLine(`   Thrashing score: ${thrashing}/100`);
        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('🏗️ SERVER');
        this._outputChannel.appendLine(`   Consecutive build failures: ${score.server.consecutiveBuildFailures}`);
        this._outputChannel.appendLine(`   Failing tests: ${score.server.failingTestCases.length}`);
        this._outputChannel.appendLine('═══════════════════════════════════════');
        this._outputChannel.appendLine('');
    }

    /**
     * Show detailed struggle score dialog (called from command)
     */
    public async showStruggleScoreDialog(): Promise<void> {
        const score = this._scoreService.calculateScore();
        
        // Log to output channel
        this._logCurrentState();
        this._outputChannel.show(true); // Show but preserve focus

        // Build quick pick items
        const items: vscode.QuickPickItem[] = [
            {
                label: `$(graph) Combined Score: ${score.combined}/100`,
                description: `Action: ${score.recommendedAction}`,
                detail: `Confidence: ${Math.round(score.confidence * 100)}%`
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: `$(error) Persistent Errors: ${score.local.persistentErrors.length}`,
                description: 'Errors that haven\'t been fixed',
                detail: score.local.persistentErrors.slice(0, 2).map(e => e.substring(0, 40)).join(', ') || 'None'
            },
            {
                label: `$(watch) Activity: ${score.local.inactivityPattern}`,
                description: `Time since edit: ${Math.round(score.local.timeSinceLastEdit / 1000)}s`,
                detail: 'active < 30s, thinking 30s-2min, confusion 2-5min, giving-up > 5min'
            },
            {
                label: `$(refresh) Thrashing Score: ${score.local.thrashingScore}`,
                description: 'Detecting undo/redo cycles'
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: `$(cloud) Build Failures: ${score.server.consecutiveBuildFailures}`,
                description: 'Consecutive server build failures'
            },
            {
                label: `$(beaker) Failing Tests: ${score.server.failingTestCases.length}`,
                description: score.server.failingTestCases.slice(0, 3).join(', ') || 'None'
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: '$(output) Show Output Channel',
                description: 'View detailed telemetry logs'
            },
            {
                label: '$(refresh) Refresh',
                description: 'Recalculate score'
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            title: '🔬 Artemis Telemetry - Struggle Score',
            placeHolder: 'Current struggle detection metrics',
        });

        if (selection?.label === '$(output) Show Output Channel') {
            this._outputChannel.show();
        } else if (selection?.label === '$(refresh) Refresh') {
            await this.showStruggleScoreDialog();
        }
    }

    /**
     * Get the output channel for external use
     */
    public getOutputChannel(): vscode.OutputChannel {
        return this._outputChannel;
    }

    /**
     * Check if debug mode is enabled
     */
    public isDebugMode(): boolean {
        return this._debugMode;
    }

    /**
     * Force a debug update (useful for testing)
     */
    public forceDebugUpdate(): void {
        this._logCurrentState();
        if (this._debugMode) {
            this._updateDebugStatusBar();
        }
    }
}
