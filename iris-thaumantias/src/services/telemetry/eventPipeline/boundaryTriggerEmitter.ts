import * as vscode from 'vscode';
import { TriggerType, DEFAULT_TRIGGER_CONFIG, TriggerConfig } from '../types';
import { InactivityService } from '../inactivityService';
import { AdaptiveCadence } from '../intervention/adaptiveCadence';
import { isLikelyManualPaste } from './compileEquivalentEmitter';

/**
 * Emits boundary trigger events based on Pu et al. 2025 [P11, Section 4].
 *
 * Triggers:
 *   1. Execution Error — 0% disruption rate, 66.7% effective [P11, Fig. 4]
 *   2. Multi-line Paste — 73.1% effective (highest!) [P11, Fig. 4]
 *   3. Idle — 30s adaptive threshold [P11, Section 4]
 *   4. Selection Maintained — 15s adaptive threshold [P11, Section 4]
 */
export class BoundaryTriggerEmitter implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _config: TriggerConfig;
    private readonly _adaptiveCadence: AdaptiveCadence;
    private readonly _inactivityService: InactivityService;

    private _lastTriggerTimestamps: Record<TriggerType, number> = {
        'execution-error': 0,
        'multiline-paste': 0,
        'idle': 0,
        'selection-maintained': 0,
    };

    private _idleCheckTimer: NodeJS.Timeout | undefined;
    private _selectionTimer: NodeJS.Timeout | undefined;
    private _selectionStartTime: number = 0;

    private readonly _onDidFireTrigger = new vscode.EventEmitter<TriggerType>();
    public readonly onDidFireTrigger = this._onDidFireTrigger.event;

    constructor(
        inactivityService: InactivityService,
        adaptiveCadence: AdaptiveCadence,
        config: TriggerConfig = DEFAULT_TRIGGER_CONFIG,
    ) {
        this._inactivityService = inactivityService;
        this._adaptiveCadence = adaptiveCadence;
        this._config = config;

        this._startIdleCheck();
    }

    public dispose(): void {
        if (this._idleCheckTimer) {
            clearInterval(this._idleCheckTimer);
            this._idleCheckTimer = undefined;
        }
        if (this._selectionTimer) {
            clearTimeout(this._selectionTimer);
            this._selectionTimer = undefined;
        }
        while (this._disposables.length > 0) {
            this._disposables.pop()?.dispose();
        }
        this._onDidFireTrigger.dispose();
    }

    /**
     * Fire an execution-error trigger (called after a failed build).
     * Has cooldown check (60s between triggers of same type).
     */
    public fireExecutionErrorTrigger(): void {
        if (!this._checkCooldown('execution-error')) {
            return;
        }
        this._lastTriggerTimestamps['execution-error'] = Date.now();
        this._onDidFireTrigger.fire('execution-error');
    }

    /**
     * Handle text document change — check for multi-line paste.
     */
    public handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (event.document.uri.scheme !== 'file') {
            return;
        }

        for (const change of event.contentChanges) {
            if (isLikelyManualPaste(change)) {
                if (!this._checkCooldown('multiline-paste')) {
                    return;
                }
                this._lastTriggerTimestamps['multiline-paste'] = Date.now();
                this._onDidFireTrigger.fire('multiline-paste');
                return; // Fire at most once per change event
            }
        }
    }

    /**
     * Handle selection change — start a timer to fire selection-maintained trigger.
     */
    public handleSelectionChange(_event: vscode.TextEditorSelectionChangeEvent): void {
        // Cancel any existing selection timer
        if (this._selectionTimer) {
            clearTimeout(this._selectionTimer);
        }

        this._selectionStartTime = Date.now();
        const threshold = this._adaptiveCadence.getSelectionThreshold();

        this._selectionTimer = setTimeout(() => {
            this._selectionTimer = undefined;
            if (!this._checkCooldown('selection-maintained')) {
                return;
            }
            this._lastTriggerTimestamps['selection-maintained'] = Date.now();
            this._onDidFireTrigger.fire('selection-maintained');
        }, threshold);
    }

    /**
     * Full reset for exercise switch.
     */
    public reset(): void {
        if (this._selectionTimer) {
            clearTimeout(this._selectionTimer);
            this._selectionTimer = undefined;
        }
        this._selectionStartTime = 0;
        this._lastTriggerTimestamps = {
            'execution-error': 0,
            'multiline-paste': 0,
            'idle': 0,
            'selection-maintained': 0,
        };
    }

    /**
     * Start periodic idle check using InactivityService.
     */
    private _startIdleCheck(): void {
        // Check every 5 seconds whether idle threshold has been exceeded
        this._idleCheckTimer = setInterval(() => {
            const timeSinceEdit = this._inactivityService.getTimeSinceLastEdit();
            const threshold = this._adaptiveCadence.getIdleThreshold();

            if (timeSinceEdit >= threshold) {
                if (!this._checkCooldown('idle')) {
                    return;
                }
                this._lastTriggerTimestamps['idle'] = Date.now();
                this._onDidFireTrigger.fire('idle');
            }
        }, 5000);
    }

    /**
     * Check cooldown for a trigger type.
     */
    private _checkCooldown(type: TriggerType): boolean {
        const lastTime = this._lastTriggerTimestamps[type];
        return (Date.now() - lastTime) >= this._config.TRIGGER_COOLDOWN_MS;
    }
}
