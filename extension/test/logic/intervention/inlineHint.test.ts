import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import { buildCueText, isAnchorLive, resolveAnchorEditor } from '@extension/services/intervention/inlineHint';

/** A fake visible TextEditor at `<root>/<relFsPath>` whose viewport spans the 0-based line range [firstLine, lastLine]. */
function fakeEditor(rootFsPath: string, relFsPath: string, firstLine: number, lastLine: number): vscode.TextEditor {
    return {
        document: { uri: { fsPath: `${rootFsPath}/${relFsPath}` } },
        visibleRanges: [{ start: { line: firstLine }, end: { line: lastLine } }],
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
            const ed = fakeEditor('/repo', 'src/A.java', 0, 50);
            expect(resolveAnchorEditor([ed], 'src/A.java', root)).toBe(ed);
        });
        it('returns undefined for a different file', () => {
            const ed = fakeEditor('/repo', 'src/B.java', 0, 50);
            expect(resolveAnchorEditor([ed], 'src/A.java', root)).toBeUndefined();
        });
    });

    describe('isAnchorLive', () => {
        it('is live when the file is visible and the 1-based line sits in a visible range', () => {
            const ed = fakeEditor('/repo', 'src/A.java', 30, 60);   // 0-based viewport [30,60] → covers 1-based line 42
            expect(isAnchorLive('src/A.java', 42, [ed], root)).toBe(true);
        });
        it('is not live when the line is scrolled out of view', () => {
            const ed = fakeEditor('/repo', 'src/A.java', 0, 20);
            expect(isAnchorLive('src/A.java', 42, [ed], root)).toBe(false);
        });
        it('is not live for a different visible file', () => {
            const ed = fakeEditor('/repo', 'src/B.java', 0, 60);
            expect(isAnchorLive('src/A.java', 42, [ed], root)).toBe(false);
        });
        it('is not live when the exercise root is undefined', () => {
            const ed = fakeEditor('/repo', 'src/A.java', 0, 60);
            expect(isAnchorLive('src/A.java', 42, [ed], undefined)).toBe(false);
        });
    });
});
