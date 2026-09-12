import { describe, expect, it } from 'vitest';

import { shouldRecordUri } from '@extension/services/sensing/uriFilter';

import { makeDocument, makeEditor, makeUri } from './fakeVscode';

const FILE_URI = 'file:///Users/x/exercise/src/Foo.java';

describe('makeUri', () => {
    it('produces a URI that passes shouldRecordUri for a normal workspace file', () => {
        expect(shouldRecordUri(makeUri(FILE_URI))).toBe(true);
    });

    it('round-trips scheme, fsPath, path and toString sensibly', () => {
        const uri = makeUri(FILE_URI);
        expect(uri.scheme).toBe('file');
        expect(uri.path).toBe('/Users/x/exercise/src/Foo.java');
        expect(uri.fsPath).toBe('/Users/x/exercise/src/Foo.java');
        expect(uri.toString()).toBe(FILE_URI);
    });

    it('respects exerciseRoot scoping through shouldRecordUri', () => {
        const root = makeUri('file:///Users/x/exercise');
        expect(shouldRecordUri(makeUri(FILE_URI), root)).toBe(true);
        // Prefix-bug guard: /exercise10 must not match root /exercise.
        expect(shouldRecordUri(makeUri('file:///Users/x/exercise10/Foo.java'), root)).toBe(false);
    });

    it('rejects non-file schemes via shouldRecordUri', () => {
        expect(shouldRecordUri(makeUri('git:///Users/x/exercise/src/Foo.java'))).toBe(false);
    });
});

describe('makeDocument', () => {
    it('exposes the uri and a getText() returning the supplied text', () => {
        const uri = makeUri(FILE_URI);
        const doc = makeDocument(uri, () => 'hello world');
        expect(doc.uri).toBe(uri);
        expect(doc.getText()).toBe('hello world');
    });

    it('reflects later text changes through the getText closure', () => {
        const uri = makeUri(FILE_URI);
        let text = 'before';
        const doc = makeDocument(uri, () => text);
        expect(doc.getText()).toBe('before');
        text = 'after';
        expect(doc.getText()).toBe('after');
    });
});

describe('makeEditor', () => {
    it('exposes document.uri and selection end lines', () => {
        const uri = makeUri(FILE_URI);
        const editor = makeEditor(uri, [{ end: { line: 7 } }]);
        expect(editor.document.uri).toBe(uri);
        expect(editor.selections[0].end.line).toBe(7);
        expect(editor.visibleRanges).toEqual([]);
    });

    it('carries supplied visibleRanges', () => {
        const uri = makeUri(FILE_URI);
        const editor = makeEditor(uri, [{ end: { line: 0 } }], [{ start: { line: 2 }, end: { line: 40 } }]);
        expect(editor.visibleRanges[0].start.line).toBe(2);
        expect(editor.visibleRanges[0].end.line).toBe(40);
    });
});
