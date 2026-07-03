import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import type { AnchorLineChange } from '@extension/services/intervention/inlineHint';
import { buildCueText, buildHoverMarkdown, isAnchorDocument, resolveAnchorEditor, shiftAnchorLine } from '@extension/services/intervention/inlineHint';

/** A fake visible TextEditor at `<root>/<relFsPath>`. */
function fakeEditor(rootFsPath: string, relFsPath: string): vscode.TextEditor {
    return {
        document: { uri: { fsPath: `${rootFsPath}/${relFsPath}` } },
    } as unknown as vscode.TextEditor;
}

const root = { fsPath: '/repo' } as unknown as vscode.Uri;

describe('inlineHint helpers', () => {
    it('prefixes the cue with the bulb', () => {
        expect(buildCueText('off-by-one?')).toContain('off-by-one?');
        expect(buildCueText('off-by-one?')).toContain('💡');
    });

    describe('resolveAnchorEditor', () => {
        it('finds the visible editor matched repo-relative to the exercise root', () => {
            const ed = fakeEditor('/repo', 'src/A.java');
            expect(resolveAnchorEditor([ed], 'src/A.java', root)).toBe(ed);
        });
        it('returns undefined for a different file', () => {
            const ed = fakeEditor('/repo', 'src/B.java');
            expect(resolveAnchorEditor([ed], 'src/A.java', root)).toBeUndefined();
        });
    });

    describe('isAnchorDocument', () => {
        it('matches the anchored file repo-relative to the exercise root, no visibility needed', () => {
            const doc = { uri: { fsPath: '/repo/src/A.java' } } as unknown as vscode.TextDocument;
            expect(isAnchorDocument(doc, 'src/A.java', root)).toBe(true);
            expect(isAnchorDocument(doc, 'src/B.java', root)).toBe(false);
        });
    });

    describe('shiftAnchorLine', () => {
        const change = (startLine: number, startChar: number, endLine: number, endChar: number, text: string): AnchorLineChange => ({
            range: { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } },
            text,
        });

        it('shifts down when a line is inserted above', () => {
            // Enter at the end of line 3 (0-based 2) inserts one line above anchor line 10.
            expect(shiftAnchorLine(10, change(2, 5, 2, 5, '\n'))).toBe(11);
        });

        it('shifts up when lines are deleted above', () => {
            // Deleting 0-based lines 2..4 removes two line breaks above anchor line 10.
            expect(shiftAnchorLine(10, change(2, 0, 4, 0, ''))).toBe(8);
        });

        it('treats an insertion at the very start of the anchor line as above (pushes the line down)', () => {
            // Enter at column 0 of the anchor line itself (0-based 9).
            expect(shiftAnchorLine(10, change(9, 0, 9, 0, '\n'))).toBe(11);
        });

        it('ignores edits below the anchor', () => {
            expect(shiftAnchorLine(10, change(15, 0, 15, 0, '\nnew line\n'))).toBe(10);
        });

        it('keeps the anchor when typing on the anchor line itself', () => {
            expect(shiftAnchorLine(10, change(9, 4, 9, 4, 'x'))).toBe(10);
        });

        it('keeps the anchor when the anchor line is split mid-line', () => {
            expect(shiftAnchorLine(10, change(9, 4, 9, 4, '\n'))).toBe(10);
        });

        it('clamps to the edit start line when a deletion swallows the anchor line', () => {
            // Deleting from mid-line 6 (0-based 5) through mid-anchor-line merges the rest into line 6.
            expect(shiftAnchorLine(10, change(5, 3, 9, 2, ''))).toBe(6);
        });

        it('shifts by the net delta of a multi-line replacement above', () => {
            // Replace 0-based lines 1..3 (two breaks removed) with text containing one break.
            expect(shiftAnchorLine(10, change(1, 0, 3, 0, 'a\n'))).toBe(9);
        });
    });

    describe('buildHoverMarkdown', () => {
        it('hover carries Open chat + Hide inline + Dismiss links, trusting ONLY those three commands (not the server hint)', () => {
            const md = buildHoverMarkdown('Look at the loop bound.');
            // Scoped trust: a malicious/injected hint cannot smuggle an executable command: link.
            expect(md.isTrusted).toEqual({ enabledCommands: ['iris.intervention.inlineOpen', 'iris.intervention.inlineHide', 'iris.intervention.inlineDismiss'] });
            expect(md.value).toContain('command:iris.intervention.inlineOpen');
            expect(md.value).toContain('command:iris.intervention.inlineHide');
            expect(md.value).toContain('command:iris.intervention.inlineDismiss');
        });
    });
});
