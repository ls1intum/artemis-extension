import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';

import { buildCueText, buildHoverMarkdown, resolveAnchorEditor } from '@extension/services/intervention/inlineHint';

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
