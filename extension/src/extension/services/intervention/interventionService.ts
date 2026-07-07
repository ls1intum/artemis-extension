// extension/src/extension/services/intervention/interventionService.ts
import * as vscode from 'vscode';

/**
 * Ambient status-bar lamp for proactive struggle hints (spec R4): a single indicator with two
 * mutually exclusive modes.
 *
 *  - 'parked'   -> a hidden server hint is waiting; clicking pulls it into the Iris chat (spec §5).
 *  - 'jump'     -> an active hint carries a code anchor; clicking opens that file at the line so the
 *                  student can find the (otherwise silent / off-screen) inline cue.
 *
 * The item keeps ONE command; {@link handleClick} dispatches by mode. The command is never rebound,
 * so a mode transition can never leave a stale click behaviour on the item.
 *
 * This is a PASSIVE surface: the StruggleInterventionService orchestrator drives it through the
 * showLamp / showJump / clearEpisodeLamp / clearLamp callbacks (see telemetry/index.ts).
 * It is NOT the coordinator's AlertSink and carries no suppression/cadence logic.
 */
const HINT_COMMAND = 'iris.intervention.acceptSubtle';

/**
 * Dominant blue sampled from the Iris mascot logo (media/iris-logo-big-left.png). Used as the
 * lamp's foreground: VS Code only honours error/warning ThemeColors for a status-bar *background*,
 * so the Iris identity lives in the text/icon colour instead of a coloured pill.
 */
const IRIS_BLUE = '#007fcf';

/**
 * The only "filled" background a status-bar item may wear: VS Code honours just
 * `statusBarItem.errorBackground` and `statusBarItem.warningBackground` for extension items, so the
 * attention flash uses the warning (amber) one. An arbitrary Iris-blue fill is not supported by the API.
 */
const FLASH_BACKGROUND = new vscode.ThemeColor('statusBarItem.warningBackground');

/** How long a fresh jump lamp wears the flash background before it settles to the ambient blue text. */
const FLASH_MS = 15_000;

/**
 * True when a visible editor for `uri` currently shows the (1-based) `line` in its viewport, i.e. the
 * flagged cue is already on screen. Injected into {@link InterventionService} so the flash decision is
 * testable without stubbing the shared VS Code editor state.
 */
function anchorInView(uri: vscode.Uri, line: number): boolean {
    const target = uri.toString();
    const idx = line - 1;
    return vscode.window.visibleTextEditors.some(ed =>
        ed.document.uri.toString() === target
        && ed.visibleRanges.some(r => idx >= r.start.line && idx <= r.end.line));
}

type LampMode = 'none' | 'parked' | 'jump';

export class InterventionService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _statusBarItem: vscode.StatusBarItem;

    private _mode: LampMode = 'none';
    /** Jump target snapshotted at arm time (absolute Uri + 1-based line); only set in 'jump' mode. */
    private _jumpTarget: { uri: vscode.Uri; line: number } | undefined;
    /** Pending "settle the flash background back to normal" timer; cleared on re-flash / hide / dispose. */
    private _flashTimer: ReturnType<typeof setTimeout> | undefined;

    private readonly _onDidClick = new vscode.EventEmitter<void>();
    /** Fires when the user clicks the status-bar hint (engagement signal for all modes). */
    readonly onDidClick = this._onDidClick.event;

    constructor(
        private readonly _flashMs: number = FLASH_MS,
        private readonly _isAnchorInView: (uri: vscode.Uri, line: number) => boolean = anchorInView,
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = HINT_COMMAND;
        this._statusBarItem.color = IRIS_BLUE;
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
     * Show the ambient-hint lamp for a PARKED server hint (spec §5 pull model). Clicking reveals the
     * hidden hint into the chat (no per-hint tooltip, since the hint is hidden until pulled).
     */
    showLamp(): void {
        this._mode = 'parked';
        this._jumpTarget = undefined;
        this._statusBarItem.text = '$(lightbulb) Iris has a hint';
        this._statusBarItem.tooltip = 'Iris noticed something - click to open the chat.';
        this._statusBarItem.show();
    }

    /**
     * Show the jump lamp for an active hint that carries a code anchor (spec §4.1). Clicking opens
     * the anchored file at the line so the student can find the inline cue. `uri`/`line` are
     * snapshotted here at arm time, so a later exercise switch cannot retarget the click.
     */
    showJump(uri: vscode.Uri, line: number): void {
        const wasJump = this._mode === 'jump';
        this._mode = 'jump';
        this._jumpTarget = { uri, line };
        const base = uri.path.split('/').pop() || uri.path;
        this._statusBarItem.text = `$(arrow-right) Iris: ${base}:${line}`;
        this._statusBarItem.tooltip = 'Jump to the line Iris flagged.';
        // A fresh jump lamp flashes amber to draw the eye toward an off-screen cue, then settles to the
        // ambient blue text. Skip the flash when the flagged line is already on screen (nothing to draw
        // the eye to) or when merely re-rendering the same jump.
        if (!wasJump && !this._isAnchorInView(uri, line)) { this._flash(); }
        this._statusBarItem.show();
    }

    /** Wear the warning background for {@link FLASH_MS}, then settle back to the ambient look. */
    private _flash(): void {
        if (this._flashTimer) { clearTimeout(this._flashTimer); }
        this._statusBarItem.backgroundColor = FLASH_BACKGROUND;
        this._flashTimer = setTimeout(() => {
            this._flashTimer = undefined;
            this._statusBarItem.backgroundColor = undefined;
        }, this._flashMs);
    }

    async handleClick(): Promise<void> {
        const mode = this._mode;
        const jump = this._jumpTarget;
        this._onDidClick.fire();
        if (mode === 'jump' && jump) {
            // The jump lamp is a persistent way back to the flagged line: keep it visible on click
            // (it clears on episode teardown) so the student can jump back more than once.
            await this._openAnchor(jump.uri, jump.line);
        }
        else if (mode === 'parked') {
            // Reveal is one-shot: the parked hint moves into the chat, so retire the lamp.
            this._hide();
            await vscode.commands.executeCommand('iris.chatView.focus');
        }
        // 'none': nothing to do (the item is hidden then).
    }

    /**
     * Jump to the armed anchor without going through the click path (no onDidClick, no dismissal): the
     * lamp stays exactly as it is. Lets another surface reuse the jump: the banner's "Show me" button
     * navigates to the flagged line this way. No-op unless a jump target is currently armed.
     */
    revealJumpTarget(): void {
        if (this._mode === 'jump' && this._jumpTarget) {
            void this._openAnchor(this._jumpTarget.uri, this._jumpTarget.line);
        }
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
     * Clear the lamp ONLY when it shows an episode-scoped surface ('parked' or 'jump'). Called from
     * the orchestrator's per-episode teardown paths.
     */
    clearEpisodeLamp(): void {
        if (this._mode === 'parked' || this._mode === 'jump') { this._hide(); }
    }

    /** Full clear regardless of mode (session change / settings-off / the orchestrator's clearLamp). */
    reset(): void { this._hide(); }

    private _hide(): void {
        this._mode = 'none';
        this._jumpTarget = undefined;
        if (this._flashTimer) { clearTimeout(this._flashTimer); this._flashTimer = undefined; }
        this._statusBarItem.backgroundColor = undefined;
        this._statusBarItem.hide();
    }

    dispose(): void {
        this._hide();
        while (this._disposables.length > 0) { this._disposables.pop()?.dispose(); }
        this._onDidClick.dispose();
    }
}
