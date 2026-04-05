import * as vscode from 'vscode';
import {
    StruggleContext,
    InterventionDecision,
    TriggerType,
    EQConfidence,
    EQState,
    RecommendedAction,
} from './types';
import type { SessionResettable, SessionStartContext } from './types';
import { DiagnosticPersistenceService } from './diagnosticPersistenceService';
import { InactivityService } from './inactivityService';
import { ThrashingDetector } from './thrashingDetector';
import { BuildResultTracker } from './buildResultTracker';
import { InterventionService } from './interventionService';
import { InterventionFilter } from './interventionFilter';
import { ErrorQuotientEngine } from './metrics/errorQuotientEngine';
import { CompileEquivalentEmitter, classifyBuildResult } from './eventPipeline/compileEquivalentEmitter';
import { BoundaryTriggerEmitter } from './eventPipeline/boundaryTriggerEmitter';
import { InterventionDecisionEngine } from './decision/interventionDecisionEngine';
import { AdaptiveCadence } from './intervention/adaptiveCadence';
import { ArtemisWebsocketService } from '../websocket/artemisWebsocketService';
import { ResultDTO, WebSocketMessageHandler } from '../../types';
import { VSCODE_CONFIG } from '../../utils/constants';
import { logger, LogCategory } from '../loggingService';
import type { ExerciseRegistry } from '../exerciseRegistry';

/**
 * Central orchestration service for EQ-based struggle detection.
 *
 * Replaces the old weighted-score system with:
 *   1. Error Quotient (EQ) — Jadud 2006 pair-scoring formula
 *   2. Subtask-Boundary Triggers — Pu et al. 2025
 *   3. Adaptive Cadence — escalating thresholds on ignore
 */
export class TelemetryManager implements vscode.Disposable, WebSocketMessageHandler {
    private readonly _disposables: vscode.Disposable[] = [];

    // Sub-services (kept from old system)
    private readonly _diagnosticService: DiagnosticPersistenceService;
    private readonly _inactivityService: InactivityService;
    private readonly _thrashingDetector: ThrashingDetector;
    private readonly _buildTracker: BuildResultTracker;
    private readonly _interventionService: InterventionService;
    private readonly _interventionFilter: InterventionFilter;

    // New EQ system
    private readonly _eqEngine: ErrorQuotientEngine;
    private readonly _compileEmitter: CompileEquivalentEmitter;
    private readonly _triggerEmitter: BoundaryTriggerEmitter;
    private readonly _decisionEngine: InterventionDecisionEngine;
    private readonly _adaptiveCadence: AdaptiveCadence;

    // State
    private _websocketService: ArtemisWebsocketService | undefined;
    private _isEnabled: boolean = true;
    private readonly _sessionServices: SessionResettable[];
    private _activeExerciseId: number | undefined;
    private _lastTriggerType: TriggerType | undefined;
    private readonly _exerciseRegistry: ExerciseRegistry | undefined;
    // Debug mode
    private _debugMode: boolean = false;
    private _debugStatusBarItem: vscode.StatusBarItem;
    private _debugUpdateTimer: NodeJS.Timeout | undefined;
    private readonly _outputChannel: vscode.OutputChannel;
    private static readonly DEBUG_UPDATE_INTERVAL_MS = 5 * 1000;

    // Events
    private readonly _onDidCalculateEQ = new vscode.EventEmitter<{
        eq: number;
        confidence: EQConfidence;
        source: 'save' | 'build' | 'trigger';
        triggerType?: TriggerType;
    }>();
    public readonly onDidCalculateEQ = this._onDidCalculateEQ.event;

    public get onDidShowIntervention() {
        return this._interventionService.onDidShowIntervention;
    }

    public get onDidAcceptIntervention() {
        return this._interventionService.onDidAcceptIntervention;
    }

    public get onDidDismissIntervention() {
        return this._interventionService.onDidDismissIntervention;
    }

    constructor(exerciseRegistry?: ExerciseRegistry) {
        this._exerciseRegistry = exerciseRegistry;
        this._outputChannel = vscode.window.createOutputChannel('Artemis Telemetry');
        this._disposables.push(this._outputChannel);

        this._debugStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            1000
        );
        this._debugStatusBarItem.command = 'artemis.showStruggleScore';
        this._disposables.push(this._debugStatusBarItem);

        // Initialize kept services
        this._diagnosticService = new DiagnosticPersistenceService();
        this._inactivityService = new InactivityService();
        this._thrashingDetector = new ThrashingDetector();
        this._buildTracker = new BuildResultTracker();
        this._interventionService = new InterventionService();
        this._interventionFilter = new InterventionFilter();

        // Initialize EQ system
        this._eqEngine = new ErrorQuotientEngine();
        this._compileEmitter = new CompileEquivalentEmitter();
        this._adaptiveCadence = new AdaptiveCadence();
        this._triggerEmitter = new BoundaryTriggerEmitter(
            this._inactivityService,
            this._adaptiveCadence,
        );
        this._decisionEngine = new InterventionDecisionEngine(this._interventionFilter);

        // Collect all services that participate in exercise session lifecycle.
        // TelemetryManager iterates this list on start/end instead of calling
        // individual reset methods, ensuring no service is accidentally missed.
        this._sessionServices = [
            this._eqEngine, this._compileEmitter, this._triggerEmitter,
            this._inactivityService, this._adaptiveCadence, this._interventionFilter,
            this._interventionService, this._thrashingDetector, this._buildTracker,
            this._diagnosticService,
        ];

        // Register disposables
        this._disposables.push(
            this._diagnosticService,
            this._inactivityService,
            this._thrashingDetector,
            this._buildTracker,
            this._interventionService,
            this._compileEmitter,
            this._triggerEmitter,
        );

        this._setupEventHandlers();
        this._loadConfiguration();

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION) ||
                event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DEVELOPER_MODE_KEY}`)) {
                this._loadConfiguration();
            }
        });
        this._disposables.push(configListener);

        this._log('TelemetryManager initialized (EQ system)');
    }

    public dispose(): void {
        if (this._websocketService) {
            this._websocketService.unregisterMessageHandler(this);
        }

        if (this._debugUpdateTimer) {
            clearInterval(this._debugUpdateTimer);
            this._debugUpdateTimer = undefined;
        }
        this._debugStatusBarItem.hide();

        this.endCurrentSession();

        // Log BEFORE disposing the output channel — otherwise _log() writes to
        // an already-disposed channel and throws "Channel has been closed".
        this._log('TelemetryManager disposed');

        while (this._disposables.length > 0) {
            this._disposables.pop()?.dispose();
        }

        this._onDidCalculateEQ.dispose();
    }

    // ==================== WebSocket Message Handler ====================

    /**
     * Handle new build result from WebSocket (implements WebSocketMessageHandler).
     * Central dispatch ensures correct ordering (Edge Case 1):
     *   1. CompileEquivalentEmitter → snapshot → EQEngine
     *   2. BuildResultTracker processing
     *   3. Execution-error trigger (if not success)
     */
    public onNewResult(result: ResultDTO): void {
        if (!this._isEnabled) {
            return;
        }

        // Guard 1: Skip results when no exercise session is active (Edge Case 1b).
        // The WebSocket subscription (personalResults) delivers results for any
        // participation of the user, not just the active exercise's.
        if (this._activeExerciseId === undefined) {
            return;
        }

        // Guard 2: Skip results that belong to a different exercise than the
        // active session. ResultDTO only carries a participationId, so we
        // resolve it through ExerciseRegistry. Policy: permissive on unknown
        // mapping — if the registry has not yet learned this participationId
        // (e.g. first course load not finished), we let the result through
        // rather than dropping real data. Known mismatches are dropped.
        const resultParticipationId = result.participation?.id;
        if (resultParticipationId !== undefined && this._exerciseRegistry) {
            const mappedExerciseId = this._exerciseRegistry.getExerciseIdByParticipation(resultParticipationId);
            if (mappedExerciseId !== undefined && mappedExerciseId !== this._activeExerciseId) {
                return;
            }
        }

        // Step 1: EQ snapshot FIRST (synchronous)
        const event = this._compileEmitter.handleBuildResult(result);
        if (event) {
            const accepted = this._eqEngine.addSnapshot(event.snapshot);
            if (accepted) {
                const { eq, confidence } = this._eqEngine.getCurrentEQ();
                this._onDidCalculateEQ.fire({ eq, confidence, source: 'build' });
            }
        }

        // Step 2: Existing build tracker processing
        this._buildTracker.onNewResult(result);

        // Step 3: Fire execution-error trigger if build wasn't successful
        const classification = classifyBuildResult(result);
        if (classification !== 'success') {
            this._triggerEmitter.fireExecutionErrorTrigger();
        }
    }

    // ==================== Session Lifecycle ====================

    /**
     * Set the WebSocket service for receiving build results.
     */
    public setWebsocketService(websocketService: ArtemisWebsocketService): void {
        this._websocketService = websocketService;

        // Register ourselves as the message handler for build results
        websocketService.registerMessageHandler(this);

        logger.telemetry('WebSocket service connected (EQ system)');
    }

    /**
     * Start a new exercise session — resets all state.
     */
    public startExerciseSession(exerciseId: number, exerciseRoot?: vscode.Uri): void {
        // Idempotent: skip if already tracking this exercise
        if (this._activeExerciseId === exerciseId) {
            return;
        }

        // End previous session if any
        if (this._activeExerciseId !== undefined) {
            this.endExerciseSession();
        }

        this._activeExerciseId = exerciseId;
        this._lastTriggerType = undefined;

        const ctx: SessionStartContext = { exerciseId, exerciseRoot };
        for (const svc of this._sessionServices) {
            svc.onSessionStart(ctx);
        }

        logger.telemetry(`Exercise session started: ${exerciseId}`);
    }

    /**
     * End the current exercise session.
     */
    public endExerciseSession(): void {
        if (this._activeExerciseId === undefined) {
            return;
        }

        // Log final EQ for analytics
        const { eq, confidence } = this._eqEngine.getCurrentEQ();
        this._log(`Session ended for exercise ${this._activeExerciseId}. Final EQ: ${eq.toFixed(3)}, confidence: ${confidence}`);

        for (const svc of this._sessionServices) {
            svc.onSessionEnd?.();
        }

        this._activeExerciseId = undefined;
        this._lastTriggerType = undefined;
    }

    /**
     * End the current session (called from dispose).
     */
    public endCurrentSession(): void {
        this.endExerciseSession();
    }

    /**
     * Record that the student made progress.
     */
    public recordProgress(): void {
        this._interventionFilter.recordProgress();
    }

    // ==================== Event Handlers ====================

    private _setupEventHandlers(): void {
        // Save event → CompileEquivalentEmitter
        const saveListener = vscode.workspace.onDidSaveTextDocument(doc => {
            if (this._isEnabled) {
                this._compileEmitter.handleSaveEvent(doc);
            }
        });
        this._disposables.push(saveListener);

        // Text change → BoundaryTriggerEmitter (paste detection)
        const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
            if (this._isEnabled) {
                this._triggerEmitter.handleTextDocumentChange(event);
            }
        });
        this._disposables.push(changeListener);

        // Selection change → BoundaryTriggerEmitter (selection-maintained)
        const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => {
            if (this._isEnabled) {
                this._triggerEmitter.handleSelectionChange(event);
            }
        });
        this._disposables.push(selectionListener);

        // CompileEquivalentEmitter → EQEngine
        this._compileEmitter.onDidEmitCompileEquivalent(event => {
            // Only add from save events; build events are handled in onNewResult
            if (event.source === 'save') {
                const accepted = this._eqEngine.addSnapshot(event.snapshot);
                if (accepted) {
                    const { eq, confidence } = this._eqEngine.getCurrentEQ();
                    this._onDidCalculateEQ.fire({ eq, confidence, source: 'save' });
                }
            }
        });

        // BoundaryTriggerEmitter → evaluate and intervene
        this._triggerEmitter.onDidFireTrigger(triggerType => {
            this._evaluateAndIntervene(triggerType);
        });

        // Build success → record progress
        this._buildTracker.onDidReceiveBuildResult(result => {
            if (result.success) {
                this.recordProgress();
                this._interventionService.hideHint();
            }
        });

        // Diagnostics all resolved → record progress
        this._diagnosticService.onDidUpdateDiagnostics(diagnostics => {
            const activeErrors = diagnostics.filter(d => !d.resolved);
            if (activeErrors.length === 0) {
                this.recordProgress();
            }
        });

        // Intervention dismissed → increment adaptive cadence for the trigger that caused it
        this._interventionService.onDidDismissIntervention(decision => {
            const triggerType = decision.triggerType ?? 'idle';
            this._adaptiveCadence.incrementIgnoreCount(triggerType);
        });

        // Intervention accepted → reset adaptive cadence
        this._interventionService.onDidAcceptIntervention(() => {
            this._adaptiveCadence.resetAll();
        });

        // Window focus resume — log when window regains focus with active exercise.
        // InactivityService will naturally pick up activity from subsequent user actions
        // (text changes, saves, selections). No explicit recordActivity needed.
        const windowStateListener = vscode.window.onDidChangeWindowState(state => {
            if (state.focused && this._activeExerciseId !== undefined) {
                this._log('Window regained focus with active exercise session');
            }
        });
        this._disposables.push(windowStateListener);
    }

    // ==================== Core Decision Logic ====================

    /**
     * Evaluate EQ and decide whether to intervene.
     */
    private _evaluateAndIntervene(triggerType: TriggerType): void {
        if (!this._isEnabled) {
            return;
        }

        this._lastTriggerType = triggerType;
        const { eq, confidence } = this._eqEngine.getCurrentEQ();
        this._onDidCalculateEQ.fire({ eq, confidence, source: 'trigger', triggerType });

        const state = this._interventionService.getState();
        const decision = this._decisionEngine.evaluate(eq, confidence, triggerType, state);

        if (!decision.shouldIntervene) {
            return;
        }

        // Dispatch intervention
        switch (decision.level) {
            case 'subtle':
                this._interventionService.showSubtleHintEQ(decision);
                break;
            case 'notification':
                void this._interventionService.showNotificationEQ(decision);
                break;
            case 'proactive':
                void this._interventionService.showProactiveHelpEQ(decision);
                break;
        }
    }

    // ==================== Public API ====================

    /**
     * Get current struggle context for Iris chat integration.
     */
    public getStruggleContext(): StruggleContext {
        const { eq, confidence } = this._eqEngine.getCurrentEQ();
        const level = this._getRecommendedAction(eq, confidence);

        return {
            isStruggling: confidence !== 'insufficient' && level !== 'none',
            eq,
            eqConfidence: confidence,
            triggerType: this._lastTriggerType,
            recommendedAction: level,
        };
    }

    public getEqEngineState(): EQState {
        return this._eqEngine.getState();
    }

    public isEnabled(): boolean {
        return this._isEnabled;
    }

    // ==================== Configuration ====================

    private _loadConfiguration(): void {
        const struggleConfig = vscode.workspace.getConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION);
        this._isEnabled = struggleConfig.get<boolean>(VSCODE_CONFIG.STRUGGLE_DETECTION.ENABLED_KEY, true);

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

        if (this._debugMode && !wasDebugMode) {
            this._startDebugUpdates();
            this._log('Developer mode ENABLED — showing live EQ in status bar');
        } else if (!this._debugMode && wasDebugMode) {
            this._stopDebugUpdates();
            this._log('Developer mode DISABLED');
        }
    }

    private _getRecommendedAction(eq: number, confidence: EQConfidence): RecommendedAction {
        if (confidence === 'insufficient') {
            return 'none';
        }
        return this._decisionEngine.mapEQToLevel(eq);
    }

    // ==================== DEBUG FEATURES ====================

    private _startDebugUpdates(): void {
        this._updateDebugStatusBar();
        this._debugStatusBarItem.show();

        this._debugUpdateTimer = setInterval(() => {
            this._updateDebugStatusBar();
        }, TelemetryManager.DEBUG_UPDATE_INTERVAL_MS);
    }

    private _stopDebugUpdates(): void {
        if (this._debugUpdateTimer) {
            clearInterval(this._debugUpdateTimer);
            this._debugUpdateTimer = undefined;
        }
        this._debugStatusBarItem.hide();
    }

    private _updateDebugStatusBar(): void {
        if (!this._debugMode) {
            return;
        }

        const { eq, confidence } = this._eqEngine.getCurrentEQ();
        const eqPercent = Math.round(eq * 100);
        const emoji = this._getEQEmoji(eq, confidence);
        const action = this._getRecommendedAction(eq, confidence);
        const actionIcon = this._getActionIcon(action);

        this._debugStatusBarItem.text = `${emoji} EQ: ${eqPercent}% ${actionIcon}`;
        this._debugStatusBarItem.tooltip = this._buildDebugTooltip(eq, confidence);
        this._debugStatusBarItem.backgroundColor = this._getEQBackground(eq, confidence);
    }

    private _getEQEmoji(eq: number, confidence: EQConfidence): string {
        if (confidence === 'insufficient') {
            return '$(circle-outline)';
        }
        if (eq < 0.15) {
            return '$(pass-filled)';
        }
        if (eq < 0.35) {
            return '$(circle-filled)';
        }
        if (eq < 0.60) {
            return '$(warning)';
        }
        if (eq < 0.80) {
            return '$(flame)';
        }
        return '$(alert)';
    }

    private _getActionIcon(action: string): string {
        switch (action) {
            case 'subtle': return '$(lightbulb)';
            case 'notification': return '$(bell)';
            case 'proactive': return '$(megaphone)';
            default: return '';
        }
    }

    private _getEQBackground(eq: number, confidence: EQConfidence): vscode.ThemeColor | undefined {
        if (confidence === 'insufficient') {
            return undefined;
        }
        if (eq < 0.35) {
            return undefined;
        }
        if (eq < 0.60) {
            return new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        return new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    private _buildDebugTooltip(eq: number, confidence: EQConfidence): string {
        const state = this._eqEngine.getState();
        const action = this._getRecommendedAction(eq, confidence);
        const adaptive = this._adaptiveCadence.getState();

        const lines: string[] = [
            'Artemis Telemetry Debug (EQ)',
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '',
            `EQ: ${(eq * 100).toFixed(1)}%`,
            `Confidence: ${confidence}`,
            `Recommended Action: ${action}`,
            `Snapshots: ${state.snapshots.length}`,
            `Pairs: ${state.pairCount}`,
            '',
            '── Adaptive Cadence ──',
            `   Idle ignores: ${adaptive.ignoreCounts['idle']}`,
            `   Selection ignores: ${adaptive.ignoreCounts['selection-maintained']}`,
            `   Idle threshold: ${this._adaptiveCadence.getIdleThreshold() / 1000}s`,
            `   Selection threshold: ${this._adaptiveCadence.getSelectionThreshold() / 1000}s`,
            '',
            '── Activity ──',
            `   Pattern: ${this._inactivityService.getCurrentPattern()}`,
            `   Time since edit: ${Math.round(this._inactivityService.getTimeSinceLastEdit() / 1000)}s`,
            `   Thrashing: ${this._thrashingDetector.getThrashingScore()}/100`,
            '',
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '$(info) Click for detailed view',
        ];
        return lines.join('\n');
    }

    /**
     * Show detailed EQ dialog (called from command).
     */
    public async showStruggleScoreDialog(): Promise<void> {
        const { eq, confidence } = this._eqEngine.getCurrentEQ();
        const state = this._eqEngine.getState();
        const action = this._getRecommendedAction(eq, confidence);

        this._logCurrentState();
        this._outputChannel.show(true);

        const items: vscode.QuickPickItem[] = [
            {
                label: `$(graph) EQ: ${(eq * 100).toFixed(1)}%`,
                description: `Action: ${action}`,
                detail: `Confidence: ${confidence}, ${state.pairCount} pairs`
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: `$(beaker) Snapshots: ${state.snapshots.length}`,
                description: `${state.pairCount} scored pairs`,
            },
            {
                label: `$(watch) Activity: ${this._inactivityService.getCurrentPattern()}`,
                description: `Time since edit: ${Math.round(this._inactivityService.getTimeSinceLastEdit() / 1000)}s`,
            },
            {
                label: `$(cloud) Build Failures: ${this._buildTracker.getConsecutiveFailures()}`,
                description: 'Consecutive server build failures',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: '$(output) Show Output Channel',
                description: 'View detailed telemetry logs'
            },
            {
                label: '$(refresh) Refresh',
                description: 'Recalculate EQ'
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            title: 'Artemis Telemetry — Error Quotient',
            placeHolder: 'Current EQ-based struggle detection metrics',
        });

        if (selection?.label === '$(output) Show Output Channel') {
            this._outputChannel.show();
        } else if (selection?.label === '$(refresh) Refresh') {
            await this.showStruggleScoreDialog();
        }
    }

    // ==================== Logging ====================

    private _log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this._outputChannel.appendLine(`[${timestamp}] ${message}`);
        logger.telemetry(message);
    }

    private _logCurrentState(): void {
        const { eq, confidence } = this._eqEngine.getCurrentEQ();
        const state = this._eqEngine.getState();
        const pattern = this._inactivityService.getCurrentPattern();
        const thrashing = this._thrashingDetector.getThrashingScore();

        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('═══════════════════════════════════════');
        this._outputChannel.appendLine('       TELEMETRY STATE (EQ SYSTEM)');
        this._outputChannel.appendLine('═══════════════════════════════════════');
        this._outputChannel.appendLine(`Time: ${new Date().toLocaleString()}`);
        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('EQ METRICS');
        this._outputChannel.appendLine(`   EQ: ${(eq * 100).toFixed(1)}%`);
        this._outputChannel.appendLine(`   Confidence: ${confidence}`);
        this._outputChannel.appendLine(`   Snapshots: ${state.snapshots.length}`);
        this._outputChannel.appendLine(`   Pairs: ${state.pairCount}`);
        this._outputChannel.appendLine(`   Action: ${this._getRecommendedAction(eq, confidence)}`);
        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('ACTIVITY');
        this._outputChannel.appendLine(`   Pattern: ${pattern}`);
        this._outputChannel.appendLine(`   Time since edit: ${Math.round(this._inactivityService.getTimeSinceLastEdit() / 1000)}s`);
        this._outputChannel.appendLine(`   Thrashing score: ${thrashing}/100`);
        this._outputChannel.appendLine('');
        this._outputChannel.appendLine('SERVER');
        this._outputChannel.appendLine(`   Consecutive build failures: ${this._buildTracker.getConsecutiveFailures()}`);
        this._outputChannel.appendLine('═══════════════════════════════════════');
        this._outputChannel.appendLine('');
    }
}
