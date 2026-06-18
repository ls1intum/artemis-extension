import * as vscode from 'vscode';
import * as assert from 'assert';

import { BuildErrorCodeLensProvider } from '@extension/provider/buildErrorCodeLensProvider';
import type { ParsedBuildError } from '@extension/types';
import { MockTextDocument } from '@test/unit/mocks/vscodeMocks';

class TestableBuildErrorCodeLensProvider extends BuildErrorCodeLensProvider {
    // Override to avoid dependency on vscode.workspace
    // We assume the document fileName is the relative path for testing
    protected getRelativePath(document: vscode.TextDocument): string | null {
        return document.fileName;
    }

    // Expose for testing if needed, but we override the caller
}

suite('BuildErrorCodeLensProvider Test Suite', () => {
    let provider: TestableBuildErrorCodeLensProvider;

    setup(() => {
        provider = new TestableBuildErrorCodeLensProvider();
    });

    teardown(() => {
        provider.dispose();
    });

    test('should set and retrieve errors for file', () => {
        const errors: ParsedBuildError[] = [
            { filePath: 'src/Main.java', line: 10, message: 'Syntax error' }
        ];

        provider.setErrors('src/Main.java', errors);

        const mockDoc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        const lenses = provider.provideCodeLenses(mockDoc, {} as vscode.CancellationToken) as vscode.CodeLens[];

        assert.strictEqual(lenses.length, 1);
        assert.strictEqual(lenses[0].command?.title, '❌ Artemis Build Error: Syntax error');
        assert.strictEqual(lenses[0].range.start.line, 9); // 0-indexed
    });

    test('should clear all errors', () => {
        const errors: ParsedBuildError[] = [
            { filePath: 'src/Main.java', line: 10, message: 'Error 1' }
        ];

        provider.setErrors('src/Main.java', errors);
        provider.clearErrors();

        const mockDoc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        const lenses = provider.provideCodeLenses(mockDoc, {} as vscode.CancellationToken) as vscode.CodeLens[];

        assert.strictEqual(lenses.length, 0);
    });

    test('should clear errors for specific file', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'Error' }]);
        provider.setErrors('src/Test.java', [{ filePath: 'src/Test.java', line: 5, message: 'Error' }]);

        provider.clearFileErrors('src/Main.java');

        const mockDocMain = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        const lensesMain = provider.provideCodeLenses(mockDocMain, {} as vscode.CancellationToken) as vscode.CodeLens[];
        assert.strictEqual(lensesMain.length, 0);

        const mockDocTest = new MockTextDocument(vscode.Uri.file('/workspace/src/Test.java'), 'src/Test.java');
        const lensesTest = provider.provideCodeLenses(mockDocTest, {} as vscode.CancellationToken) as vscode.CodeLens[];
        assert.strictEqual(lensesTest.length, 1);
    });

    test('should normalize file paths', () => {
        const errors: ParsedBuildError[] = [
            { filePath: 'src\\Main.java', line: 10, message: 'Error' }
        ];

        // Should normalize backslashes
        provider.setErrors('src\\Main.java', errors);

        // Check with forward slash path
        const mockDoc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        const lenses = provider.provideCodeLenses(mockDoc, {} as vscode.CancellationToken) as vscode.CodeLens[];

        assert.strictEqual(lenses.length, 1);
    });

    test('should handle empty file path gracefully', () => {
        provider.setErrors('', [{ filePath: '', line: 1, message: 'Error' }]);
        provider.clearFileErrors('');
        // Should not throw
    });

    function change(
        startLine: number,
        startChar: number,
        endLine: number,
        endChar: number,
        text: string
    ): vscode.TextDocumentContentChangeEvent {
        const range = new vscode.Range(startLine, startChar, endLine, endChar);
        return { range, rangeOffset: 0, rangeLength: 0, text };
    }

    function lineOf(p: TestableBuildErrorCodeLensProvider, fileName: string): number {
        const doc = new MockTextDocument(vscode.Uri.file(`/workspace/${fileName}`), fileName);
        const lenses = p.provideCodeLenses(doc, {} as vscode.CancellationToken) as vscode.CodeLens[];
        return lenses[0].range.start.line; // 0-based
    }

    test('inserting a line above the error shifts the lens down', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'E' }]);
        const doc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        provider.handleDocumentChange(doc, [change(1, 0, 1, 0, '\n')]);
        assert.strictEqual(lineOf(provider, 'src/Main.java'), 10); // was 9, now 10
    });

    test('inserting a line below the error does not move the lens', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'E' }]);
        const doc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        provider.handleDocumentChange(doc, [change(20, 0, 20, 0, '\n')]);
        assert.strictEqual(lineOf(provider, 'src/Main.java'), 9); // unchanged
    });

    test('deleting a line above the error shifts the lens up', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'E' }]);
        const doc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        provider.handleDocumentChange(doc, [change(1, 0, 2, 0, '')]);
        assert.strictEqual(lineOf(provider, 'src/Main.java'), 8); // was 9, now 8
    });

    test('a deletion spanning the error line clamps to the edit start', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'E' }]);
        const doc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        // Half-open (7,0)..(11,0) removes 0-based lines 7,8,9,10; error at 9 is inside -> clamp to 7.
        provider.handleDocumentChange(doc, [change(7, 0, 11, 0, '')]);
        assert.strictEqual(lineOf(provider, 'src/Main.java'), 7);
    });

    test('replacing the line directly above with extra lines shifts down (exclusive end)', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'E' }]);
        const doc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        // Replace 0-based line 8 (half-open (8,0)..(9,0)) with two lines; end==anchor, exclusive -> above -> +1.
        provider.handleDocumentChange(doc, [change(8, 0, 9, 0, 'x\ny\n')]);
        assert.strictEqual(lineOf(provider, 'src/Main.java'), 10); // was 9, now 10
    });

    test('multi-change edit composes order-independently (spanning delete + top insert)', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'E' }]);
        const doc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        // (8,0)..(11,0) deletes lines 8,9,10 -> error at 9 inside -> clamp 8; (0,0) insert "\n" -> above -> +1 => 9.
        provider.handleDocumentChange(doc, [
            change(8, 0, 11, 0, ''),
            change(0, 0, 0, 0, '\n')
        ]);
        assert.strictEqual(lineOf(provider, 'src/Main.java'), 9);
    });

    test('multi-change result is identical when the array order is reversed', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'E' }]);
        const doc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        provider.handleDocumentChange(doc, [
            change(0, 0, 0, 0, '\n'),
            change(8, 0, 11, 0, '')
        ]);
        assert.strictEqual(lineOf(provider, 'src/Main.java'), 9); // same as non-reversed
    });
});
