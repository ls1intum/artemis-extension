import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { hasNoAiFile } from '../../src/utils/noaiChecker';

suite('NoAI Checker Test Suite', () => {
    let testWorkspacePath: string;

    setup(async () => {
        // Create a test workspace path
        testWorkspacePath = path.join(__dirname, '../../../test-workspace');
        await fs.mkdir(testWorkspacePath, { recursive: true });
    });

    teardown(async () => {
        // Clean up test workspace directory
        await fs.rm(testWorkspacePath, { recursive: true, force: true });
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
        await fs.writeFile(noaiPath, '');

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
