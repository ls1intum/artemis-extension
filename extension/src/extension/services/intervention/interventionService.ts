// extension/src/extension/services/intervention/interventionService.ts
import * as vscode from 'vscode';

/**
 * Ambient status-bar lamp for proactive struggle hints (spec R4): a single
 * "Need help?" indicator. Clicking it opens the Iris chat (or, for the no-AI
 * local-template path, shows the template without bouncing to the AI chat).
 *
 * This is a PASSIVE surface: the StruggleInterventionService orchestrator drives
 * it through the showAmbient / showLamp / reset callbacks (see telemetry/index.ts).
 * It is NOT the coordinator's AlertSink and carries no suppression/cadence logic;
 * the orchestrator and the engine's alert state machine own all of that.
 */
const HINT_COMMAND = 'iris.intervention.acceptSubtle';

export class InterventionService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _statusBarItem: vscode.StatusBarItem;

    private _ambientHint: string | undefined;
    private _ambientOpensChat = true;
    private _ambientVisible = false;

    private readonly _onDidClick = new vscode.EventEmitter<void>();
    /** Fires when the user clicks the status-bar hint. */
    readonly onDidClick = this._onDidClick.event;

    constructor() {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = HINT_COMMAND;
        this._disposables.push(this._statusBarItem);
        this._disposables.push(
            vscode.commands.registerCommand(HINT_COMMAND, () => this.handleClick()),
        );
    }

    /** Whether the lamp is currently showing (test/observability seam). */
    get isHintVisible(): boolean { return this._ambientVisible; }

    /**
     * Show the lamp with a hover hint. {@code opensChat=true} (server hint) -> click focuses the Iris chat;
     * {@code opensChat=false} (no-AI local template, spec §9) -> click shows the template, does NOT bounce to AI chat.
     */
    showAmbient(hint: string, opensChat: boolean): void {
        this._ambientHint = hint;
        this._ambientOpensChat = opensChat;
        this._ambientVisible = true;
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = hint || 'Iris noticed you might be stuck.';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();
    }

    /**
     * Show the ambient-hint lamp for a PARKED server hint (spec §5 pull model).
     * Always shows "Iris has a hint" and clicking opens the chat (no per-hint tooltip text,
     * since the hint is hidden until the student pulls it). Distinct from {@link showAmbient}
     * which is used for the no-AI local-template fallback path.
     */
    showLamp(): void {
        this._ambientVisible = true;
        this._ambientOpensChat = true;
        this._statusBarItem.text = '$(lightbulb) Iris has a hint';
        this._statusBarItem.tooltip = 'Iris noticed something - click to open the chat.';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();
    }

    async handleClick(): Promise<void> {
        const hint = this._ambientHint;
        const opensChat = this._ambientOpensChat;
        this._onDidClick.fire();
        this._hide();
        if (opensChat) {
            await vscode.commands.executeCommand('iris.chatView.focus');
        } else if (hint) {
            void vscode.window.showInformationMessage(hint);
        }
    }

    /** Clear the visible lamp (session change, or the orchestrator's clearLamp callback). */
    reset(): void { this._hide(); }

    private _hide(): void {
        this._ambientVisible = false;
        // Reset the ambient click behavior to the default so a later showLamp/showAmbient
        // cannot read a stale `opensChat=false`/hint from a prior ambient.
        this._ambientHint = undefined;
        this._ambientOpensChat = true;
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.hide();
    }

    dispose(): void {
        this._hide();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._onDidClick.dispose();
    }
}
