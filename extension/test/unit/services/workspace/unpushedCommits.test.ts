/**
 * Commits a failed push leaves behind, detected against real repositories: a bare
 * "Artemis" remote and a clone of it with an upstream, as the extension's clone makes.
 * The remote's name contains `-practice-`, so the same clone also exercises the
 * practice fallback of `getWorkspaceStatus`.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getWorkspaceStatus } from '@extension/services/workspace';
import { GitService } from '@extension/services/workspace/gitService';

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd }).toString();
}

suite('Unpushed commits in a real clone', () => {
    let root: string;
    let remote: string;
    let clone: string;
    let folder: vscode.WorkspaceFolder;

    function commitFile(name: string): void {
        fs.writeFileSync(path.join(clone, name), name);
        git(clone, 'add', '-A');
        git(clone, 'commit', '-m', name);
    }

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-unpushed-'));
        remote = path.join(root, 'prog-practice-alice.git');
        const seed = path.join(root, 'seed');
        clone = path.join(root, 'clone');

        execFileSync('git', ['init', '--bare', remote]);
        fs.mkdirSync(seed);
        git(seed, 'init');
        fs.writeFileSync(path.join(seed, 'Main.java'), 'class Main {}');
        git(seed, 'add', '-A');
        git(seed, 'commit', '-m', 'template');
        git(seed, 'push', remote, 'HEAD:refs/heads/main');
        git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
        execFileSync('git', ['clone', remote, clone]);

        folder = { uri: vscode.Uri.file(clone), name: 'clone', index: 0 };
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('a fresh clone has nothing unpushed', async () => {
        assert.strictEqual(await new GitService().hasUnpushedCommits({ cwd: clone }), false);
    });

    test('a commit that was never pushed counts, and stops counting once pushed', async () => {
        commitFile('Fix.java');
        assert.strictEqual(await new GitService().hasUnpushedCommits({ cwd: clone }), true);

        git(clone, 'push');
        assert.strictEqual(await new GitService().hasUnpushedCommits({ cwd: clone }), false);
    });

    test('a detached HEAD counts as nothing unpushed', async () => {
        commitFile('Fix.java');
        git(clone, 'checkout', '--detach');

        assert.strictEqual(await new GitService().hasUnpushedCommits({ cwd: clone }), false);
    });

    test('the workspace status reports it for the repository itself, with a clean tree', async () => {
        commitFile('Fix.java');

        const status = await getWorkspaceStatus(remote, folder);

        assert.strictEqual(status.isConnected, true);
        assert.strictEqual(status.hasChanges, false);
        assert.strictEqual(status.hasUnpushedCommits, true);
    });

    test('the workspace status reports it through the practice fallback too', async () => {
        commitFile('Fix.java');

        const status = await getWorkspaceStatus(remote.replace('-practice-', '-'), folder);

        assert.strictEqual(status.isConnected, true);
        assert.strictEqual(status.isPracticeRepo, true);
        assert.strictEqual(status.hasUnpushedCommits, true);
    });

    test('a pushed clone and a non-matching repository report nothing unpushed', async () => {
        assert.strictEqual((await getWorkspaceStatus(remote, folder)).hasUnpushedCommits, false);

        commitFile('Fix.java');
        const other = await getWorkspaceStatus(path.join(root, 'other-alice.git'), folder);
        assert.strictEqual(other.isConnected, false);
        assert.strictEqual(other.hasUnpushedCommits, false);
    });
});
