import * as vscode from 'vscode';

import { buildCueText, buildHoverMarkdown, isAnchorLive, resolveAnchorEditor } from './inlineHint';

/** One in-editor inline cue at a time: gutter Iris logo + after-line hint + whole-line hover (spec §4.1). */
export class InlineHintDecoration implements vscode.Disposable {
    private readonly type: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private current?: { file: string; line: number; hint: string; message: string };

    constructor(extensionUri: vscode.Uri, private readonly getExerciseRoot: () => vscode.Uri | undefined) {
        this.type = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'iris-logo-big-left.png'),
            gutterIconSize: 'contain',
        });
        this.disposables.push(
            // The student edited the ANCHORED document -> they are acting; retire the cue entirely.
            vscode.workspace.onDidChangeTextDocument(e => {
                const root = this.getExerciseRoot();
                if (this.current && root && resolveAnchorEditor(vscode.window.visibleTextEditors, this.current.file, root)?.document === e.document) {
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
        this.reapply();
    }

    /** Public clear: forget the cue and remove its decorations. */
    clear(): void {
        this.current = undefined;
        this.removeDecorations();
    }

    private removeDecorations(): void {
        for (const ed of vscode.window.visibleTextEditors) {
            ed.setDecorations(this.type, []);
        }
    }

    /** Redraw iff the anchor is live; otherwise remove the rendering but KEEP `current` so a scroll-back redraws. */
    private reapply(): void {
        this.removeDecorations();
        const c = this.current;
        const root = this.getExerciseRoot();
        if (!c || !root || !isAnchorLive(c.file, c.line, vscode.window.visibleTextEditors, root)) {
            return;
        }
        const ed = resolveAnchorEditor(vscode.window.visibleTextEditors, c.file, root);
        if (!ed) {
            return;
        }
        const range = ed.document.lineAt(c.line - 1).range;
        ed.setDecorations(this.type, [{
            range,
            renderOptions: { after: { contentText: buildCueText(c.hint), color: '#007fcf', fontWeight: 'bold' } },
            hoverMessage: buildHoverMarkdown(c.message),
        }]);
    }

    dispose(): void {
        this.clear();
        this.type.dispose();
        while (this.disposables.length) { this.disposables.pop()?.dispose(); }
    }
}
