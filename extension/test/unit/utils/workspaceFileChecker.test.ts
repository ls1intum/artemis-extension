import * as vscode from 'vscode';
import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LogCategory, logger } from '@extension/services/loggingService';
import { checkWorkspaceFiles } from '@extension/services/workspace/workspaceFileChecker';

suite('Workspace File Checker Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-test-'));
        // Init git repo
        try {
            execSync('git init', { cwd: tempDir });
        } catch (e) {
            logger.error('Failed to init git repo', LogCategory.TEST, e);
        }
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            logger.error('Failed to cleanup temp dir', LogCategory.TEST, e);
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

        assert.strictEqual(result.totalCount, 1);
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

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true, includeStatus: true });

        assert.strictEqual(result.totalCount, 1);
        assert.strictEqual(result.includedCount, 0);
        assert.strictEqual(result.excludedCount, 1);
        assert.strictEqual(result.files[0].status, 'excluded');
        assert.ok(result.files[0].reason?.includes('Excluded directory'));
    });

    test('should exclude disallowed extensions', async () => {
        fs.writeFileSync(path.join(tempDir, 'image.png'), 'binary data');

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true, includeStatus: true });

        assert.strictEqual(result.totalCount, 1);
        assert.strictEqual(result.includedCount, 0);
        assert.strictEqual(result.excludedCount, 1);
        assert.strictEqual(result.files[0].reason, 'File type not allowed (.png)');
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

        assert.strictEqual(result.totalCount, 1);
        assert.strictEqual(result.includedCount, 1);
        assert.strictEqual(result.files[0].path, 'Test.java');
        assert.strictEqual(result.files[0].content, content);
    });

    test('should exclude files that exceed size limit', async () => {
        const largeContent = 'x'.repeat(1024 * 1024 + 1); // Just over 1MB
        fs.writeFileSync(path.join(tempDir, 'LargeFile.txt'), largeContent);

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true, includeStatus: true });

        assert.strictEqual(result.totalCount, 1);
        assert.strictEqual(result.includedCount, 0);
        assert.strictEqual(result.excludedCount, 1);
        assert.strictEqual(result.files[0].status, 'excluded');
        assert.ok(result.files[0].reason?.startsWith('File too large'));
    });

    test('should include special files without extensions (e.g., Dockerfile)', async () => {
        fs.writeFileSync(path.join(tempDir, 'Dockerfile'), 'FROM node:18');

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true, includeStatus: true });

        assert.strictEqual(result.totalCount, 1);
        assert.strictEqual(result.includedCount, 1);
        assert.strictEqual(result.excludedCount, 0);
        assert.strictEqual(result.files[0].path, 'Dockerfile');
        assert.strictEqual(result.files[0].status, 'included');
    });

    test('should exclude binary files', async () => {
        const binaryPath = path.join(tempDir, 'Binary.java');
        fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2, 0]));

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true, includeStatus: true });

        assert.strictEqual(result.totalCount, 1);
        assert.strictEqual(result.includedCount, 0);
        assert.strictEqual(result.excludedCount, 1);
        assert.strictEqual(result.files[0].reason, 'Binary file detected');
    });

    test('should include dirty files when includeDirty is enabled', async () => {
        const dirtyFilePath = path.join(tempDir, 'Dirty.java');
        fs.writeFileSync(dirtyFilePath, 'class Dirty {}');

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, {
            applyFilters: true,
            includeDirty: true,
            includeStatus: true,
            dirtyFilesOverride: ['Dirty.java']
        });

        assert.strictEqual(result.totalCount, 1);
        assert.strictEqual(result.includedCount, 1);
        assert.strictEqual(result.files[0].path, 'Dirty.java');
        assert.strictEqual(result.files[0].status, 'included');
    });

    test('should include files from unpushed commits', async () => {
        const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-remote-'));

        // Configure git user for commits
        execSync('git config user.email "test@example.com"', { cwd: tempDir });
        execSync('git config user.name "Test User"', { cwd: tempDir });

        const initialFile = path.join(tempDir, 'Initial.java');
        fs.writeFileSync(initialFile, 'class Initial {}');
        execSync('git add Initial.java', { cwd: tempDir });
        execSync('git commit -m "initial commit"', { cwd: tempDir });

        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tempDir }).toString().trim();
        execSync(`git init --bare ${remoteDir}`, { cwd: tempDir });
        execSync(`git remote add origin ${remoteDir}`, { cwd: tempDir });
        execSync(`git push -u origin ${currentBranch}`, { cwd: tempDir });

        const unpushedPath = path.join(tempDir, 'Unpushed.java');
        fs.writeFileSync(unpushedPath, 'class Unpushed {}');
        execSync('git add Unpushed.java', { cwd: tempDir });
        execSync('git commit -m "unpushed commit"', { cwd: tempDir });

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        try {
            const result = await checkWorkspaceFiles(mockFolder, { applyFilters: true, checkUnpushed: true });

            assert.strictEqual(result.totalCount, 1);
            assert.strictEqual(result.includedCount, 1);
            assert.strictEqual(result.files[0].path, 'Unpushed.java');
        } finally {
            fs.rmSync(remoteDir, { recursive: true, force: true });
        }
    });
});
