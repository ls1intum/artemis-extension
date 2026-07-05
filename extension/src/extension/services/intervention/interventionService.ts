// extension/src/extension/services/intervention/interventionService.ts
import * as vscode from 'vscode';

/**
 * Ambient status-bar lamp for proactive struggle hints (spec R4): a single indicator with three
 * mutually exclusive modes.
 *
 *  - 'parked'   -> a hidden server hint is waiting; clicking pulls it into the Iris chat (spec §5).
 *  - 'fallback' -> the no-AI local template (spec §9); clicking shows the template, no chat bounce.
 *  - 'jump'     -> an active hint carries a code anchor; clicking opens that file at the line so the
 *                  student can find the (otherwise silent / off-screen) inline cue.
 *
 * The item keeps ONE command; {@link handleClick} dispatches by mode. The command is never rebound,
 * so a mode transition can never leave a stale click behaviour on the item.
 *
 * This is a PASSIVE surface: the StruggleInterventionService orchestrator drives it through the
 * showAmbient / showLamp / showJump / clearEpisodeLamp / clearLamp callbacks (see telemetry/index.ts).
 * It is NOT the coordinator's AlertSink and carries no suppression/cadence logic.
 */
const HINT_COMMAND = 'iris.intervention.acceptSubtle';

type LampMode = 'none' | 'parked' | 'fallback' | 'jump';

export class InterventionService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _statusBarItem: vscode.StatusBarItem;

    private _mode: LampMode = 'none';
    private _ambientHint: string | undefined;
    /** Fallback-mode click routing: true -> focus chat, false -> show the local template (spec §9). */
    private _ambientOpensChat = false;
    /** Jump target snapshotted at arm time (absolute Uri + 1-based line); only set in 'jump' mode. */
    private _jumpTarget: { uri: vscode.Uri; line: number } | undefined;

    private readonly _onDidClick = new vscode.EventEmitter<void>();
    /** Fires when the user clicks the status-bar hint (engagement signal for all modes). */
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
    get isHintVisible(): boolean { return this._mode !== 'none'; }

    /** The current lamp mode (test/observability seam). */
    get mode(): LampMode { return this._mode; }

    /**
     * Show the no-AI fallback lamp with a hover hint (spec §9): click shows the template, does NOT
     * bounce to the AI chat. NOT episode-scoped, so {@link clearEpisodeLamp} leaves it standing.
     */
    showAmbient(hint: string, opensChat: boolean): void {
        this._mode = 'fallback';
        this._ambientHint = hint;
        this._ambientOpensChat = opensChat;
        this._jumpTarget = undefined;
        this._statusBarItem.text = '$(lightbulb) Need help?';
        this._statusBarItem.tooltip = hint || 'Iris noticed you might be stuck.';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();
    }

    /**
     * Show the ambient-hint lamp for a PARKED server hint (spec §5 pull model). Clicking reveals the
     * hidden hint into the chat (no per-hint tooltip, since the hint is hidden until pulled).
     */
    showLamp(): void {
        this._mode = 'parked';
        this._ambientHint = undefined;
        this._jumpTarget = undefined;
        this._statusBarItem.text = '$(lightbulb) Iris has a hint';
        this._statusBarItem.tooltip = 'Iris noticed something - click to open the chat.';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();
    }

    /**
     * Show the jump lamp for an active hint that carries a code anchor (spec §4.1). Clicking opens
     * the anchored file at the line so the student can find the inline cue. `uri`/`line` are
     * snapshotted here at arm time, so a later exercise switch cannot retarget the click.
     */
    showJump(uri: vscode.Uri, line: number): void {
        this._mode = 'jump';
        this._ambientHint = undefined;
        this._jumpTarget = { uri, line };
        const base = uri.path.split('/').pop() || uri.path;
        this._statusBarItem.text = `$(arrow-right) Iris: ${base}:${line}`;
        this._statusBarItem.tooltip = 'Jump to the line Iris flagged.';
        this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBarItem.show();
    }

    async handleClick(): Promise<void> {
        const mode = this._mode;
        const hint = this._ambientHint;
        const opensChat = this._ambientOpensChat;
        const jump = this._jumpTarget;
        this._onDidClick.fire();
        this._hide();
        if (mode === 'jump' && jump) {
            await this._openAnchor(jump.uri, jump.line);
        }
        else if (mode === 'fallback') {
            // No-AI fallback (spec §9): opensChat=false shows the local template, does NOT bounce
            // to the AI chat; opensChat=true focuses the chat (kept for contract parity).
            if (opensChat) { await vscode.commands.executeCommand('iris.chatView.focus'); }
            else if (hint) { void vscode.window.showInformationMessage(hint); }
        }
        else if (mode === 'parked') {
            await vscode.commands.executeCommand('iris.chatView.focus');
        }
        // 'none': nothing to do (should not happen — the item is hidden then).
    }

    /** Best-effort open + reveal of the anchored line; a missing file / past-EOF line never throws. */
    private async _openAnchor(uri: vscode.Uri, line: number): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const clamped = Math.max(0, Math.min(line - 1, doc.lineCount - 1));
            const pos = new vscode.Position(clamped, 0);
            await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preserveFocus: false });
        }
        catch { /* divergent working copy / missing file: nothing to reveal, stay silent */ }
    }

    /**
     * Clear the lamp ONLY when it shows an episode-scoped surface ('parked' or 'jump'). A 'fallback'
     * lamp is the degraded-mode affordance and is NOT slot-scoped, so a terminal episode teardown
     * must leave it standing. Called from the orchestrator's per-episode teardown paths.
     */
    clearEpisodeLamp(): void {
        if (this._mode === 'parked' || this._mode === 'jump') { this._hide(); }
    }

    /** Full clear regardless of mode (session change / settings-off / the orchestrator's clearLamp). */
    reset(): void { this._hide(); }

    private _hide(): void {
        this._mode = 'none';
        this._ambientHint = undefined;
        this._ambientOpensChat = false;
        this._jumpTarget = undefined;
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.hide();
    }

    dispose(): void {
        this._hide();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._onDidClick.dispose();
    }
}
