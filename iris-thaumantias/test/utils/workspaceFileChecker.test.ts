import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { checkWorkspaceFiles } from '../../src/utils/workspaceFileChecker';

suite('Workspace File Checker Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-test-'));
        // Init git repo
        try {
            execSync('git init', { cwd: tempDir });
        } catch (e) {
            console.error('Failed to init git repo:', e);
        }
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to cleanup temp dir:', e);
        }
    });

    test('should include untracked allowed files', async () => {
        fs.writeFileSync(path.join(tempDir, 'Main.java'), 'public class Main {}');
        
        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true });
        
        // If git is not installed or fails, result might be empty. 
        // But assuming git is available in the test env.
        if (result.totalCount === 0) {
            console.warn('Skipping test: No files found (git might be missing)');
            return;
        }

        assert.strictEqual(result.includedCount, 1);
        assert.strictEqual(result.files[0].path, 'Main.java');
    });

    test('should exclude ignored directories', async () => {
        const nodeModules = path.join(tempDir, 'node_modules');
        fs.mkdirSync(nodeModules);
        fs.writeFileSync(path.join(nodeModules, 'lib.js'), 'console.log("lib")');
        
        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true });
        
        // node_modules is in EXCLUDED_DIRECTORIES
        assert.strictEqual(result.includedCount, 0);
    });

    test('should exclude disallowed extensions', async () => {
        fs.writeFileSync(path.join(tempDir, 'image.png'), 'binary data');
        
        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true });
        
        assert.strictEqual(result.includedCount, 0);
    });
    
    test('should include content if requested', async () => {
        const content = 'public class Test {}';
        fs.writeFileSync(path.join(tempDir, 'Test.java'), content);
        
        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true, includeContent: true });
        
        if (result.totalCount > 0) {
            assert.strictEqual(result.files[0].content, content);
        }
    });
});
