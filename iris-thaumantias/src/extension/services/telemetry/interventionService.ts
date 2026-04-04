import * as vscode from 'vscode';
import { InterventionDecision, InterventionState, SessionResettable, SessionStartContext } from './types';

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

    private readonly _onDidShowIntervention = new vscode.EventEmitter<InterventionDecision>();
    public readonly onDidShowIntervention = this._onDidShowIntervention.event;

    private readonly _onDidDismissIntervention = new vscode.EventEmitter<InterventionDecision>();
    public readonly onDidDismissIntervention = this._onDidDismissIntervention.event;

    private readonly _onDidAcceptIntervention = new vscode.EventEmitter<InterventionDecision>();
    public readonly onDidAcceptIntervention = this._onDidAcceptIntervention.event;

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
    }

    /**
     * Show subtle hint with EQ context
     */
    public showSubtleHintEQ(decision: InterventionDecision): void {
        const eqPercent = Math.round(decision.eq * 100);
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = `EQ: ${eqPercent}% — Click to open Iris Chat for assistance`;
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.show();
        this._onDidShowIntervention.fire(decision);
    }

    /**
     * Show notification-level intervention with EQ context
     */
    public async showNotificationEQ(decision: InterventionDecision): Promise<void> {
        if (!this._canIntervene()) {
            return;
        }

        this._recordIntervention();
        this._onDidShowIntervention.fire(decision);

        const eqPercent = Math.round(decision.eq * 100);
        this._statusBarItem.text = '$(lightbulb) Stuck? Let me help!';
        this._statusBarItem.tooltip = `EQ: ${eqPercent}% — Click to get help from Iris`;
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();

        const message = this._buildNotificationMessageEQ(decision);
        const result = await vscode.window.showInformationMessage(
            message,
            'Open Iris Chat',
            'Not now'
        );

        if (result === 'Open Iris Chat') {
            this._state.lastAccepted = true;
            this._state.lastDismissed = false;
            this._onDidAcceptIntervention.fire(decision);
            await vscode.commands.executeCommand('iris.chatView.focus');
        } else {
            this._state.lastDismissed = true;
            this._state.lastAccepted = false;
            this._onDidDismissIntervention.fire(decision);
        }
    }

    /**
     * Show proactive help with EQ context
     */
    public async showProactiveHelpEQ(decision: InterventionDecision): Promise<void> {
        if (!this._canIntervene()) {
            return;
        }

        this._recordIntervention();
        this._onDidShowIntervention.fire(decision);

        const eqPercent = Math.round(decision.eq * 100);
        this._statusBarItem.text = '$(warning) Help available!';
        this._statusBarItem.tooltip = `EQ: ${eqPercent}% — Iris detected you might be struggling`;
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this._statusBarItem.show();

        const message = this._buildProactiveMessageEQ(decision);
        const result = await vscode.window.showWarningMessage(
            message,
            { modal: false },
            'Get Help Now',
            'Later'
        );

        if (result === 'Get Help Now') {
            this._state.lastAccepted = true;
            this._state.lastDismissed = false;
            this._onDidAcceptIntervention.fire(decision);
            await vscode.commands.executeCommand('iris.chatView.focus');
        } else {
            this._state.lastDismissed = true;
            this._state.lastAccepted = false;
            this._onDidDismissIntervention.fire(decision);
        }
    }

    /**
     * Hide the status bar hint
     */
    public hideHint(): void {
        this._statusBarItem.hide();
    }

    /**
     * Check if we can show an intervention (respecting cooldown)
     */
    private _canIntervene(): boolean {
        const now = Date.now();
        return (now - this._state.lastInterventionTime) >= InterventionService.INTERVENTION_COOLDOWN_MS;
    }

    /**
     * Record that an intervention was shown
     */
    private _recordIntervention(): void {
        this._state.lastInterventionTime = Date.now();
        this._state.sessionInterventionCount++;
    }

    /**
     * Build notification message for EQ-based intervention
     */
    private _buildNotificationMessageEQ(decision: InterventionDecision): string {
        if (decision.eq >= 0.45) {
            return 'You seem to be running into repeated errors. Would you like help from Iris?';
        }
        return 'It looks like you might be stuck. Would you like help from Iris?';
    }

    /**
     * Build proactive message for EQ-based intervention
     */
    private _buildProactiveMessageEQ(decision: InterventionDecision): string {
        if (decision.eq >= 0.8) {
            return "You've been encountering the same errors repeatedly. Let Iris help you work through this!";
        }
        return 'Iris noticed you might be having some difficulty. Want some guidance?';
    }

    /**
     * Get current intervention state
     */
    public getState(): InterventionState {
        return { ...this._state };
    }

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
        this._state = {
            lastInterventionTime: 0,
            sessionInterventionCount: 0,
            lastDismissed: false,
            lastAccepted: false,
        };
        this._statusBarItem.hide();
    }
}
