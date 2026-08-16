import * as vscode from 'vscode';
import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LogCategory, logger } from '@extension/services/loggingService';
import { checkWorkspaceFiles, parseGitStatusZ } from '@extension/services/workspace/workspaceFileChecker';

suite('Workspace File Checker Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-test-'));
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

    test('should record the new path for renames and unquoted paths with spaces', async () => {
        execSync('git config user.email "test@example.com"', { cwd: tempDir });
        execSync('git config user.name "Test User"', { cwd: tempDir });

        // Commit a file so it can be renamed
        fs.writeFileSync(path.join(tempDir, 'Original.java'), 'class Original {}');
        execSync('git add Original.java', { cwd: tempDir });
        execSync('git commit -m "initial"', { cwd: tempDir });

        // Staged rename: git status reports "R  Original.java -> Renamed.java"
        execSync('git mv Original.java Renamed.java', { cwd: tempDir });

        // Untracked file whose path contains a space (porcelain quotes it without -z)
        fs.writeFileSync(path.join(tempDir, 'New Helper.java'), 'class NewHelper {}');

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder, { applyFilters: false });
        const paths = result.files.map(f => f.path);

        // Rename records the NEW path, never the "old -> new" arrow form
        assert.ok(paths.includes('Renamed.java'), `expected Renamed.java, got ${JSON.stringify(paths)}`);
        assert.ok(!paths.some(p => p.includes('->')), `arrow path leaked: ${JSON.stringify(paths)}`);
        // Path with a space is recorded raw, without surrounding quotes
        assert.ok(paths.includes('New Helper.java'), `expected unquoted spaced path, got ${JSON.stringify(paths)}`);
        assert.ok(!paths.some(p => p.startsWith('"')), `quoted path leaked: ${JSON.stringify(paths)}`);
    });

    suite('parseGitStatusZ', () => {
        test('returns relative paths for modified and untracked entries', () => {
            const out = ' M src/Foo.java\0?? New.java\0';
            assert.deepStrictEqual(parseGitStatusZ(out), ['src/Foo.java', 'New.java']);
        });

        test('keeps the destination of a rename and drops the source', () => {
            // -z format: "XY <new>\0<old>\0" (new path first, then the original)
            const out = 'R  new/Path.java\0old/Path.java\0';
            assert.deepStrictEqual(parseGitStatusZ(out), ['new/Path.java']);
        });

        test('keeps the destination of a copy and drops the source', () => {
            const out = 'C  copy.java\0orig.java\0';
            assert.deepStrictEqual(parseGitStatusZ(out), ['copy.java']);
        });

        test('keeps paths containing spaces verbatim (no quoting in -z)', () => {
            const out = ' M with space.txt\0?? new file.txt\0';
            assert.deepStrictEqual(parseGitStatusZ(out), ['with space.txt', 'new file.txt']);
        });

        test('stays aligned across consecutive renames', () => {
            const out = 'R  b.java\0a.java\0R  d.java\0c.java\0';
            assert.deepStrictEqual(parseGitStatusZ(out), ['b.java', 'd.java']);
        });

        test('returns an empty array for empty output', () => {
            assert.deepStrictEqual(parseGitStatusZ(''), []);
        });

        test('ignores malformed short fields', () => {
            const out = 'XY\0 M real.java\0';
            assert.deepStrictEqual(parseGitStatusZ(out), ['real.java']);
        });

        test('preserves leading and trailing whitespace in file names', () => {
            // -z carries names verbatim, so leading and trailing spaces must survive
            // (a .trim() on the parsed line would corrupt them).
            const out = '?? trailing .java\0??  leading.java\0';
            assert.deepStrictEqual(parseGitStatusZ(out), ['trailing .java', ' leading.java']);
        });
    });

    test('throwOnGitError propagates a git status failure instead of swallowing it', async () => {
        // Remove the repo so `git status` exits non-zero ("not a git repository"),
        // a deterministic stand-in for any git-status failure (e.g. index.lock).
        fs.rmSync(path.join(tempDir, '.git'), { recursive: true, force: true });

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        await assert.rejects(
            checkWorkspaceFiles(mockFolder, { throwOnGitError: true }),
            'Expected the git status failure to propagate when throwOnGitError is set'
        );
    });

    test('git status failure is swallowed by default so existing callers keep best-effort behaviour', async () => {
        fs.rmSync(path.join(tempDir, '.git'), { recursive: true, force: true });

        const mockFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test',
            index: 0
        };

        const result = await checkWorkspaceFiles(mockFolder);
        assert.strictEqual(result.hasChanges, false);
    });

    test('should include files from unpushed commits', async () => {
        const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-remote-'));

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
