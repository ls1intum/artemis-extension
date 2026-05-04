import * as vscode from 'vscode';
import {
    StruggleContext,
    TriggerType,
    EQConfidence,
    EQState,
    RecommendedAction,
    SuppressedInterventionPayload,
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
import { DebugDashboard } from './debugDashboard';
import { ArtemisWebsocketService } from '../websocket/artemisWebsocketService';
import { ResultDTO, WebSocketMessageHandler } from '../../types';
import { VSCODE_CONFIG } from '../../utils/constants';
import { logger, LogCategory } from '../loggingService';
import type { ExerciseRegistry } from '../exerciseRegistry';
import { shouldAcceptBuildResult } from './buildResultGuard';

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
    private _showInterventions: boolean = true;
    private readonly _sessionServices: SessionResettable[];
    private _activeExerciseId: number | undefined;
    private _lastTriggerType: TriggerType | undefined;
    private readonly _exerciseRegistry: ExerciseRegistry | undefined;
    // Debug mode
    private _debugMode: boolean = false;
    private readonly _debugDashboard: DebugDashboard;
    private readonly _outputChannel: vscode.OutputChannel;

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

    public get onDidBlockIntervention() {
        return this._interventionService.onDidBlockIntervention;
    }

    private readonly _onDidSuppressIntervention = new vscode.EventEmitter<SuppressedInterventionPayload>();
    public readonly onDidSuppressIntervention = this._onDidSuppressIntervention.event;

    constructor(exerciseRegistry?: ExerciseRegistry) {
        this._exerciseRegistry = exerciseRegistry;
        this._outputChannel = vscode.window.createOutputChannel('Artemis Telemetry');
        this._disposables.push(this._outputChannel);

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

        // Debug UI
        this._debugDashboard = new DebugDashboard({
            eqEngine: this._eqEngine,
            inactivityService: this._inactivityService,
            thrashingDetector: this._thrashingDetector,
            buildTracker: this._buildTracker,
            adaptiveCadence: this._adaptiveCadence,
            outputChannel: this._outputChannel,
            getRecommendedAction: (eq, confidence) => this._getRecommendedAction(eq, confidence),
        });

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
            this._debugDashboard,
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

        this.endCurrentSession();

        // Log before disposing the output channel (which is in _disposables)
        this._log('TelemetryManager disposed');

        while (this._disposables.length > 0) {
            this._disposables.pop()?.dispose();
        }

        this._onDidCalculateEQ.dispose();
        this._onDidSuppressIntervention.dispose();
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

        if (!shouldAcceptBuildResult(result, this._activeExerciseId, this._exerciseRegistry)) {
            return;
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

        if (decision.shouldIntervene) {
            if (!this._showInterventions) {
                // UI suppressed by user setting. Decision-engine UI-delivery state is
                // intentionally NOT advanced (no _recordIntervention) because no UI was
                // shown. The recording layer subscribes to onDidSuppressIntervention so
                // every eligible opportunity is captured for evaluation.
                this._onDidSuppressIntervention.fire({
                    decision,
                    reason: 'user-disabled',
                });
                return;
            }
            switch (decision.level) {
                case 'subtle':
                    this._interventionService.showSubtleHintEQ(decision);
                    break;
                case 'notification':
                    void this._interventionService.showNotificationEQ(decision).catch((err: unknown) => {
                        logger.error('Failed to show notification intervention', LogCategory.TELEMETRY, err);
                    });
                    break;
                case 'proactive':
                    void this._interventionService.showProactiveHelpEQ(decision).catch((err: unknown) => {
                        logger.error('Failed to show proactive intervention', LogCategory.TELEMETRY, err);
                    });
                    break;
            }
        } else if (decision.rawWanted) {
            // EQ was above threshold but something blocked the intervention.
            // Record it for telemetry (rate-limited internally).
            this._interventionService.recordBlockedDecision(decision);
        }
        // else: rawWanted=false → EQ below all thresholds, normal operation, no event.
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

        const previousShowInterventions = this._showInterventions;
        const rawShow = struggleConfig.get<unknown>(
            VSCODE_CONFIG.STRUGGLE_DETECTION.SHOW_INTERVENTIONS_KEY,
            true,
        );
        this._showInterventions = typeof rawShow === 'boolean' ? rawShow : true;

        const wasDebugMode = this._debugMode;
        const artemisConfig = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const developerMode = artemisConfig.get<boolean>(VSCODE_CONFIG.DEVELOPER_MODE_KEY, false);
        this._debugMode = this._isEnabled && developerMode;

        if (!this._isEnabled) {
            this._interventionService.hideHint();
            this._debugDashboard.stop();
            this._log('Struggle detection disabled');
        } else {
            this._log('Struggle detection enabled');
        }

        // Live transition on->off for the UI toggle: clear any visible hint so a
        // status-bar lightbulb / coloured remnant disappears immediately. We do
        // NOT log on every load (only on transitions) to avoid noise.
        if (previousShowInterventions && !this._showInterventions) {
            this._interventionService.hideHint();
            this._log('Intervention UI suppressed by user setting');
        } else if (!previousShowInterventions && this._showInterventions) {
            this._log('Intervention UI restored by user setting');
        }

        if (this._debugMode && !wasDebugMode) {
            this._debugDashboard.start();
            this._log('Developer mode ENABLED — showing live EQ in status bar');
        } else if (!this._debugMode && wasDebugMode) {
            this._debugDashboard.stop();
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

    /**
     * Show detailed EQ dialog (called from command). Delegates to DebugDashboard.
     */
    public async showStruggleScoreDialog(): Promise<void> {
        await this._debugDashboard.showStruggleScoreDialog();
    }

    // ==================== Logging ====================

    private _log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this._outputChannel.appendLine(`[${timestamp}] ${message}`);
        logger.telemetry(message);
    }

}
