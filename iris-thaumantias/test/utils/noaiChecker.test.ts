import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { hasNoAiFile } from '../../src/utils/noaiChecker';

suite('NoAI Checker Test Suite', () => {
    let testWorkspacePath: string;

    setup(() => {
        // Create a test workspace path
        testWorkspacePath = path.join(__dirname, '../../../test-workspace');
        if (!fs.existsSync(testWorkspacePath)) {
            fs.mkdirSync(testWorkspacePath, { recursive: true });
        }
    });

    teardown(() => {
        // Clean up test files and directory
        const noaiPath = path.join(testWorkspacePath, '.noai');
        if (fs.existsSync(noaiPath)) {
            fs.unlinkSync(noaiPath);
        }
        if (fs.existsSync(testWorkspacePath)) {
            fs.rmdirSync(testWorkspacePath, { recursive: true });
        }
    });

    test('hasNoAiFile should return false when .noai file does not exist', async () => {
        const workspaceFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(testWorkspacePath),
            name: 'test-workspace',
            index: 0
        };

        const result = await hasNoAiFile(workspaceFolder);
        assert.strictEqual(result, false, '.noai file should not exist');
    });

    test('hasNoAiFile should return true when .noai file exists', async () => {
        const noaiPath = path.join(testWorkspacePath, '.noai');
        fs.writeFileSync(noaiPath, '');

        const workspaceFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(testWorkspacePath),
            name: 'test-workspace',
            index: 0
        };

        const result = await hasNoAiFile(workspaceFolder);
        assert.strictEqual(result, true, '.noai file should exist');
    });

    test('hasNoAiFile should return false when no workspace folder is provided', async () => {
        const result = await hasNoAiFile(undefined);
        assert.strictEqual(result, false, 'should return false with no workspace');
    });
});
