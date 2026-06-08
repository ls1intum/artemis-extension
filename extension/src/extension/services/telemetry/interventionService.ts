import * as vscode from 'vscode';

import {
    InterventionBlockedReason,
    InterventionDecision,
    InterventionDismissReason,
    InterventionState,
    SessionResettable,
    SessionStartContext,
} from './types';

/**
 * Payload emitted by onDidBlockIntervention.
 */
interface BlockedInterventionPayload {
    decision: InterventionDecision;
}

/**
 * Payload emitted by onDidDismissIntervention (extends InterventionDecision with dismissReason).
 */
interface DismissInterventionPayload extends InterventionDecision {
    dismissReason: InterventionDismissReason;
}

/**
 * Payload emitted by onDidAcceptIntervention — identical to InterventionDecision for now,
 * typed separately to allow future extension.
 */
type AcceptInterventionPayload = InterventionDecision;

/**
 * Service that handles UI interventions based on struggle detection.
 * Manages status bar, notifications, and proactive help triggers.
 */
export class InterventionService implements vscode.Disposable, SessionResettable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _statusBarItem: vscode.StatusBarItem;
    private _state: InterventionState;

    /** Cooldown between interventions (5 minutes) */
    private static readonly INTERVENTION_COOLDOWN_MS = 5 * 60 * 1000;

    /** EQ threshold above which notification message mentions "repeated errors" */
    private static readonly EQ_REPEATED_ERRORS_THRESHOLD = 0.45;

    /** EQ threshold above which proactive message mentions "same errors repeatedly" */
    private static readonly EQ_SEVERE_STRUGGLE_THRESHOLD = 0.80;

    /**
     * Rate-limit window for block events: at most 1 event per (triggerType,
     * blockedReason) combination per window.
     */
    public static readonly BLOCK_EVENT_RATE_LIMIT_MS = 60_000;

    /**
     * The decision that produced the currently-visible subtle hint.
     * Non-null while the hint is shown; cleared on accept or dismiss.
     */
    private _currentSubtleDecision: InterventionDecision | undefined = undefined;

    /**
     * Last time a block-event was emitted per (triggerType|'__none__', blockedReason) key.
     * Used for rate-limiting blocked-decision events.
     */
    private readonly _blockEventLastFiredAt = new Map<string, number>();

    // ── Events ──────────────────────────────────────────────────────────

    private readonly _onDidShowIntervention = new vscode.EventEmitter<InterventionDecision>();
    public readonly onDidShowIntervention = this._onDidShowIntervention.event;

    private readonly _onDidDismissIntervention = new vscode.EventEmitter<DismissInterventionPayload>();
    public readonly onDidDismissIntervention = this._onDidDismissIntervention.event;

    private readonly _onDidAcceptIntervention = new vscode.EventEmitter<AcceptInterventionPayload>();
    public readonly onDidAcceptIntervention = this._onDidAcceptIntervention.event;

    private readonly _onDidBlockIntervention = new vscode.EventEmitter<BlockedInterventionPayload>();
    public readonly onDidBlockIntervention = this._onDidBlockIntervention.event;

    constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._statusBarItem.command = 'iris.chatView.focus';
        this._disposables.push(this._statusBarItem);

        this._state = {
            lastInterventionTime: 0,
            sessionInterventionCount: 0,
            lastDismissed: false,
            lastAccepted: false,
        };

        // Register the subtle-accept command. When the status bar is clicked
        // during an active subtle hint, this fires onDidAcceptIntervention and
        // opens Iris Chat.
        //
        // Tests must dispose previous instances before creating a new one;
        // VS Code throws on duplicate command registration and that exception
        // is intentionally surfaced now so test pollution can't silently route
        // status-bar clicks to a stale handler.
        const subtleAcceptCmd = vscode.commands.registerCommand(
            'iris.intervention.acceptSubtle',
            () => this.handleAcceptSubtle(),
        );
        this._disposables.push(subtleAcceptCmd);
    }

    public dispose(): void {
        this._statusBarItem.hide();
        this._statusBarItem.dispose();

        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }

        this._onDidShowIntervention.dispose();
        this._onDidDismissIntervention.dispose();
        this._onDidAcceptIntervention.dispose();
        this._onDidBlockIntervention.dispose();
    }

    // ── Subtle hint ──────────────────────────────────────────────────────

    /**
     * Show subtle hint with EQ context.
     * Sets the status bar command to `iris.intervention.acceptSubtle` so that
     * a click is tracked as an accept event before opening Iris Chat.
     */
    public showSubtleHintEQ(decision: InterventionDecision): void {
        // If there is already an active subtle hint that was never accepted/dismissed,
        // implicitly dismiss it as 'replaced' before showing the new one.
        if (this._currentSubtleDecision !== undefined) {
            this._emitDismiss(this._currentSubtleDecision, 'replaced');
            this._currentSubtleDecision = undefined;
        }

        this._currentSubtleDecision = decision;
        const eqPercent = Math.round(decision.eq * 100);
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = `EQ: ${eqPercent}% — Click to open Iris Chat for assistance`;
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.command = 'iris.intervention.acceptSubtle';
        this._statusBarItem.show();
        this._onDidShowIntervention.fire(decision);
    }

    // ── Notification / proactive interventions ──────────────────────────

    /**
     * Show a notification-level intervention with EQ context.
     */
    public async showNotificationEQ(decision: InterventionDecision): Promise<void> {
        await this._showModalIntervention(decision, 'notification');
    }

    /**
     * Show a proactive-level intervention with EQ context.
     */
    public async showProactiveHelpEQ(decision: InterventionDecision): Promise<void> {
        await this._showModalIntervention(decision, 'proactive');
    }

    /**
     * Shared modal-intervention flow for the notification and proactive levels.
     * The two levels differ only in their status-bar styling, message copy, and
     * dialog kind/labels (selected via `kind`); the cooldown gate, show/record
     * bookkeeping, and accept/dismiss handling are identical and live here.
     */
    private async _showModalIntervention(
        decision: InterventionDecision,
        kind: 'notification' | 'proactive',
    ): Promise<void> {
        if (!this._canIntervene()) {
            // Cooldown blocked a wanted intervention — fire blocked event with cooldown reason.
            this.recordBlockedDecision({
                ...decision,
                blockedReason: 'cooldown',
                shouldIntervene: false,
            });
            return;
        }

        this._recordIntervention();
        this._onDidShowIntervention.fire(decision);

        const eqPercent = Math.round(decision.eq * 100);
        const variant = kind === 'notification'
            ? {
                text: '$(lightbulb) Stuck? Let me help!',
                tooltip: `EQ: ${eqPercent}% — Click to get help from Iris`,
                backgroundColorId: 'statusBarItem.warningBackground',
                message: this._buildNotificationMessageEQ(decision),
                acceptLabel: 'Open Iris Chat',
                prompt: (message: string, acceptLabel: string): Thenable<string | undefined> =>
                    vscode.window.showInformationMessage(message, acceptLabel, 'Not now'),
            }
            : {
                text: '$(warning) Help available!',
                tooltip: `EQ: ${eqPercent}% — Iris detected you might be struggling`,
                backgroundColorId: 'statusBarItem.errorBackground',
                message: this._buildProactiveMessageEQ(decision),
                acceptLabel: 'Get Help Now',
                prompt: (message: string, acceptLabel: string): Thenable<string | undefined> =>
                    vscode.window.showWarningMessage(message, { modal: false }, acceptLabel, 'Later'),
            };

        this._statusBarItem.text = variant.text;
        this._statusBarItem.tooltip = variant.tooltip;
        this._statusBarItem.backgroundColor = new vscode.ThemeColor(variant.backgroundColorId);
        this._statusBarItem.show();

        const result = await variant.prompt(variant.message, variant.acceptLabel);
        await this._handleModalResult(decision, result === variant.acceptLabel);
    }

    /**
     * Handle the user's response to a notification/proactive modal. On accept,
     * record acceptance, fire the accept event, and open Iris Chat; otherwise
     * record the dismissal and emit a 'user-action' dismiss.
     */
    private async _handleModalResult(decision: InterventionDecision, accepted: boolean): Promise<void> {
        if (accepted) {
            this._state.lastAccepted = true;
            this._state.lastDismissed = false;
            this._onDidAcceptIntervention.fire(decision);
            await vscode.commands.executeCommand('iris.chatView.focus');
        } else {
            this._state.lastDismissed = true;
            this._state.lastAccepted = false;
            this._emitDismiss(decision, 'user-action');
        }
    }

    // ── Hint hide ──────────────────────────────────────────────────────

    /**
     * Hide the status bar hint.
     * If a subtle hint was active, fires a dismiss event with reason 'hidden'
     * and resets the status bar command to the default.
     */
    public hideHint(): void {
        if (this._currentSubtleDecision !== undefined) {
            this._emitDismiss(this._currentSubtleDecision, 'hidden');
            this._currentSubtleDecision = undefined;
        }
        this._statusBarItem.command = 'iris.chatView.focus';
        this._statusBarItem.text = '';
        this._statusBarItem.tooltip = undefined;
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.hide();
    }

    // ── Blocked decisions ──────────────────────────────────────────────

    /**
     * Record a decision where `rawWanted=true` but `shouldIntervene=false`.
     * Fires `onDidBlockIntervention` subject to a rate-limit of at most one
     * event per `(triggerType, blockedReason)` combination per
     * `BLOCK_EVENT_RATE_LIMIT_MS` (60 seconds by default).
     */
    public recordBlockedDecision(decision: InterventionDecision): void {
        const key = this._blockRateLimitKey(
            decision.triggerType,
            decision.blockedReason,
        );
        const now = Date.now();
        const lastFired = this._blockEventLastFiredAt.get(key) ?? 0;
        if (now - lastFired < InterventionService.BLOCK_EVENT_RATE_LIMIT_MS) {
            return;
        }
        this._blockEventLastFiredAt.set(key, now);
        this._onDidBlockIntervention.fire({ decision });
    }

    // ── State accessors ────────────────────────────────────────────────

    /**
     * Get current intervention state
     */
    public getState(): InterventionState {
        return { ...this._state };
    }

    // ── Session lifecycle ──────────────────────────────────────────────

    /**
     * SessionResettable — reset intervention state when a new exercise session starts.
     */
    public onSessionStart(_context: SessionStartContext): void {
        this.reset();
    }

    /**
     * Reset intervention state (e.g., for new session)
     */
    public reset(): void {
        // Dismiss any pending subtle hint as 'session-end'
        if (this._currentSubtleDecision !== undefined) {
            this._emitDismiss(this._currentSubtleDecision, 'session-end');
            this._currentSubtleDecision = undefined;
        }
        this._state = {
            lastInterventionTime: 0,
            sessionInterventionCount: 0,
            lastDismissed: false,
            lastAccepted: false,
        };
        this._blockEventLastFiredAt.clear();
        this._statusBarItem.command = 'iris.chatView.focus';
        this._statusBarItem.hide();
    }

    // ── Private helpers ────────────────────────────────────────────────

    /**
     * Handle the `iris.intervention.acceptSubtle` command.
     * Public so it can be tested directly and overridden in subclasses.
     * Fires accept, clears the current subtle decision, resets the status bar
     * command, and opens Iris Chat.
     */
    public handleAcceptSubtle(): void {
        const decision = this._currentSubtleDecision;
        if (decision === undefined) {
            // No active subtle hint — fall back to just opening chat.
            void vscode.commands.executeCommand('iris.chatView.focus');
            return;
        }
        this._currentSubtleDecision = undefined;
        this._state.lastAccepted = true;
        this._state.lastDismissed = false;
        this._statusBarItem.command = 'iris.chatView.focus';
        this._onDidAcceptIntervention.fire(decision);
        void vscode.commands.executeCommand('iris.chatView.focus');
    }

    /**
     * Emit a dismiss event with an explicit reason.
     *
     * Does NOT mutate `_state.lastDismissed` — callers that represent an
     * explicit user dismissal ('Not now' / 'Later') set that flag themselves
     * before calling. Implicit lifecycle dismissals ('replaced', 'hidden',
     * 'session-end') must not flip the flag, because `InterventionFilter`
     * uses `lastDismissed` to block subsequent subtle/notification deliveries.
     */
    private _emitDismiss(decision: InterventionDecision, reason: InterventionDismissReason): void {
        this._onDidDismissIntervention.fire({ ...decision, dismissReason: reason });
    }

    /**
     * Check if we can show a notification/proactive intervention (respecting cooldown).
     */
    private _canIntervene(): boolean {
        const now = Date.now();
        return (now - this._state.lastInterventionTime) >= InterventionService.INTERVENTION_COOLDOWN_MS;
    }

    /**
     * Record that a notification/proactive intervention was shown.
     */
    private _recordIntervention(): void {
        this._state.lastInterventionTime = Date.now();
        this._state.sessionInterventionCount++;
    }

    /**
     * Build a rate-limit map key from trigger type and blocked reason.
     */
    private _blockRateLimitKey(
        triggerType: string | undefined,
        blockedReason: InterventionBlockedReason | undefined,
    ): string {
        return `${triggerType ?? '__none__'}:${blockedReason ?? '__none__'}`;
    }

    /**
     * Build notification message for EQ-based intervention
     */
    private _buildNotificationMessageEQ(decision: InterventionDecision): string {
        if (decision.eq >= InterventionService.EQ_REPEATED_ERRORS_THRESHOLD) {
            return 'You seem to be running into repeated errors. Would you like help from Iris?';
        }
        return 'It looks like you might be stuck. Would you like help from Iris?';
    }

    /**
     * Build proactive message for EQ-based intervention
     */
    private _buildProactiveMessageEQ(decision: InterventionDecision): string {
        if (decision.eq >= InterventionService.EQ_SEVERE_STRUGGLE_THRESHOLD) {
            return "You've been encountering the same errors repeatedly. Let Iris help you work through this!";
        }
        return 'Iris noticed you might be having some difficulty. Want some guidance?';
    }
}
