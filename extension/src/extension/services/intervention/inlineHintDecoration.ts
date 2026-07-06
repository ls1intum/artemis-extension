import * as vscode from 'vscode';

import { buildCueText, buildHoverMarkdown, isAnchorDocument, resolveAnchorEditor, shiftAnchorLine } from './inlineHint';

/**
 * One in-editor inline cue at a time: gutter Iris logo + after-line hint + whole-line hover
 * (spec §4.1, relaxed). The cue stays armed once shown: it renders whenever the anchored file
 * is a visible editor, and VS Code reveals the decoration naturally when the line scrolls into
 * view. A cue armed while the student looks elsewhere thus appears as soon as they open the file.
 */
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
            // Typing never retires the cue (it clears via hover Hide/Dismiss or the episode's terminal
            // exit). The stored anchor line must still follow edits: VS Code shifts the live decoration
            // itself, but reapply() re-renders from the stored line and must not jump back.
            vscode.workspace.onDidChangeTextDocument(e => {
                const root = this.getExerciseRoot();
                if (!root) {
                    return;
                }
                for (const cur of [this.current, this._gutterOnlyCurrent]) {
                    if (cur && isAnchorDocument(e.document, cur.file, root)) {
                        for (const change of e.contentChanges) {
                            cur.line = shiftAnchorLine(cur.line, change);
                        }
                    }
                }
            }),
            // The set of visible editors changed (tab switch / split): decorate a newly visible anchor.
            vscode.window.onDidChangeVisibleTextEditors(() => this.reapply()),
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

    /** The visible editor showing the anchored file, if the (1-based) anchor line exists in it. */
    private resolveAnchoredLine(file: string, line: number): { editor: vscode.TextEditor; range: vscode.Range } | undefined {
        const root = this.getExerciseRoot();
        if (!root) {
            return undefined;
        }
        const ed = resolveAnchorEditor(vscode.window.visibleTextEditors, file, root);
        // Line-count guard: the server's anchor can point past EOF of the local file (divergent
        // working copy); lineAt would throw.
        if (!ed || line < 1 || line > ed.document.lineCount) {
            return undefined;
        }
        return { editor: ed, range: ed.document.lineAt(line - 1).range };
    }

    /**
     * Redraw whichever surface is armed (inline or gutter-only) on the visible editor showing the
     * anchored file. Off-screen lines are decorated too: the cue simply becomes visible when the
     * student scrolls there. Only one surface can be armed at a time (the setters enforce that).
     */
    private reapply(): void {
        this.removeDecorations();

        // Active path: gutter icon + after-line hint text.
        const c = this.current;
        if (c) {
            const anchored = this.resolveAnchoredLine(c.file, c.line);
            if (anchored) {
                anchored.editor.setDecorations(this.type, [{
                    range: anchored.range,
                    renderOptions: {
                        after: {
                            contentText: buildCueText(c.hint),
                            color: '#eaffff',
                            fontWeight: 'bold',
                            backgroundColor: '#0c6a7c',
                            border: '1px solid #3aa8c1',
                            // Smuggle padding + rounded corners through textDecoration (rendered as inline CSS),
                            // turning the live dynamic hint into a colourful pill without a fixed-width SVG.
                            textDecoration: 'none; padding: 1px 8px; border-radius: 10px;',
                            margin: '0 0 0 1rem',
                        },
                    },
                    hoverMessage: buildHoverMarkdown(c.message),
                }]);
            }
        }

        // Ambient path: gutter icon only, no after-line text.
        const g = this._gutterOnlyCurrent;
        if (g) {
            const anchored = this.resolveAnchoredLine(g.file, g.line);
            if (anchored) {
                anchored.editor.setDecorations(this._gutterOnlyType, [{ range: anchored.range }]);
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
