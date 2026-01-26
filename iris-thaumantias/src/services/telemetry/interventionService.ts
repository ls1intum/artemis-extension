import * as vscode from 'vscode';
import { CombinedStruggleScore, InterventionState, RecommendedAction } from './types';

/**
 * Service that handles UI interventions based on struggle detection.
 * Manages status bar, notifications, and proactive help triggers.
 */
export class InterventionService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _statusBarItem: vscode.StatusBarItem;
    private _state: InterventionState;

    /** Cooldown between interventions (5 minutes) */
    private static readonly INTERVENTION_COOLDOWN_MS = 5 * 60 * 1000;

    private readonly _onDidRequestHelp = new vscode.EventEmitter<CombinedStruggleScore>();
    public readonly onDidRequestHelp = this._onDidRequestHelp.event;

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

        this._onDidRequestHelp.dispose();
    }

    /**
     * Show subtle hint via status bar
     */
    public showSubtleHint(score: CombinedStruggleScore): void {
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = 'Click to open Iris Chat for assistance';
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.show();
    }

    /**
     * Show notification-level intervention
     */
    public async showNotification(score: CombinedStruggleScore): Promise<void> {
        if (!this._canIntervene()) {
            return;
        }

        this._recordIntervention();

        // Update status bar with warning color
        this._statusBarItem.text = '$(lightbulb) Stuck? Let me help!';
        this._statusBarItem.tooltip = 'Click to get help from Iris';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();

        const message = this._buildNotificationMessage(score);
        const result = await vscode.window.showInformationMessage(
            message,
            'Open Iris Chat',
            'Not now'
        );

        if (result === 'Open Iris Chat') {
            this._state.lastAccepted = true;
            this._state.lastDismissed = false;
            await this._openIrisChat(score);
        } else {
            this._state.lastDismissed = true;
            this._state.lastAccepted = false;
        }
    }

    /**
     * Show proactive help intervention
     */
    public async showProactiveHelp(score: CombinedStruggleScore): Promise<void> {
        if (!this._canIntervene()) {
            return;
        }

        this._recordIntervention();

        // Update status bar with error/critical color
        this._statusBarItem.text = '$(warning) Help available!';
        this._statusBarItem.tooltip = 'Iris detected you might be struggling';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this._statusBarItem.show();

        const message = this._buildProactiveMessage(score);
        const result = await vscode.window.showWarningMessage(
            message,
            { modal: false },
            'Get Help Now',
            'Later'
        );

        if (result === 'Get Help Now') {
            this._state.lastAccepted = true;
            this._state.lastDismissed = false;
            await this._openIrisChat(score);
        } else {
            this._state.lastDismissed = true;
            this._state.lastAccepted = false;
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
     * Build notification message based on score
     */
    private _buildNotificationMessage(score: CombinedStruggleScore): string {
        const messages: string[] = [];

        if (score.local.persistentErrors.length > 0) {
            messages.push(`${score.local.persistentErrors.length} error(s) persisting`);
        }

        if (score.server.consecutiveBuildFailures > 0) {
            messages.push(`${score.server.consecutiveBuildFailures} build failure(s)`);
        }

        if (messages.length > 0) {
            return `It looks like you might be stuck: ${messages.join(', ')}. Would you like help?`;
        }

        return 'It looks like you might be stuck. Would you like help from Iris?';
    }

    /**
     * Build proactive message based on score
     */
    private _buildProactiveMessage(score: CombinedStruggleScore): string {
        if (score.local.inactivityPattern === 'giving-up') {
            return "Taking a break? When you're ready, Iris can help you work through this problem.";
        }

        if (score.server.consecutiveBuildFailures >= 3) {
            return `You've had ${score.server.consecutiveBuildFailures} consecutive build failures. Let Iris help diagnose the issue!`;
        }

        if (score.local.persistentErrors.length >= 2) {
            return "You've been working on some persistent errors. Would you like Iris to explain what might be wrong?";
        }

        return 'Iris noticed you might be having some difficulty. Want some guidance?';
    }

    /**
     * Open Iris chat panel
     */
    private async _openIrisChat(score: CombinedStruggleScore): Promise<void> {
        await vscode.commands.executeCommand('iris.chatView.focus');
        this._onDidRequestHelp.fire(score);
    }

    /**
     * Get current intervention state
     */
    public getState(): InterventionState {
        return { ...this._state };
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
