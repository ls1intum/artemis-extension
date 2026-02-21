import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildErrorCodeLensProvider } from '../../src/provider/buildErrorCodeLensProvider';
import { ParsedBuildError } from '../../src/types/artemis';

import { MockTextDocument } from '../mocks/vscodeMocks';

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

    test('should set and retrieve errors for file', () => {
        const errors: ParsedBuildError[] = [
            new ParsedBuildError('src/Main.java', 10, 'Syntax error')
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
            new ParsedBuildError('src/Main.java', 10, 'Error 1')
        ];

        provider.setErrors('src/Main.java', errors);
        provider.clearErrors();

        const mockDoc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        const lenses = provider.provideCodeLenses(mockDoc, {} as vscode.CancellationToken) as vscode.CodeLens[];

        assert.strictEqual(lenses.length, 0);
    });

    test('should clear errors for specific file', () => {
        provider.setErrors('src/Main.java', [new ParsedBuildError('src/Main.java', 10, 'Error')]);
        provider.setErrors('src/Test.java', [new ParsedBuildError('src/Test.java', 5, 'Error')]);

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
            new ParsedBuildError('src\\Main.java', 10, 'Error')
        ];

        // Should normalize backslashes
        provider.setErrors('src\\Main.java', errors);

        // Check with forward slash path
        const mockDoc = new MockTextDocument(vscode.Uri.file('/workspace/src/Main.java'), 'src/Main.java');
        const lenses = provider.provideCodeLenses(mockDoc, {} as vscode.CancellationToken) as vscode.CodeLens[];

        assert.strictEqual(lenses.length, 1);
    });

    test('should handle empty file path gracefully', () => {
        provider.setErrors('', [new ParsedBuildError('', 1, 'Error')]);
        provider.clearFileErrors('');
        // Should not throw
    });
});
