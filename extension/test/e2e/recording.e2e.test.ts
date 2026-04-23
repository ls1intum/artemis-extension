/**
 * E2E Test: Session Recorder (VS Code-only)
 *
 * Drives the SessionRecorder through a deterministic sequence of VS Code
 * actions (text edits, saves, file ops, selections, terminal) and asserts
 * that the on-disk JSONL captures the expected event types.
 *
 * Does NOT depend on Artemis or Iris — everything happens inside the
 * extension host and a temporary workspace directory.
 *
 * Run: npm run test:e2e  (uses label "e2e" in .vscode-test.mjs)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as vscode from 'vscode';

import { SessionRecorder } from '../../src/extension/services/telemetry/recording/sessionRecorder';
import type { RecordedEvent } from '../../src/extension/services/telemetry/recording/types';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

suite('Session Recorder — E2E (VS Code only)', function () {
    this.timeout(180_000);

    let storageDir: string;
    let workspaceDir: string;
    let recorder: SessionRecorder;

    suiteSetup(() => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-workspace-'));
    });

    suiteTeardown(async () => {
        try {
            if (recorder && !(recorder as unknown as { _disposed: boolean })._disposed) {
                await recorder.dispose();
            }
        } catch {
            // best-effort cleanup
        }
        fs.rmSync(storageDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    test('records canonical event types across a typical editing session', async () => {
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(1, 'e2e-test', workspaceUri.toString());

        // Wait for startup phase to complete before first action.
        await sleep(300);

        // --- Action 1: create file A via WorkspaceEdit (fires fileCreate) ---
        const fileA = vscode.Uri.file(path.join(workspaceDir, 'a.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(fileA, { overwrite: true });
            edit.insert(fileA, new vscode.Position(0, 0), 'hello\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'createFile edit applied');
        }
        const docA = await vscode.workspace.openTextDocument(fileA);
        const editorA = await vscode.window.showTextDocument(docA);
        await docA.save();
        await sleep(200);

        // --- Action 2: text edit ----------------------------------------
        const editResult = await editorA.edit(eb => {
            eb.insert(new vscode.Position(0, 5), ' world');
        });
        assert.ok(editResult, 'text edit applied');
        await sleep(100);

        // --- Action 3: save (requires dirty doc) -------------------------
        assert.ok(docA.isDirty, 'doc should be dirty before save');
        const saved = await docA.save();
        assert.ok(saved, 'docA.save() returned true');
        await sleep(200);

        // --- Action 4: selection change (debounce 200ms) -----------------
        editorA.selection = new vscode.Selection(0, 0, 0, 5);
        await sleep(400);

        // --- Action 5: create + switch to file B ------------------------
        const fileB = vscode.Uri.file(path.join(workspaceDir, 'b.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(fileB, { overwrite: true });
            edit.insert(fileB, new vscode.Position(0, 0), 'other\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'createFile B applied');
        }
        const docB = await vscode.workspace.openTextDocument(fileB);
        await vscode.window.showTextDocument(docB);
        await sleep(200);

        // --- Action 6: rename A → C via WorkspaceEdit (fires fileRename) --
        const fileC = vscode.Uri.file(path.join(workspaceDir, 'c.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(fileA, fileC, { overwrite: true });
            assert.ok(await vscode.workspace.applyEdit(edit), 'rename applied');
        }
        await sleep(200);

        // --- Action 7: delete B via WorkspaceEdit (fires fileDelete) -----
        {
            const edit = new vscode.WorkspaceEdit();
            edit.deleteFile(fileB, { ignoreIfNotExists: true });
            assert.ok(await vscode.workspace.applyEdit(edit), 'delete applied');
        }
        await sleep(200);

        // --- Action 8: open + close terminal ----------------------------
        const terminal = vscode.window.createTerminal({ name: 'recorder-e2e-term' });
        terminal.show();
        await sleep(200);
        terminal.dispose();
        await sleep(200);

        // --- End session -------------------------------------------------
        await recorder.endSession();

        // --- Read JSONL --------------------------------------------------
        const recordingsDir = path.join(storageDir, 'recordings');
        assert.ok(fs.existsSync(recordingsDir), 'recordings/ directory missing');

        const sessionDirs = fs.readdirSync(recordingsDir).filter(d =>
            fs.statSync(path.join(recordingsDir, d)).isDirectory(),
        );
        assert.strictEqual(sessionDirs.length, 1, `expected 1 session, got ${sessionDirs.length}`);

        const sessionDir = path.join(recordingsDir, sessionDirs[0]);
        const jsonlPath = path.join(sessionDir, 'events.jsonl');
        assert.ok(fs.existsSync(jsonlPath), 'events.jsonl missing');

        const raw = fs.readFileSync(jsonlPath, 'utf-8').trim();
        assert.ok(raw.length > 0, 'events.jsonl is empty');

        const events: RecordedEvent[] = raw.split('\n').map(l => JSON.parse(l) as RecordedEvent);
        const typeCounts = events.reduce<Record<string, number>>((acc, e) => {
            acc[e.type] = (acc[e.type] ?? 0) + 1;
            return acc;
        }, {});

        // Log all captured types for debugging.
        console.log('\n=== Captured event type counts ===');
        for (const [type, count] of Object.entries(typeCounts).sort()) {
            console.log(`  ${type}: ${count}`);
        }
        console.log('==================================\n');

        // --- Assertions: lifecycle --------------------------------------
        assert.strictEqual(events[0].type, 'sessionStart', 'first event is sessionStart');
        assert.strictEqual(events[events.length - 1].type, 'sessionEnd', 'last event is sessionEnd');
        assert.strictEqual(typeCounts.sessionStart, 1, 'exactly one sessionStart');
        assert.strictEqual(typeCounts.sessionEnd, 1, 'exactly one sessionEnd');
        assert.strictEqual(typeCounts.startupPhaseComplete, 1, 'exactly one startupPhaseComplete');

        // --- Assertions: core editing -----------------------------------
        assert.ok((typeCounts.textChange ?? 0) >= 1, `textChange present (got ${typeCounts.textChange ?? 0})`);
        assert.ok((typeCounts.save ?? 0) >= 1, `save present (got ${typeCounts.save ?? 0})`);
        assert.ok((typeCounts.fileSnapshot ?? 0) >= 1, `fileSnapshot present (got ${typeCounts.fileSnapshot ?? 0})`);
        assert.ok((typeCounts.fileSwitch ?? 0) >= 1, `fileSwitch present (got ${typeCounts.fileSwitch ?? 0})`);
        assert.ok((typeCounts.selectionChange ?? 0) >= 1, `selectionChange present (got ${typeCounts.selectionChange ?? 0})`);
        assert.ok((typeCounts.textDocumentOpen ?? 0) >= 1, `textDocumentOpen present (got ${typeCounts.textDocumentOpen ?? 0})`);

        // --- Assertions: workspace file ops -----------------------------
        assert.ok((typeCounts.fileCreate ?? 0) >= 1, `fileCreate present (got ${typeCounts.fileCreate ?? 0})`);
        assert.ok((typeCounts.fileRename ?? 0) >= 1, `fileRename present (got ${typeCounts.fileRename ?? 0})`);
        assert.ok((typeCounts.fileDelete ?? 0) >= 1, `fileDelete present (got ${typeCounts.fileDelete ?? 0})`);

        // --- Assertions: terminal ---------------------------------------
        assert.ok(
            (typeCounts.terminalOpenClose ?? 0) >= 1,
            `terminalOpenClose present (got ${typeCounts.terminalOpenClose ?? 0})`,
        );

        // --- Assertions: metadata ---------------------------------------
        const metaPath = path.join(sessionDir, 'metadata.json');
        assert.ok(fs.existsSync(metaPath), 'metadata.json missing');
        const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
            schemaVersion: number;
            sessionId: string;
            exerciseId: number;
            eventCount: number;
        };
        assert.strictEqual(metadata.schemaVersion, 2, 'schemaVersion is 2');
        assert.strictEqual(metadata.exerciseId, 1, 'exerciseId matches');
        assert.ok(metadata.sessionId.length > 0, 'sessionId is set');
        assert.ok(metadata.eventCount >= events.length - 2, 'eventCount roughly matches jsonl');

        // --- CLI validation ---------------------------------------------
        runCliCheck('validate-recording', sessionDir);
        runCliCheck('roundtrip-recording', sessionDir);
    });
});

/**
 * Run a recorder CLI script against the session directory and fail the
 * test if the script exits non-zero. Runs from the extension root so
 * relative paths in the scripts resolve correctly.
 */
function runCliCheck(script: 'validate-recording' | 'roundtrip-recording', sessionDir: string): void {
    // __dirname at runtime is <extension>/out/test/e2e — go up 3 levels.
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const scriptPath = path.join(extensionRoot, 'scripts', `${script}.ts`);
    const result = spawnSync('npx', ['tsx', scriptPath, sessionDir], {
        cwd: extensionRoot,
        encoding: 'utf-8',
        timeout: 60_000,
    });
    assert.strictEqual(
        result.status,
        0,
        `${script} failed (exit ${result.status}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
}
