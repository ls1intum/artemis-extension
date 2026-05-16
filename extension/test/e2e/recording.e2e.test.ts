/**
 * E2E Test: Session Recorder (VS Code-only)
 *
 * Drives the SessionRecorder through a deterministic sequence of VS Code
 * actions and asserts on EXACT counts and payload content — not just
 * "something was recorded". The goal is to catch real bugs (wrong range,
 * wrong URI, listener removal, off-by-one, stale generation) — not just
 * the "nothing is broken enough to crash" level.
 *
 * Does NOT depend on Artemis or Iris.
 *
 * Run: npm run test:recorder-e2e
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type {
    FileCreateEvent,
    FileDeleteEvent,
    FileRenameEvent,
    FileSnapshotEvent,
    RecordedEvent,
    SaveEvent,
    SelectionChangeEvent,
    SessionEndEvent,
    SessionStartEvent,
    TerminalOpenCloseEvent,
    TextChangeEvent,
} from '@extension/services/telemetry/recording/types';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

suite('Session Recorder — E2E (VS Code only)', function () {
    this.timeout(180_000);

    let workspaceDir: string;
    let storageDir: string;
    let recorder: SessionRecorder | undefined;

    suiteSetup(() => {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-workspace-'));
    });

    suiteTeardown(() => {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    teardown(async () => {
        if (recorder && !(recorder as unknown as { _disposed: boolean })._disposed) {
            try { await recorder.dispose(); } catch { /* best-effort */ }
        }
        recorder = undefined;
        if (storageDir) {
            fs.rmSync(storageDir, { recursive: true, force: true });
            storageDir = '';
        }
    });

    test('captures canonical events with exact counts and real payloads', async () => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        const sessionStartWallclock = Date.now();
        await recorder.startSession(1, 'e2e-test', workspaceUri.toString());

        // Wait for startup phase to complete.
        await sleep(300);

        // ── Action sequence (every action has a matching assertion below) ──

        // 1. Create file A with initial content 'hello\n'.
        const fileA = vscode.Uri.file(path.join(workspaceDir, 'a.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(fileA, { overwrite: true });
            edit.insert(fileA, new vscode.Position(0, 0), 'hello\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'create A applied');
        }
        const docA = await vscode.workspace.openTextDocument(fileA);
        const editorA = await vscode.window.showTextDocument(docA);
        await docA.save();
        await sleep(200);

        // 2. Insert ' world' at line 0 char 5 → file becomes 'hello world\n'.
        const editApplied = await editorA.edit(eb => {
            eb.insert(new vscode.Position(0, 5), ' world');
        });
        assert.ok(editApplied, 'insert " world" applied');
        await sleep(100);
        assert.ok(docA.isDirty, 'docA dirty after insert');

        const saveResult = await docA.save();
        assert.ok(saveResult, 'docA.save() reports success');
        await sleep(200);

        // 3. Selection (0,0)-(0,5) — 'hello'.
        editorA.selection = new vscode.Selection(0, 0, 0, 5);
        await sleep(400); // selection debounce = 200ms

        // 4. Create file B.
        const fileB = vscode.Uri.file(path.join(workspaceDir, 'b.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(fileB, { overwrite: true });
            edit.insert(fileB, new vscode.Position(0, 0), 'other\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'create B applied');
        }
        const docB = await vscode.workspace.openTextDocument(fileB);
        await vscode.window.showTextDocument(docB);
        await sleep(200);

        // 5. Rename A → C.
        const fileC = vscode.Uri.file(path.join(workspaceDir, 'c.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(fileA, fileC, { overwrite: true });
            assert.ok(await vscode.workspace.applyEdit(edit), 'rename A→C applied');
        }
        await sleep(200);

        // 6. Delete B.
        {
            const edit = new vscode.WorkspaceEdit();
            edit.deleteFile(fileB, { ignoreIfNotExists: true });
            assert.ok(await vscode.workspace.applyEdit(edit), 'delete B applied');
        }
        await sleep(200);

        // 7. Terminal: open + close. Terminal close events are not flushed on
        // endSession (observationRegistry only flushes selection/visibleRange
        // debounces), so wait long enough for onDidCloseTerminal to fire while
        // phase is still `recording`.
        const terminal = vscode.window.createTerminal({ name: 'recorder-e2e-term' });
        terminal.show();
        await sleep(300);
        terminal.dispose();
        await sleep(800);

        // ── End session ────────────────────────────────────────────────────
        const sessionEndWallclock = Date.now();
        await recorder.endSession();

        // ── Read JSONL ─────────────────────────────────────────────────────
        const recordingsDir = path.join(storageDir, 'recordings');
        const sessionDirs = fs.readdirSync(recordingsDir).filter(d =>
            fs.statSync(path.join(recordingsDir, d)).isDirectory(),
        );
        assert.strictEqual(sessionDirs.length, 1, 'exactly one session dir');
        const sessionDir = path.join(recordingsDir, sessionDirs[0]);
        const jsonlPath = path.join(sessionDir, 'events.jsonl');

        const raw = fs.readFileSync(jsonlPath, 'utf-8').trim();
        const events: RecordedEvent[] = raw.split('\n').map(l => JSON.parse(l) as RecordedEvent);
        const count = (type: RecordedEvent['type']) => events.filter(e => e.type === type).length;

        // ── Exact-count assertions ─────────────────────────────────────────
        assert.strictEqual(count('sessionStart'), 1, 'exactly 1 sessionStart');
        assert.strictEqual(count('sessionEnd'), 1, 'exactly 1 sessionEnd');
        assert.strictEqual(count('startupPhaseComplete'), 1, 'exactly 1 startupPhaseComplete');
        assert.strictEqual(count('fileCreate'), 2, '2 fileCreate (A + B)');
        assert.strictEqual(count('fileDelete'), 1, '1 fileDelete (B)');
        assert.strictEqual(count('fileRename'), 1, '1 fileRename (A→C)');
        assert.strictEqual(count('terminalOpenClose'), 2, '2 terminalOpenClose (opened + closed)');

        // ── Ordering ───────────────────────────────────────────────────────
        assert.strictEqual(events[0].type, 'sessionStart', 'first event is sessionStart');
        assert.strictEqual(events.at(-1)?.type, 'sessionEnd', 'last event is sessionEnd');

        // ── Session boundary timestamps ────────────────────────────────────
        const sessionStart = events[0] as SessionStartEvent;
        const sessionEnd = events.at(-1) as SessionEndEvent;
        assert.strictEqual(sessionStart.exerciseId, 1, 'sessionStart.exerciseId');
        assert.strictEqual(sessionStart.participantId, 'e2e-test', 'sessionStart.participantId');
        assert.strictEqual(sessionStart.exerciseRoot, workspaceUri.toString(), 'sessionStart.exerciseRoot');
        assert.strictEqual(sessionStart.schemaVersion, 2, 'sessionStart.schemaVersion');
        assert.strictEqual(sessionEnd.exerciseId, 1, 'sessionEnd.exerciseId');
        assert.ok(sessionStart.timestamp >= sessionStartWallclock - 1000, 'sessionStart.timestamp plausible');
        assert.ok(sessionEnd.timestamp <= sessionEndWallclock + 1000, 'sessionEnd.timestamp plausible');

        // ── Timestamp monotonicity (critical invariant) ────────────────────
        for (let i = 1; i < events.length; i++) {
            assert.ok(
                events[i].timestamp >= events[i - 1].timestamp,
                `timestamp regression at event[${i}] (${events[i - 1].type}→${events[i].type}): `
                    + `${events[i - 1].timestamp} → ${events[i].timestamp}`,
            );
        }

        // ── textChange: verify real payload for the ' world' insert ────────
        const textChanges = events.filter((e): e is TextChangeEvent => e.type === 'textChange');
        const worldInsert = textChanges.find(e =>
            e.uri === fileA.toString()
            && e.changes.some(c =>
                c.text === ' world'
                && c.range.startLine === 0
                && c.range.startCharacter === 5
                && c.range.endLine === 0
                && c.range.endCharacter === 5
                && c.rangeLength === 0
                && c.rangeOffset === 5,
            ),
        );
        assert.ok(worldInsert, 'textChange for " world" insert captured with exact payload');

        // ── save: at least one save for fileA MUST follow the " world" insert ─
        // Tighter than "count >= 1": we verify the save semantically follows
        // the edit it was supposed to persist. Catches a listener that fires
        // but on the wrong URI, or a save captured from a different file.
        const saves = events.filter((e): e is SaveEvent => e.type === 'save');
        const worldInsertIdx = events.indexOf(worldInsert);
        const postInsertSaveA = events.slice(worldInsertIdx + 1).find(
            (e): e is SaveEvent => e.type === 'save' && e.uri === fileA.toString(),
        );
        assert.ok(postInsertSaveA, 'save for fileA AFTER " world" insert captured');
        // And all save events must carry real URIs (no blank/malformed).
        for (const s of saves) {
            assert.ok(s.uri.length > 0 && s.uri.startsWith('file:'), `save uri well-formed: ${s.uri}`);
        }

        // ── fileCreate: URIs are fileA and fileB (in either order) ─────────
        const fileCreates = events.filter((e): e is FileCreateEvent => e.type === 'fileCreate');
        assert.deepStrictEqual(
            new Set(fileCreates.map(e => e.uri)),
            new Set([fileA.toString(), fileB.toString()]),
            'fileCreate URIs match A and B',
        );

        // ── fileRename: exact oldUri/newUri ────────────────────────────────
        const fileRenames = events.filter((e): e is FileRenameEvent => e.type === 'fileRename');
        assert.strictEqual(fileRenames[0].oldUri, fileA.toString(), 'rename oldUri = fileA');
        assert.strictEqual(fileRenames[0].newUri, fileC.toString(), 'rename newUri = fileC');

        // ── fileDelete: exact URI ──────────────────────────────────────────
        const fileDeletes = events.filter((e): e is FileDeleteEvent => e.type === 'fileDelete');
        assert.strictEqual(fileDeletes[0].uri, fileB.toString(), 'delete uri = fileB');

        // ── selectionChange: our explicit (0,0)-(0,5) selection is there ───
        const selectionChanges = events.filter((e): e is SelectionChangeEvent => e.type === 'selectionChange');
        const ourSelection = selectionChanges.find(e =>
            e.uri === fileA.toString()
            && e.selections.length === 1
            && e.selections[0].startLine === 0
            && e.selections[0].startCharacter === 0
            && e.selections[0].endLine === 0
            && e.selections[0].endCharacter === 5,
        );
        assert.ok(ourSelection, 'selectionChange (0,0)-(0,5) on fileA captured');

        // ── terminalOpenClose: exact sequence ──────────────────────────────
        const terminalEvents = events.filter((e): e is TerminalOpenCloseEvent => e.type === 'terminalOpenClose');
        assert.deepStrictEqual(
            terminalEvents.map(e => ({ action: e.action, terminalName: e.terminalName })),
            [
                { action: 'opened', terminalName: 'recorder-e2e-term' },
                { action: 'closed', terminalName: 'recorder-e2e-term' },
            ],
            'terminal sequence is exactly opened→closed with matching name',
        );

        // ── Snapshot content verification ──────────────────────────────────
        const fileSnapshots = events.filter((e): e is FileSnapshotEvent => e.type === 'fileSnapshot');
        const snapshotA = fileSnapshots.find(e => e.uri === fileA.toString());
        assert.ok(snapshotA, 'fileSnapshot for fileA recorded');
        const snapshotAAbs = path.join(sessionDir, snapshotA.snapshotPath);
        assert.ok(fs.existsSync(snapshotAAbs), `snapshot file on disk at ${snapshotA.snapshotPath}`);
        const snapshotAContent = fs.readFileSync(snapshotAAbs, 'utf-8');
        assert.strictEqual(snapshotAContent, 'hello\n', 'snapshot of fileA has initial content "hello\\n"');

        // ── Reconstruction: replay textChanges appearing AFTER the fileSnapshot
        // event in JSONL order — this is a conservative cut-point. (Semantic
        // snapshot content is captured SYNC at getText() time but the
        // fileSnapshot event is emitted POST async write; a change in that
        // window can land in both snapshot content AND JSONL. The roundtrip
        // CLI has a separate known bug — it replays ALL textChanges without a
        // cut-point. In this test's deterministic timing, the " world" edit
        // happens well after snapshot-write completes, so index-based works.)
        const snapshotAIdx = events.indexOf(snapshotA);
        const aChangesAfterSnapshot = events
            .slice(snapshotAIdx + 1)
            .filter((e): e is TextChangeEvent => e.type === 'textChange' && e.uri === fileA.toString());
        let reconstructed = snapshotAContent;
        for (const event of aChangesAfterSnapshot) {
            for (const c of event.changes) {
                reconstructed = reconstructed.slice(0, c.rangeOffset) + c.text + reconstructed.slice(c.rangeOffset + c.rangeLength);
            }
        }
        assert.strictEqual(
            reconstructed,
            'hello world\n',
            `replaying post-snapshot textChanges must reconstruct "hello world\\n", got "${reconstructed}"`,
        );

        // ── Metadata ───────────────────────────────────────────────────────
        const metaPath = path.join(sessionDir, 'metadata.json');
        const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
            schemaVersion: number;
            sessionId: string;
            exerciseId: number;
            participantId: string | undefined;
            eventCount: number;
            startTime: number;
            endTime: number | undefined;
        };
        assert.strictEqual(metadata.schemaVersion, 2, 'metadata.schemaVersion');
        assert.strictEqual(metadata.exerciseId, 1, 'metadata.exerciseId');
        assert.strictEqual(metadata.participantId, 'e2e-test', 'metadata.participantId');
        assert.strictEqual(metadata.sessionId, sessionDirs[0], 'metadata.sessionId matches dir name');
        // eventCount is decremented on disable-discard only, so it should match the jsonl exactly here.
        assert.strictEqual(metadata.eventCount, events.length, 'metadata.eventCount matches jsonl lines');
        assert.ok(metadata.endTime !== undefined && metadata.endTime >= metadata.startTime, 'endTime >= startTime');

        // ── CLI validation ─────────────────────────────────────────────────
        runCliCheck('validate-recording', sessionDir);
        runCliCheck('roundtrip-recording', sessionDir);

        // ── Negative: post-endSession actions must not produce new events ──
        const eventCountBeforePost = events.length;
        const fileD = vscode.Uri.file(path.join(workspaceDir, 'd.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(fileD, { overwrite: true });
            edit.insert(fileD, new vscode.Position(0, 0), 'post-end\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'post-end create applied');
        }
        const postDoc = await vscode.workspace.openTextDocument(fileD);
        await vscode.window.showTextDocument(postDoc);
        await sleep(500);

        const rawAfter = fs.readFileSync(jsonlPath, 'utf-8').trim();
        const eventsAfter = rawAfter.split('\n').map(l => JSON.parse(l) as RecordedEvent);
        assert.strictEqual(
            eventsAfter.length,
            eventCountBeforePost,
            `no events recorded after endSession (was ${eventCountBeforePost}, now ${eventsAfter.length})`,
        );

        // Cleanup the post-end probe file so suite teardown workspace stays clean.
        try {
            await vscode.workspace.fs.delete(fileD);
        } catch { /* ignore */ }
    });

    test('after disable(), subsequent VS Code events are not recorded', async () => {
        // Strong negative: exercise the real enable→start→end→disable FSM path.
        // Bugs this catches that a "never-enabled" test could not:
        //   - Listeners that stay registered after disable()
        //   - Session created after disable() (phase gate broken)
        //   - New textChange/save events written to the ended session's JSONL
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-disabled-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(2, 'negative-test', workspaceUri.toString());
        await sleep(200);

        // Record at least one real event so the session dir is definitely
        // committed and we can compare JSONL line count later.
        const probe = vscode.Uri.file(path.join(workspaceDir, 'probe-negative.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(probe, { overwrite: true });
            edit.insert(probe, new vscode.Position(0, 0), 'before-disable\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'probe create applied');
        }
        await sleep(200);

        await recorder.endSession();
        recorder.disable();
        await sleep(100);

        // Snapshot JSONL state pre-action.
        const recordingsDir = path.join(storageDir, 'recordings');
        const sessionDirs = fs.readdirSync(recordingsDir).filter(d =>
            fs.statSync(path.join(recordingsDir, d)).isDirectory(),
        );
        assert.strictEqual(sessionDirs.length, 1, 'one session dir from the pre-disable run');
        const jsonlPath = path.join(recordingsDir, sessionDirs[0], 'events.jsonl');
        const lineCountBefore = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').length;

        // Fire events that WOULD have been recorded.
        {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(probe, new vscode.Position(0, 0), 'AFTER-DISABLE-');
            assert.ok(await vscode.workspace.applyEdit(edit), 'post-disable edit applied');
        }
        const probeDoc = await vscode.workspace.openTextDocument(probe);
        await probeDoc.save();
        await sleep(400);

        // JSONL must not grow, no new session dir must appear.
        const lineCountAfter = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').length;
        assert.strictEqual(lineCountAfter, lineCountBefore, 'JSONL did not grow after disable()');
        const sessionDirsAfter = fs.readdirSync(recordingsDir).filter(d =>
            fs.statSync(path.join(recordingsDir, d)).isDirectory(),
        );
        assert.strictEqual(sessionDirsAfter.length, 1, 'no new session dir created after disable()');

        try { await vscode.workspace.fs.delete(probe); } catch { /* ignore */ }
    });

    test('re-used recorder with disable/enable cycle: two sessions stay isolated and listeners do not leak', async () => {
        // Catches listener-lifetime bugs in two places:
        //   1. Between two sessions on the SAME enabled instance (no duplicate
        //      subscriptions, no bleed between sessions).
        //   2. Across a disable()→enable() cycle (subscriptions are enable-scoped,
        //      so consent-downgrade-then-upgrade could leave stale handlers if
        //      disposal is incomplete).
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-reuse-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();

        // ── Session 1 ──────────────────────────────────────────────────────
        await recorder.startSession(10, 'session-1', workspaceUri.toString());
        await sleep(200);
        const file1 = vscode.Uri.file(path.join(workspaceDir, 'reuse-1.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(file1, { overwrite: true });
            edit.insert(file1, new vscode.Position(0, 0), 'session-1\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'session-1 create applied');
        }
        await sleep(200);
        await recorder.endSession();

        // ── Consent-cycle boundary: disable + re-enable on same instance ──
        // If disable()'s listener teardown is incomplete, enable() will
        // double-register and session 2 will show duplicate events (caught
        // by the "no duplicate fileCreate" assertion below).
        recorder.disable();
        await sleep(100);

        // Fire events between disable and re-enable. These MUST NOT land in
        // any JSONL (no session is active anyway).
        const leakProbe = vscode.Uri.file(path.join(workspaceDir, 'leak-probe.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(leakProbe, { overwrite: true });
            assert.ok(await vscode.workspace.applyEdit(edit), 'leak probe created');
        }
        await sleep(200);

        recorder.enable();
        await sleep(100);

        // ── Session 2 ──────────────────────────────────────────────────────
        await recorder.startSession(20, 'session-2', workspaceUri.toString());
        await sleep(200);
        const file2 = vscode.Uri.file(path.join(workspaceDir, 'reuse-2.txt'));
        {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(file2, { overwrite: true });
            edit.insert(file2, new vscode.Position(0, 0), 'session-2\n');
            assert.ok(await vscode.workspace.applyEdit(edit), 'session-2 create applied');
        }
        await sleep(200);
        await recorder.endSession();

        // ── Verify two distinct sessions with correctly attributed events ─
        const recordingsDir = path.join(storageDir, 'recordings');
        const sessionDirs = fs.readdirSync(recordingsDir)
            .filter(d => fs.statSync(path.join(recordingsDir, d)).isDirectory())
            .sort(); // deterministic order
        assert.strictEqual(sessionDirs.length, 2, 'exactly two session dirs');

        const readEvents = (dir: string): RecordedEvent[] =>
            fs.readFileSync(path.join(recordingsDir, dir, 'events.jsonl'), 'utf-8')
                .trim().split('\n').map(l => JSON.parse(l) as RecordedEvent);

        // Attribute sessions by their metadata (sort order is unstable across
        // filesystems — session IDs are ULIDs, so we identify by exerciseId).
        const metaOf = (dir: string) => JSON.parse(
            fs.readFileSync(path.join(recordingsDir, dir, 'metadata.json'), 'utf-8'),
        ) as { exerciseId: number; participantId: string | undefined };

        const s1Dir = sessionDirs.find(d => metaOf(d).exerciseId === 10);
        const s2Dir = sessionDirs.find(d => metaOf(d).exerciseId === 20);
        assert.ok(s1Dir, 'session 1 dir identified');
        assert.ok(s2Dir, 'session 2 dir identified');
        assert.notStrictEqual(s1Dir, s2Dir, 'session dirs are distinct');

        assert.strictEqual(metaOf(s1Dir).participantId, 'session-1', 's1 participantId');
        assert.strictEqual(metaOf(s2Dir).participantId, 'session-2', 's2 participantId');

        // Session 1 must contain fileCreate for file1, NOT for file2.
        const s1Events = readEvents(s1Dir);
        const s2Events = readEvents(s2Dir);
        const s1CreateURIs = s1Events.filter((e): e is FileCreateEvent => e.type === 'fileCreate').map(e => e.uri);
        const s2CreateURIs = s2Events.filter((e): e is FileCreateEvent => e.type === 'fileCreate').map(e => e.uri);
        assert.ok(s1CreateURIs.includes(file1.toString()), 's1 has fileCreate for file1');
        assert.ok(!s1CreateURIs.includes(file2.toString()), 's1 does NOT have fileCreate for file2');
        assert.ok(s2CreateURIs.includes(file2.toString()), 's2 has fileCreate for file2');
        assert.ok(!s2CreateURIs.includes(file1.toString()), 's2 does NOT have fileCreate for file1');

        // Listener-duplication check: if listeners got registered twice across
        // sessions, we'd see duplicate fileCreate events for the SAME uri in
        // the SAME session. (WorkspaceEdit.createFile fires onDidCreateFiles
        // exactly once per call.)
        assert.strictEqual(
            s1CreateURIs.filter(u => u === file1.toString()).length, 1,
            'file1 fileCreate is not duplicated (listener registered once)',
        );
        assert.strictEqual(
            s2CreateURIs.filter(u => u === file2.toString()).length, 1,
            'file2 fileCreate is not duplicated (listener registered once)',
        );

        // ── Leak check: the file created between disable and enable must
        // not appear in EITHER session's JSONL. If disable() leaves stale
        // listeners, leakProbe's fileCreate would be recorded.
        const allCreateURIs = [...s1CreateURIs, ...s2CreateURIs];
        assert.ok(
            !allCreateURIs.includes(leakProbe.toString()),
            `leak-probe fileCreate must not appear in any session (found in: ${allCreateURIs.filter(u => u === leakProbe.toString())})`,
        );

        try { await vscode.workspace.fs.delete(file1); } catch { /* ignore */ }
        try { await vscode.workspace.fs.delete(file2); } catch { /* ignore */ }
        try { await vscode.workspace.fs.delete(leakProbe); } catch { /* ignore */ }
    });
});

/**
 * Run a recorder CLI script against the session directory and fail the
 * test if the script exits non-zero.
 */
function runCliCheck(script: 'validate-recording' | 'roundtrip-recording', sessionDir: string): void {
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
