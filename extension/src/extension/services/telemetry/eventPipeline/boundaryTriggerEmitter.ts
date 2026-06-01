import * as vscode from 'vscode';

import { InactivityService } from '@extension/services/telemetry/inactivityService';
import { AdaptiveCadence } from '@extension/services/telemetry/intervention/adaptiveCadence';
import { DEFAULT_TRIGGER_CONFIG, SessionResettable, SessionStartContext, TriggerConfig, TriggerType } from '@extension/services/telemetry/types';

import { isLikelyManualPaste } from './compileEquivalentEmitter';

/**
 * Emits boundary trigger events based on Pu et al. 2025 [P11, Section 4].
 *
 * Triggers:
 *   1. Execution Error — 0% disruption rate, 66.7% effective [P11, Fig. 4]
 *   2. Multi-line Paste — 73.1% effective (highest!) [P11, Fig. 4]
 *   3. Idle — 30s adaptive threshold, one-shot state machine [P11, Section 4]
 *   4. Selection Maintained — 15s adaptive threshold [P11, Section 4]
 *
 * Idle trigger uses a one-shot state machine (paper model: "User has been idle" → intervene once):
 *   [Activity] → _armIdleTimer(threshold)
 *       ↓ threshold elapses without activity
 *   [Timer fires] → fire 'idle' once, timer = undefined
 *       ↓ user resumes activity
 *   [onDidResumeActivity] → _armIdleTimer(threshold)  ← re-arm
 */
export class BoundaryTriggerEmitter implements vscode.Disposable, SessionResettable {
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

    /** One-shot idle timer (fires once, then waits for activity resume to re-arm) */
    private _idleTimer: NodeJS.Timeout | undefined;
    private _selectionTimer: NodeJS.Timeout | undefined;

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

        // Arm the idle timer initially
        this._armIdleTimer();

        // Re-arm when user resumes activity after being idle
        const resumeListener = this._inactivityService.onDidResumeActivity(() => {
            this._armIdleTimer();
        });
        this._disposables.push(resumeListener);
    }

    public dispose(): void {
        if (this._idleTimer) {
            clearTimeout(this._idleTimer);
            this._idleTimer = undefined;
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
     * Paper (P11): "If insignificant selection, no response." — only range selections
     * start the timer; empty cursor clicks cancel any running timer.
     */
    public handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
        const hasNonEmptySelection = event.selections.some(s => !s.isEmpty);

        if (!hasNonEmptySelection) {
            // Empty selection (cursor click) — cancel any running timer
            if (this._selectionTimer) {
                clearTimeout(this._selectionTimer);
                this._selectionTimer = undefined;
            }
            return;
        }

        // Non-empty (range) selection — restart timer
        if (this._selectionTimer) {
            clearTimeout(this._selectionTimer);
        }

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
     * SessionResettable — delegates to existing reset().
     */
    public onSessionStart(_context: SessionStartContext): void {
        this.reset();
    }

    /**
     * Full reset for exercise switch.
     */
    public reset(): void {
        if (this._idleTimer) {
            clearTimeout(this._idleTimer);
            this._idleTimer = undefined;
        }
        if (this._selectionTimer) {
            clearTimeout(this._selectionTimer);
            this._selectionTimer = undefined;
        }
        this._lastTriggerTimestamps = {
            'execution-error': 0,
            'multiline-paste': 0,
            'idle': 0,
            'selection-maintained': 0,
        };

        // Re-arm idle timer for the new exercise
        this._armIdleTimer();
    }

    /**
     * Arm the one-shot idle timer.
     * Accounts for time already spent idle (e.g., when re-arming after resume).
     * On fire: verifies user is actually still idle. If activity happened in between,
     * re-arms with remaining time instead of firing.
     * Fires 'idle' exactly once, then waits for onDidResumeActivity to re-arm.
     */
    private _armIdleTimer(): void {
        // Clear any existing timer
        if (this._idleTimer) {
            clearTimeout(this._idleTimer);
            this._idleTimer = undefined;
        }

        const threshold = this._adaptiveCadence.getIdleThreshold();
        const alreadyIdle = this._inactivityService.getTimeSinceLastActivity();
        const delay = Math.max(0, threshold - alreadyIdle);

        this._idleTimer = setTimeout(() => {
            this._idleTimer = undefined;
            // Verify user is actually idle — activity during the timer resets idle clock
            const currentIdle = this._inactivityService.getTimeSinceLastActivity();
            const currentThreshold = this._adaptiveCadence.getIdleThreshold();
            if (currentIdle < currentThreshold) {
                // Activity happened since arming — re-arm with remaining time
                this._armIdleTimer();
                return;
            }
            this._lastTriggerTimestamps['idle'] = Date.now();
            this._onDidFireTrigger.fire('idle');
            // One-shot: do NOT re-arm. Wait for onDidResumeActivity.
        }, delay);
    }

    /**
     * Check cooldown for a trigger type.
     * Note: idle uses one-shot state machine and does not need cooldown.
     */
    private _checkCooldown(type: TriggerType): boolean {
        const lastTime = this._lastTriggerTimestamps[type];
        return (Date.now() - lastTime) >= this._config.TRIGGER_COOLDOWN_MS;
    }
}
