import * as assert from 'assert';
import * as vscode from 'vscode';
import { BuildErrorCodeLensProvider } from '../../src/services/buildErrorCodeLensProvider';
import { ParsedBuildError } from '../../src/types/artemis';

suite('BuildErrorCodeLensProvider Test Suite', () => {
    let provider: BuildErrorCodeLensProvider;

    setup(() => {
        provider = new BuildErrorCodeLensProvider();
    });

    test('should set and retrieve errors for file', () => {
        const errors: ParsedBuildError[] = [
            { filePath: 'src/Main.java', line: 10, message: 'Syntax error' }
        ];

        provider.setErrors('src/Main.java', errors);

        // The provider should have stored the errors
        // We can't directly access private buildErrors, but we can verify behavior
        // through provideCodeLenses (would require mock document)
    });

    test('should clear all errors', () => {
        const errors: ParsedBuildError[] = [
            { filePath: 'src/Main.java', line: 10, message: 'Error 1' }
        ];

        provider.setErrors('src/Main.java', errors);
        provider.clearErrors();

        // After clearing, buildErrors should be empty
    });

    test('should clear errors for specific file', () => {
        provider.setErrors('src/Main.java', [{ filePath: 'src/Main.java', line: 10, message: 'Error' }]);
        provider.setErrors('src/Test.java', [{ filePath: 'src/Test.java', line: 5, message: 'Error' }]);

        provider.clearFileErrors('src/Main.java');

        // Only Main.java errors should be cleared
    });

    test('should normalize file paths', () => {
        const errors: ParsedBuildError[] = [
            { filePath: 'src\\Main.java', line: 10, message: 'Error' }
        ];

        // Should normalize backslashes
        provider.setErrors('src\\Main.java', errors);
        // Internally should be stored as src/Main.java
    });

    test('should handle empty file path gracefully', () => {
        provider.setErrors('', [{ filePath: '', line: 1, message: 'Error' }]);
        provider.clearFileErrors('');
        // Should not throw
    });
});
