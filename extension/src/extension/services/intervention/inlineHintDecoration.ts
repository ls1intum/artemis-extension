import * as vscode from 'vscode';

import { buildCueText, buildHoverMarkdown, isAnchorLive, resolveAnchorEditor } from './inlineHint';

/** One in-editor inline cue at a time: gutter Iris logo + after-line hint + whole-line hover (spec §4.1). */
export class InlineHintDecoration implements vscode.Disposable {
    private readonly type: vscode.TextEditorDecorationType;
    /** Ambient (PARKED) decoration: gutter Iris logo only, no after-line text (spec §5 pull model). */
    private readonly _gutterOnlyType: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private current?: { file: string; line: number; hint: string; message: string };
    private _gutterOnlyCurrent?: { file: string; line: number };

    constructor(extensionUri: vscode.Uri, private readonly getExerciseRoot: () => vscode.Uri | undefined) {
        const gutterIconPath = vscode.Uri.joinPath(extensionUri, 'media', 'iris-logo-big-left.png');
        this.type = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            gutterIconPath,
            gutterIconSize: 'contain',
        });
        this._gutterOnlyType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            gutterIconPath,
            gutterIconSize: 'contain',
        });
        this.disposables.push(
            // The student edited either anchored document -> they are acting; retire the cue entirely.
            vscode.workspace.onDidChangeTextDocument(e => {
                const root = this.getExerciseRoot();
                const inlineDoc = this.current && root
                    ? resolveAnchorEditor(vscode.window.visibleTextEditors, this.current.file, root)?.document
                    : undefined;
                const gutterDoc = this._gutterOnlyCurrent && root
                    ? resolveAnchorEditor(vscode.window.visibleTextEditors, this._gutterOnlyCurrent.file, root)?.document
                    : undefined;
                if (inlineDoc === e.document || gutterDoc === e.document) {
                    this.clear();
                }
            }),
            // The set of visible editors changed (tab switch / split).
            vscode.window.onDidChangeVisibleTextEditors(() => this.reapply()),
            // The viewport scrolled (anchor moved in/out of view). NOT covered by onDidChangeVisibleTextEditors.
            vscode.window.onDidChangeTextEditorVisibleRanges(() => this.reapply()),
        );
    }

    show(anchorFile: string, anchorLine: number, inlineHint: string, message: string): void {
        this.current = { file: anchorFile, line: anchorLine, hint: inlineHint, message };
        this._gutterOnlyCurrent = undefined; // exclusive: active surface clears the ambient pointer
        this.reapply();
    }

    /**
     * Ambient (PARKED) surface: gutter Iris logo only, no after-line text (spec §5 pull model).
     * Exclusive with the active {@link show} path: calling this clears any inline cue.
     */
    showGutterOnly(anchorFile: string, anchorLine: number): void {
        this._gutterOnlyCurrent = { file: anchorFile, line: anchorLine };
        this.current = undefined; // exclusive: ambient pointer clears any inline cue
        this.reapply();
    }

    /** Public clear: forget both cue types and remove all their decorations. */
    clear(): void {
        this.current = undefined;
        this._gutterOnlyCurrent = undefined;
        this.removeDecorations();
    }

    private removeDecorations(): void {
        for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(this.type, []);
            ed.setDecorations(this._gutterOnlyType, []);
        }
    }

    /**
     * Redraw whichever surface is active (inline or gutter-only).
     * Only one can be set at a time (the setters enforce mutual exclusivity).
     */
    private reapply(): void {
        this.removeDecorations();
        const root = this.getExerciseRoot();

        // Active path: gutter icon + after-line hint text.
        const c = this.current;
        if (c && root && isAnchorLive(c.file, c.line, vscode.window.visibleTextEditors, root)) {
            const ed = resolveAnchorEditor(vscode.window.visibleTextEditors, c.file, root);
            if (ed) {
                const range = ed.document.lineAt(c.line - 1).range;
                ed.setDecorations(this.type, [{
                    range,
                    renderOptions: { after: { contentText: buildCueText(c.hint), color: '#007fcf', fontWeight: 'bold' } },
                    hoverMessage: buildHoverMarkdown(c.message),
                }]);
            }
        }

        // Ambient path: gutter icon only, no after-line text.
        const g = this._gutterOnlyCurrent;
        if (g && root && isAnchorLive(g.file, g.line, vscode.window.visibleTextEditors, root)) {
            const ed = resolveAnchorEditor(vscode.window.visibleTextEditors, g.file, root);
            if (ed) {
                const range = ed.document.lineAt(g.line - 1).range;
                ed.setDecorations(this._gutterOnlyType, [{ range }]);
            }
        }
    }

    dispose(): void {
        this.clear();
        this.type.dispose();
        this._gutterOnlyType.dispose();
        while (this.disposables.length) { this.disposables.pop()?.dispose(); }
    }
}
