import * as vscode from 'vscode';

import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import { ResultDTO, WebSocketMessageHandler } from '@extension/types';
import { VSCODE_CONFIG } from '@extension/utils/constants';

import { shouldAcceptBuildResult } from './buildResultGuard';
import { BuildResultTracker } from './buildResultTracker';
import { DebugDashboard } from './debugDashboard';
import { InterventionDecisionEngine } from './decision/interventionDecisionEngine';
import { DiagnosticPersistenceService } from './diagnosticPersistenceService';
import { BoundaryTriggerEmitter } from './eventPipeline/boundaryTriggerEmitter';
import { classifyBuildResult, CompileEquivalentEmitter } from './eventPipeline/compileEquivalentEmitter';
import { InactivityService } from './inactivityService';
import { AdaptiveCadence } from './intervention/adaptiveCadence';
import { InterventionFilter } from './interventionFilter';
import { InterventionService } from './interventionService';
import { ErrorQuotientEngine } from './metrics/errorQuotientEngine';
import type { SessionResettable, SessionStartContext } from './types';
import {
    EQConfidence,
    EQState,
    RecommendedAction,
    StruggleContext,
    SuppressedInterventionPayload,
    TriggerType,
} from './types';

/**
 * Central orchestration service for EQ-based struggle detection:
 *   1. Error Quotient (EQ), Jadud 2006 pair-scoring formula
 *   2. Subtask-Boundary Triggers, Pu et al. 2025
 *   3. Adaptive Cadence (escalating thresholds on ignore)
 */
export class TelemetryManager implements vscode.Disposable, WebSocketMessageHandler {
    private readonly _disposables: vscode.Disposable[] = [];
    private _disposed = false;

    private readonly _diagnosticService: DiagnosticPersistenceService;
    private readonly _inactivityService: InactivityService;
    private readonly _buildTracker: BuildResultTracker;
    private readonly _interventionService: InterventionService;
    private readonly _interventionFilter: InterventionFilter;

    private readonly _eqEngine: ErrorQuotientEngine;
    private readonly _compileEmitter: CompileEquivalentEmitter;
    private readonly _triggerEmitter: BoundaryTriggerEmitter;
    private readonly _decisionEngine: InterventionDecisionEngine;
    private readonly _adaptiveCadence: AdaptiveCadence;

    private _websocketService: ArtemisWebsocketService | undefined;
    private _isEnabled: boolean = true;
    private _showInterventions: boolean = true;
    private readonly _sessionServices: SessionResettable[];
    private _activeExerciseId: number | undefined;
    private _lastTriggerType: TriggerType | undefined;
    private readonly _exerciseRegistry: ExerciseRegistry | undefined;
    private _debugMode: boolean = false;
    private readonly _debugDashboard: DebugDashboard;
    private readonly _outputChannel: vscode.OutputChannel;

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

        this._diagnosticService = new DiagnosticPersistenceService();
        this._inactivityService = new InactivityService();
        this._buildTracker = new BuildResultTracker();
        this._interventionService = new InterventionService();
        this._interventionFilter = new InterventionFilter();

        this._eqEngine = new ErrorQuotientEngine();
        this._compileEmitter = new CompileEquivalentEmitter();
        this._adaptiveCadence = new AdaptiveCadence();
        this._triggerEmitter = new BoundaryTriggerEmitter(
            this._inactivityService,
            this._adaptiveCadence,
        );
        this._decisionEngine = new InterventionDecisionEngine(this._interventionFilter);

        this._debugDashboard = new DebugDashboard({
            eqEngine: this._eqEngine,
            inactivityService: this._inactivityService,
            buildTracker: this._buildTracker,
            adaptiveCadence: this._adaptiveCadence,
            outputChannel: this._outputChannel,
            getRecommendedAction: (eq, confidence) => this._getRecommendedAction(eq, confidence),
        });

        // Every service registered here receives centralized start/end dispatch
        // instead of an individually called reset method.
        this._sessionServices = [
            this._eqEngine, this._compileEmitter, this._triggerEmitter,
            this._inactivityService, this._adaptiveCadence, this._interventionFilter,
            this._interventionService, this._buildTracker,
            this._diagnosticService,
        ];

        this._disposables.push(
            this._debugDashboard,
            this._diagnosticService,
            this._inactivityService,
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
        // Idempotent: VS Code disposes context.subscriptions during deactivate,
        // and extension.ts also calls this explicitly so session-end telemetry
        // flushes before teardown. Both paths must be safe to run.
        if (this._disposed) {
            return;
        }
        this._disposed = true;

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

    /**
     * Handle a new build result from the WebSocket. The dispatch order matters:
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

        // Step 1: EQ snapshot FIRST (synchronous). handleBuildResult fires
        // onDidEmitCompileEquivalent, whose listener in _setupEventHandlers
        // adds the snapshot to the EQ engine. Both save and build flow through
        // that one listener.
        this._compileEmitter.handleBuildResult(result);

        // Step 2: build tracker processing
        this._buildTracker.onNewResult(result);

        // Step 3: execution-error trigger if the build was not successful
        const classification = classifyBuildResult(result);
        if (classification !== 'success') {
            this._triggerEmitter.fireExecutionErrorTrigger();
        }
    }

    public setWebsocketService(websocketService: ArtemisWebsocketService): void {
        this._websocketService = websocketService;
        websocketService.registerMessageHandler(this);

        logger.telemetry('WebSocket service connected (EQ system)');
    }

    /**
     * Start a new exercise session, resetting all session state.
     */
    public startExerciseSession(exerciseId: number, exerciseRoot?: vscode.Uri): void {
        // Idempotent: skip if already tracking this exercise
        if (this._activeExerciseId === exerciseId) {
            return;
        }

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

    public endExerciseSession(): void {
        if (this._activeExerciseId === undefined) {
            return;
        }

        const { eq, confidence } = this._eqEngine.getCurrentEQ();
        this._log(`Session ended for exercise ${this._activeExerciseId}. Final EQ: ${eq.toFixed(3)}, confidence: ${confidence}`);

        for (const svc of this._sessionServices) {
            svc.onSessionEnd?.();
        }

        this._activeExerciseId = undefined;
        this._lastTriggerType = undefined;
    }

    public endCurrentSession(): void {
        this.endExerciseSession();
    }

    public recordProgress(): void {
        this._interventionFilter.recordProgress();
    }

    private _setupEventHandlers(): void {
        const saveListener = vscode.workspace.onDidSaveTextDocument(doc => {
            if (this._isEnabled) {
                this._compileEmitter.handleSaveEvent(doc);
            }
        });
        this._disposables.push(saveListener);

        const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
            if (this._isEnabled) {
                this._triggerEmitter.handleTextDocumentChange(event);
            }
        });
        this._disposables.push(changeListener);

        const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => {
            if (this._isEnabled) {
                this._triggerEmitter.handleSelectionChange(event);
            }
        });
        this._disposables.push(selectionListener);

        // Single source of truth for snapshot intake: both save and build
        // events reach the EQ engine through here.
        this._compileEmitter.onDidEmitCompileEquivalent(event => {
            const accepted = this._eqEngine.addSnapshot(event.snapshot);
            if (accepted) {
                const { eq, confidence } = this._eqEngine.getCurrentEQ();
                this._onDidCalculateEQ.fire({ eq, confidence, source: event.source });
            }
        });

        this._triggerEmitter.onDidFireTrigger(triggerType => {
            this._evaluateAndIntervene(triggerType);
        });

        this._buildTracker.onDidReceiveBuildResult(result => {
            if (result.success) {
                this.recordProgress();
                this._interventionService.hideHint();
            }
        });

        // All diagnostics resolved counts as progress.
        this._diagnosticService.onDidUpdateDiagnostics(diagnostics => {
            const activeErrors = diagnostics.filter(d => !d.resolved);
            if (activeErrors.length === 0) {
                this.recordProgress();
            }
        });

        // A dismissal escalates the adaptive cadence for the trigger that
        // caused it. Only explicit user dismissals count: 'replaced', 'hidden'
        // and 'session-end' are implicit lifecycle dismissals and must not
        // skew the cadence statistics.
        this._interventionService.onDidDismissIntervention(decision => {
            if (decision.dismissReason !== 'user-action') {
                return;
            }
            if (decision.triggerType === undefined) {
                logger.warn(
                    'Dismiss event has no triggerType — skipping cadence increment',
                    LogCategory.TELEMETRY,
                );
                return;
            }
            this._adaptiveCadence.incrementIgnoreCount(decision.triggerType);
        });

        this._interventionService.onDidAcceptIntervention(() => {
            this._adaptiveCadence.resetAll();
        });

        // Logging only. InactivityService picks up activity from the user's
        // subsequent actions (text changes, saves, selections), so no explicit
        // recordActivity is needed here.
        const windowStateListener = vscode.window.onDidChangeWindowState(state => {
            if (state.focused && this._activeExerciseId !== undefined) {
                this._log('Window regained focus with active exercise session');
            }
        });
        this._disposables.push(windowStateListener);
    }

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
                // UI suppressed by user setting. Decision-engine UI-delivery
                // state is deliberately NOT advanced (no _recordIntervention)
                // because no UI was shown. The recording layer subscribes to
                // onDidSuppressIntervention so every eligible opportunity is
                // still captured for evaluation.
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
            // EQ above threshold but something blocked the intervention.
            // Recorded for telemetry (rate-limited internally).
            this._interventionService.recordBlockedDecision(decision);
        }
        // rawWanted=false means EQ below all thresholds: normal, no event.
    }

    /**
     * Current struggle context for Iris chat integration.
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

        // On a live on->off flip of the UI toggle, clear any visible hint so a
        // status-bar lightbulb or coloured remnant disappears immediately.
        // Logged on transitions only, to avoid noise on every config load.
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

    public async showStruggleScoreDialog(): Promise<void> {
        await this._debugDashboard.showStruggleScoreDialog();
    }

    private _log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this._outputChannel.appendLine(`[${timestamp}] ${message}`);
        logger.telemetry(message);
    }

}
