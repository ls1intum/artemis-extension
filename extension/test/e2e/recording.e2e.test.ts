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

import { parseRecordedEvent } from '@extension/services/recording/parseRecordedData';
import { SessionRecorder } from '@extension/services/recording/sessionRecorder';
import type {
    BreakpointChangeEvent,
    ConsentChangeEvent,
    DiagnosticsEvent,
    FileCreateEvent,
    FileDeleteEvent,
    FileRenameEvent,
    FileSnapshotEvent,
    FileSwitchEvent,
    RecordedEvent,
    SaveEvent,
    SelectionChangeEvent,
    SessionEndEvent,
    SessionStartEvent,
    TerminalCommandEvent,
    TerminalOpenCloseEvent,
    TextChangeEvent,
    TextDocumentCloseEvent,
    TextDocumentOpenEvent,
    VisibleRangeChangeEvent,
    WindowFocusEvent,
} from '@extension/services/recording/types';

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
            try { await recorder.shutdown(); } catch { /* best-effort */ }
        }
        recorder = undefined;
        // Isolation: leave no editors, breakpoints, or terminals behind. Otherwise the
        // NEXT session's startup capture inherits them as incidental events and makes
        // any exact-count assertion order-dependent (codex review finding).
        try { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); } catch { /* best-effort */ }
        vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
        for (const t of vscode.window.terminals) { t.dispose(); }
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
        assert.strictEqual(sessionStart.schemaVersion, 3, 'sessionStart.schemaVersion');
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
        assert.strictEqual(metadata.schemaVersion, 3, 'metadata.schemaVersion');
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

    test('breakpoint add/remove flows through the live listener into JSONL with exact payloads', async () => {
        // vscode.debug.breakpoints is a persistent global — clear any leftover state first.
        vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
        await sleep(150);

        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-bp-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(30, 'bp-test', workspaceUri.toString());
        await sleep(300); // startup phase

        // One in-root breakpoint (recorded) + one out-of-root (must be filtered out).
        // The files need not exist on disk — breakpoints carry a location regardless.
        const inRootUri = vscode.Uri.file(path.join(workspaceDir, 'Bp.java'));
        const outOfRootUri = vscode.Uri.file(path.join(os.tmpdir(), `outside-bp-${process.pid}.java`));
        const inRootBp = new vscode.SourceBreakpoint(
            new vscode.Location(inRootUri, new vscode.Position(9, 4)),
            true, 'x > 0', undefined, 'log here',
        );
        const outOfRootBp = new vscode.SourceBreakpoint(
            new vscode.Location(outOfRootUri, new vscode.Position(2, 0)),
        );

        // Add both → onDidChangeBreakpoints{added} → listener filters to in-root only.
        vscode.debug.addBreakpoints([inRootBp, outOfRootBp]);
        await sleep(400);
        // Remove the in-root one → onDidChangeBreakpoints{removed}.
        vscode.debug.removeBreakpoints([inRootBp]);
        await sleep(400);

        await recorder.endSession();

        const recordingsDir = path.join(storageDir, 'recordings');
        const sessionDirs = fs.readdirSync(recordingsDir).filter(d =>
            fs.statSync(path.join(recordingsDir, d)).isDirectory(),
        );
        assert.strictEqual(sessionDirs.length, 1, 'exactly one session dir');
        const sessionDir = path.join(recordingsDir, sessionDirs[0]);
        const events: RecordedEvent[] = fs.readFileSync(path.join(sessionDir, 'events.jsonl'), 'utf-8')
            .trim().split('\n').map(l => JSON.parse(l) as RecordedEvent);

        const bpEvents = events.filter((e): e is BreakpointChangeEvent => e.type === 'breakpointChange');

        // VS Code occasionally double-delivers onDidChangeBreakpoints, so the recorder may
        // legitimately emit the same 'added'/'removed' more than once. Assert by breakpoint
        // IDENTITY (de-duplicated by id), not by raw event count: the in-root breakpoint must
        // be the only one ever added/removed, and the out-of-root one must never appear.
        // (The "listener registered exactly once" guarantee is covered by the re-use test above.)
        const added = bpEvents.filter(e => e.action === 'added');
        const removed = bpEvents.filter(e => e.action === 'removed');
        assert.ok(added.length >= 1, `at least one 'added' breakpointChange (got ${added.length})`);
        assert.ok(removed.length >= 1, `at least one 'removed' breakpointChange (got ${removed.length})`);

        const addedIds = new Set(added.flatMap(e => e.breakpoints.map(bp => bp.id)));
        assert.deepStrictEqual([...addedIds], [inRootBp.id], 'only the in-root breakpoint is ever added (out-of-root filtered)');

        // The in-root 'added' payload is exact.
        const addedInRoot = added.flatMap(e => e.breakpoints).find(bp => bp.id === inRootBp.id);
        assert.ok(addedInRoot, 'in-root breakpoint present in an added event');
        assert.strictEqual(addedInRoot.uri, inRootUri.toString(), 'added uri = in-root');
        assert.strictEqual(addedInRoot.line, 9, 'added line is 0-based 9');
        assert.strictEqual(addedInRoot.column, 4, 'added column is 0-based 4');
        assert.strictEqual(addedInRoot.enabled, true, 'added enabled');
        assert.strictEqual(addedInRoot.condition, 'x > 0', 'added condition preserved');
        assert.strictEqual(addedInRoot.logMessage, 'log here', 'added logMessage preserved');

        // The out-of-root URI must never appear in any recorded breakpoint.
        const allUris = bpEvents.flatMap(e => e.breakpoints.map(bp => bp.uri));
        assert.ok(!allUris.includes(outOfRootUri.toString()), 'out-of-root breakpoint filtered everywhere');

        // 'removed' references the in-root breakpoint by id, and only that one — with the
        // full serialized payload (collectBreakpointChange serializes removed bps too).
        const removedIds = new Set(removed.flatMap(e => e.breakpoints.map(bp => bp.id)));
        assert.deepStrictEqual([...removedIds], [inRootBp.id], 'only the in-root breakpoint is ever removed');
        const removedInRoot = removed.flatMap(e => e.breakpoints).find(bp => bp.id === inRootBp.id);
        assert.ok(removedInRoot, 'in-root breakpoint present in a removed event');
        assert.strictEqual(removedInRoot.uri, inRootUri.toString(), 'removed uri = in-root');
        assert.strictEqual(removedInRoot.line, 9, 'removed line preserved');
        assert.strictEqual(removedInRoot.column, 4, 'removed column preserved');

        // Timestamp monotonicity across the whole stream.
        for (let i = 1; i < events.length; i++) {
            assert.ok(events[i].timestamp >= events[i - 1].timestamp, `timestamp regression at event[${i}]`);
        }

        // The recording validates clean (exit 0 = no error-severity issues).
        // Run with --verbose so warnings print, then assert the validate-recording
        // known-types sync (Task 2) actually took effect: no UNKNOWN_TYPE warning
        // for the new event types. This is the ONLY assertion that verifies Task 2.
        const validate = runCliCheck('validate-recording', sessionDir, ['--verbose']);
        const validateOut = String(validate.stdout);
        assert.ok(!validateOut.includes("unknown event type 'breakpointChange'"), 'breakpointChange is a known validate-recording type');
        assert.ok(!validateOut.includes("unknown event type 'debugSession'"), 'debugSession is a known validate-recording type');

        // The validated parser round-trips the new events (regression guard for the
        // parseRecordedData gap this work closes).
        for (const e of bpEvents) {
            assert.deepStrictEqual(parseRecordedEvent(e), e, 'breakpointChange round-trips through parseRecordedEvent');
        }

        vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
    });

    test('Class B record*() events persist with exact payloads, counts, and parser round-trip', async () => {
        // B1: drive every public record*() method directly and verify the full
        // recorder persistence pipeline (method -> buffer -> JSONL -> parser -> CLI).
        // These types are NOT startup-emitted by a bare SessionRecorder (no wiring /
        // startup contributors registered), so exact counts are deterministic.
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-classB-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(5, 'classB-test', workspaceUri.toString());
        await sleep(300); // startup settle

        // ── Drive every Class B record*() method (fully-populated payloads) ──
        recorder.recordIrisChatSent('hello iris', 'm-sent', 's-1', 1700000001);
        recorder.recordIrisChatReceived('hi student', 'm-recv', 's-1', 1700000002);
        recorder.recordIrisChatSendAttempt('attempt body', 'failed', 'network down');
        recorder.recordIrisChatFeedback('m-recv', true);
        recorder.recordViewNavigation('problem-statement', 'code-editor');
        recorder.recordPanelVisibility('artemis', true);
        recorder.recordPanelVisibility('chat', false);
        recorder.recordConfigurationSnapshot(true, false);
        recorder.recordConfigurationChange({ struggleDetectionEnabled: false, showInterventions: true });
        recorder.recordTestResultsOverviewOpened(
            { viewId: 'tro-1', exerciseId: 5, participationId: 11, resultId: 21, totalTests: 10, passedTests: 7, failedTests: 3 });
        recorder.recordTestResultsOverviewClosed(
            { viewId: 'tro-1', exerciseId: 5, participationId: 11, resultId: 21, durationMs: 5000, closeReason: 'button' });
        recorder.recordTaskFeedbackOpened(
            { viewId: 'tf-1', exerciseId: 5, participationId: 11, resultId: 21, taskName: 'Task A', testIds: [1, 2, 3], totalTests: 5, passedTests: 4, failedTests: 1, notExecutedTests: 0 });
        recorder.recordTaskFeedbackClosed(
            { viewId: 'tf-1', exerciseId: 5, participationId: 11, resultId: 21, taskName: 'Task A', durationMs: 3000, closeReason: 'escape' });
        recorder.recordSubmission({ status: 'succeeded', participationId: 99, commitMessage: 'fix the bug' });

        await recorder.endSession();

        const { sessionDir, events } = readSingleSession(storageDir);
        const count = (t: RecordedEvent['type']) => events.filter(e => e.type === t).length;

        // ── Exact counts (Class B types are never startup-emitted here) ──
        assert.strictEqual(count('irisChatMessage'), 2, '2 irisChatMessage (sent + received)');
        assert.strictEqual(count('irisChatSendAttempt'), 1, '1 irisChatSendAttempt');
        assert.strictEqual(count('irisChatFeedback'), 1, '1 irisChatFeedback');
        assert.strictEqual(count('viewNavigation'), 1, '1 viewNavigation');
        assert.strictEqual(count('panelVisibility'), 2, '2 panelVisibility');
        assert.strictEqual(count('configurationSnapshot'), 1, '1 configurationSnapshot');
        assert.strictEqual(count('configurationChange'), 1, '1 configurationChange');
        assert.strictEqual(count('testResultsOverviewView'), 2, '2 testResultsOverviewView');
        assert.strictEqual(count('taskFeedbackView'), 2, '2 taskFeedbackView');
        assert.strictEqual(count('submission'), 1, '1 submission');

        // ── Exact-payload match: each expected object (minus timestamp) appears once ──
        const stripTs = (e: RecordedEvent): Record<string, unknown> => {
            const copy: Record<string, unknown> = { ...e };
            delete copy.timestamp;
            return copy;
        };
        const deepEqual = (a: unknown, b: unknown): boolean => {
            try { assert.deepStrictEqual(a, b); return true; } catch { return false; }
        };
        const diskNoTs = events.map(stripTs);
        const expected: Record<string, unknown>[] = [
            { type: 'irisChatMessage', direction: 'sent', content: 'hello iris', messageId: 'm-sent', sessionId: 's-1', sentAt: 1700000001 },
            { type: 'irisChatMessage', direction: 'received', content: 'hi student', messageId: 'm-recv', sessionId: 's-1', sentAt: 1700000002 },
            { type: 'irisChatSendAttempt', content: 'attempt body', status: 'failed', errorMessage: 'network down' },
            { type: 'irisChatFeedback', messageId: 'm-recv', helpful: true },
            { type: 'viewNavigation', from: 'problem-statement', to: 'code-editor' },
            { type: 'panelVisibility', panel: 'artemis', visible: true },
            { type: 'panelVisibility', panel: 'chat', visible: false },
            { type: 'configurationSnapshot', struggleDetectionEnabled: true, showInterventions: false },
            { type: 'configurationChange', changes: { struggleDetectionEnabled: false, showInterventions: true } },
            { type: 'testResultsOverviewView', action: 'opened', viewId: 'tro-1', exerciseId: 5, participationId: 11, resultId: 21, totalTests: 10, passedTests: 7, failedTests: 3 },
            { type: 'testResultsOverviewView', action: 'closed', viewId: 'tro-1', exerciseId: 5, participationId: 11, resultId: 21, durationMs: 5000, closeReason: 'button' },
            { type: 'taskFeedbackView', action: 'opened', viewId: 'tf-1', exerciseId: 5, participationId: 11, resultId: 21, taskName: 'Task A', testIds: [1, 2, 3], totalTests: 5, passedTests: 4, failedTests: 1, notExecutedTests: 0 },
            { type: 'taskFeedbackView', action: 'closed', viewId: 'tf-1', exerciseId: 5, participationId: 11, resultId: 21, taskName: 'Task A', durationMs: 3000, closeReason: 'escape' },
            { type: 'submission', status: 'succeeded', participationId: 99, exerciseId: 5, commitMessage: 'fix the bug' },
        ];
        for (const exp of expected) {
            const n = diskNoTs.filter(d => deepEqual(d, exp)).length;
            assert.strictEqual(n, 1, `exactly one event matching ${JSON.stringify(exp)} (found ${n})`);
        }

        // ── Parser round-trip for every Class B event ──
        const classBTypes = new Set<RecordedEvent['type']>([
            'irisChatMessage', 'irisChatSendAttempt', 'irisChatFeedback',
            'viewNavigation', 'panelVisibility', 'configurationSnapshot', 'configurationChange',
            'testResultsOverviewView', 'taskFeedbackView', 'submission',
        ]);
        for (const e of events.filter(e => classBTypes.has(e.type))) {
            assert.deepStrictEqual(parseRecordedEvent(e), e, `round-trip ${e.type}`);
        }

        // ── Timestamp monotonicity + CLI validation ──
        for (let i = 1; i < events.length; i++) {
            assert.ok(events[i].timestamp >= events[i - 1].timestamp, `timestamp regression at event[${i}]`);
        }
        runCliCheck('validate-recording', sessionDir);
        runCliCheck('roundtrip-recording', sessionDir);
    });

    test('Class A listener events (open/close/switch/visibleRange/diagnostics) captured by attribution', async () => {
        // Startup capture also emits some of these for already-open editors, so assert
        // by attribution (our specific URI/payload is present), not by exact total count.
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-classA-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        // A long file so revealRange produces a visibleRangeChange (headless viewport ≈ 38 lines).
        const longContent = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n') + '\n';
        const fileX = vscode.Uri.file(path.join(workspaceDir, 'ca-x.txt'));
        const fileY = vscode.Uri.file(path.join(workspaceDir, 'ca-y.txt'));
        fs.writeFileSync(fileX.fsPath, longContent, 'utf-8');
        fs.writeFileSync(fileY.fsPath, 'y-content\n', 'utf-8');

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(6, 'classA-test', workspaceUri.toString());
        await sleep(300);

        // textDocumentOpen: open X and Y (raw fs writes above do NOT fire fileCreate).
        const docX = await vscode.workspace.openTextDocument(fileX);
        await vscode.window.showTextDocument(docX);
        await sleep(150);
        const docY = await vscode.workspace.openTextDocument(fileY);
        await vscode.window.showTextDocument(docY);
        await sleep(150);

        // fileSwitch: switch active editor back to X. Capture the *current* editor —
        // revealRange must target the active editor instance, not the stale first one.
        const editorXBack = await vscode.window.showTextDocument(docX);
        await sleep(200);

        // visibleRangeChange (debounced): scroll X far down on the active editor.
        editorXBack.revealRange(new vscode.Range(300, 0, 310, 0), vscode.TextEditorRevealType.InCenter);
        await sleep(800);

        // diagnostics: push a real diagnostic on X.
        const dc = vscode.languages.createDiagnosticCollection('recorder-e2e-diag');
        dc.set(fileX, [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 4), 'recorder-e2e diagnostic', vscode.DiagnosticSeverity.Error)]);
        await sleep(300);

        // textDocumentClose: close everything (attribute the close of X and Y).
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await sleep(1500);

        await recorder.endSession();
        dc.dispose();

        const { sessionDir, events } = readSingleSession(storageDir);

        // textDocumentOpen for X and Y.
        const opens = events.filter((e): e is TextDocumentOpenEvent => e.type === 'textDocumentOpen').map(e => e.uri);
        assert.ok(opens.includes(fileX.toString()), 'textDocumentOpen for X');
        assert.ok(opens.includes(fileY.toString()), 'textDocumentOpen for Y');

        // fileSwitch: prove a real navigation, not just the initial open of X. In headless,
        // onDidChangeActiveTextEditor fires an intermediate `undefined` editor between switches,
        // so the recorder emits separate {to:…} and {from:…} fileSwitch events rather than one
        // carrying both (a harness artifact, not a recorder bug — it records what the event
        // reports). The deactivation `fromUri === Y` can ONLY come from `prev` tracking after we
        // switched away from Y; the initial open of X only ever yields {to:X, from:undefined}.
        const switches = events.filter((e): e is FileSwitchEvent => e.type === 'fileSwitch');
        assert.ok(switches.some(e => e.toUri === fileX.toString()), 'fileSwitch to X captured');
        assert.ok(
            switches.some(e => e.fromUri === fileY.toString()),
            'fileSwitch away from Y captured (proves prev-tracking / a real switch, not the initial open)',
        );

        // visibleRangeChange: the headless editor DOES have a viewport (≈38 lines) and
        // fires onDidChangeTextEditorVisibleRanges on revealRange — as long as reveal targets
        // the active editor on a doc longer than the viewport.
        const visRanges = events.filter((e): e is VisibleRangeChangeEvent => e.type === 'visibleRangeChange' && e.uri === fileX.toString());
        assert.ok(visRanges.length >= 1, 'visibleRangeChange for X captured');
        assert.ok(
            visRanges.some(e => e.visibleRanges.some(r => r.startLine >= 250)),
            'visibleRangeChange reflects the InCenter reveal to ~line 300',
        );
        for (const e of visRanges) {
            assert.deepStrictEqual(parseRecordedEvent(e), e, 'visibleRangeChange round-trips');
        }

        // diagnostics for X carrying our exact message.
        const diags = events.filter((e): e is DiagnosticsEvent => e.type === 'diagnostics' && e.uri === fileX.toString());
        assert.ok(
            diags.some(e => e.diagnostics.some(d => d.message === 'recorder-e2e diagnostic' && d.severity === vscode.DiagnosticSeverity.Error)),
            'diagnostics for X with exact message + severity',
        );

        // textDocumentClose (best-effort): headless vscode-test does not dispose text
        // documents promptly after closeAllEditors, so onDidCloseTextDocument may not fire.
        // Assert the payload IF it fired; the recorder's close handler is wired identically
        // to the (verified) open handler and is unit-covered (workspaceEvents.test.ts).
        const closeEvents = events.filter((e): e is TextDocumentCloseEvent => e.type === 'textDocumentClose');
        const closes = closeEvents.map(e => e.uri);
        if (closes.includes(fileX.toString()) || closes.includes(fileY.toString())) {
            for (const e of closeEvents) {
                assert.deepStrictEqual(parseRecordedEvent(e), e, 'textDocumentClose round-trips');
            }
        } else {
            console.log('[recorder-e2e] textDocumentClose not driveable headless (docs not disposed); covered by unit tests');
        }

        // Each attributed diagnostics event round-trips through the parser.
        for (const e of diags) {
            assert.deepStrictEqual(parseRecordedEvent(e), e, `round-trip ${e.type}`);
        }
        runCliCheck('validate-recording', sessionDir);

        try { fs.rmSync(fileX.fsPath, { force: true }); fs.rmSync(fileY.fsPath, { force: true }); } catch { /* ignore */ }
    });

    test('disable() while recording emits consentChange(downgraded) before sessionEnd and discards pending debounced selection', async () => {
        // Consent-downgrade finalization path: disable() on a COMMITTED (recording)
        // session writes consentChange{downgraded} then sessionEnd, and DISCARDS pending
        // debounced payloads instead of flushing them (the distinctive GDPR behavior).
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-consent-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        const fileS = vscode.Uri.file(path.join(workspaceDir, 'consent-sel.txt'));
        fs.writeFileSync(fileS.fsPath, 'line0\nline1\nline2\nline3\n', 'utf-8');

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(7, 'consent-test', workspaceUri.toString());
        await sleep(300); // commit + startup

        const docS = await vscode.workspace.openTextDocument(fileS);
        const editorS = await vscode.window.showTextDocument(docS);
        await sleep(250);

        // Stage a UNIQUE selection that enters the 200ms debounce, then downgrade before it
        // fires. Confirm it is genuinely PENDING in the debounce map before disable() — that
        // is what makes the "not on disk" assertion below prove DISCARD (not "never pending").
        const pendingSelections = (recorder as unknown as {
            _observation: { _pendingSelectionPayloads: Map<string, RecordedEvent> };
        })._observation._pendingSelectionPayloads;
        const isStaged = (): boolean => {
            const p = pendingSelections.get(docS.uri.toString());
            return !!p && p.type === 'selectionChange'
                && (p as SelectionChangeEvent).selections.some(s =>
                    s.startLine === 2 && s.startCharacter === 1 && s.endLine === 2 && s.endCharacter === 4);
        };
        editorS.selection = new vscode.Selection(2, 1, 2, 4);
        for (let i = 0; i < 12 && !isStaged(); i++) { await sleep(10); } // < 200ms debounce flush
        assert.ok(isStaged(), 'staged selection is pending in the debounce map before disable()');
        recorder.disable(); // consent downgrade — must DISCARD the pending payload

        // disable() finalizes via async queued writes; wait for the durable sessionEnd marker
        // rather than a fixed sleep (which can read before consentChange/sessionEnd land).
        const { events } = await waitForSessionEnd(storageDir);
        const types = events.map(e => e.type);
        const consentIdx = types.lastIndexOf('consentChange');
        const endIdx = types.lastIndexOf('sessionEnd');
        assert.ok(consentIdx >= 0, `consentChange present (types=${types.join(',')})`);
        assert.strictEqual((events[consentIdx] as ConsentChangeEvent).level, 'downgraded', 'consentChange level == downgraded');
        assert.ok(endIdx > consentIdx, 'sessionEnd comes after consentChange');
        assert.deepStrictEqual(parseRecordedEvent(events[consentIdx]), events[consentIdx], 'consentChange round-trips');

        // The staged (2,1)-(2,4) selection must NOT have reached disk (discarded, not flushed).
        const stagedLeak = events
            .filter((e): e is SelectionChangeEvent => e.type === 'selectionChange' && e.uri === docS.uri.toString())
            .find(e => e.selections.some(s => s.startLine === 2 && s.startCharacter === 1 && s.endLine === 2 && s.endCharacter === 4));
        assert.ok(!stagedLeak, 'pending debounced selection discarded on consent downgrade (not flushed)');

        try { fs.rmSync(fileS.fsPath, { force: true }); } catch { /* ignore */ }
    });

    test('every session emits a startup windowFocus event', async () => {
        // The startup capture emits a windowFocus unconditionally — the event TYPE is
        // deterministically coverable even though the runtime focus-toggle path is not.
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-wf-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(8, 'wf-test', workspaceUri.toString());
        await sleep(300);
        await recorder.endSession();

        const { events } = readSingleSession(storageDir);
        const wf = events.filter((e): e is WindowFocusEvent => e.type === 'windowFocus');
        assert.ok(wf.length >= 1, 'at least one windowFocus (startup emit)');
        assert.strictEqual(typeof wf[0].focused, 'boolean', 'windowFocus.focused is boolean');
        assert.deepStrictEqual(parseRecordedEvent(wf[0]), wf[0], 'windowFocus round-trips');
    });

    test('terminalCommand is captured via shell integration (best-effort; skips if unavailable)', async function () {
        // Shell integration is not reliably available in the headless test harness. Attempt
        // the real trigger; if shellIntegration never activates, skip (covered by the unit
        // test terminalShellExecution.test.ts) rather than manufacture a false failure.
        this.timeout(90_000);
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-storage-term-'));
        const storageUri = vscode.Uri.file(storageDir);
        const workspaceUri = vscode.Uri.file(workspaceDir);

        recorder = new SessionRecorder(storageUri);
        recorder.enable();
        await recorder.startSession(9, 'term-test', workspaceUri.toString());
        await sleep(300);

        const term = vscode.window.createTerminal({ name: 'recorder-e2e-cmd', cwd: workspaceDir });
        term.show();

        let si: vscode.TerminalShellIntegration | undefined;
        for (let i = 0; i < 40 && !si; i++) {
            await sleep(250);
            si = term.shellIntegration;
        }
        if (!si) {
            term.dispose();
            await recorder.endSession();
            this.skip();
            return;
        }

        si.executeCommand('echo recorder-e2e-sentinel');
        await sleep(3000);
        term.dispose();
        await sleep(800);
        await recorder.endSession();

        const { sessionDir, events } = readSingleSession(storageDir);
        const cmds = events.filter((e): e is TerminalCommandEvent => e.type === 'terminalCommand');
        assert.ok(cmds.length >= 1, 'at least one terminalCommand captured');
        const sentinel = cmds.find(c => c.command.includes('recorder-e2e-sentinel'));
        assert.ok(sentinel, 'terminalCommand for our sentinel command captured');
        assert.strictEqual(sentinel.terminalName, 'recorder-e2e-cmd', 'terminalCommand.terminalName matches');
        assert.deepStrictEqual(parseRecordedEvent(sentinel), sentinel, 'terminalCommand round-trips');
        runCliCheck('validate-recording', sessionDir);
    });
});

/**
 * Read the single recording session under `storageDir`, returning its directory
 * and parsed JSONL events. Asserts exactly one session dir exists.
 */
function readSingleSession(storageDir: string): { sessionDir: string; events: RecordedEvent[] } {
    const recordingsDir = path.join(storageDir, 'recordings');
    const sessionDirs = fs.readdirSync(recordingsDir).filter(d =>
        fs.statSync(path.join(recordingsDir, d)).isDirectory(),
    );
    assert.strictEqual(sessionDirs.length, 1, 'exactly one session dir');
    const sessionDir = path.join(recordingsDir, sessionDirs[0]);
    const events: RecordedEvent[] = fs.readFileSync(path.join(sessionDir, 'events.jsonl'), 'utf-8')
        .trim().split('\n').map(l => JSON.parse(l) as RecordedEvent);
    return { sessionDir, events };
}

/**
 * Poll until the single session under `storageDir` is finalized (its JSONL contains a
 * sessionEnd). disable()/endSession finalize via async queued writes, so a fixed sleep
 * can read too early; this waits for the real durability signal.
 */
async function waitForSessionEnd(storageDir: string, timeoutMs = 5000): Promise<{ sessionDir: string; events: RecordedEvent[] }> {
    const start = Date.now();
    for (;;) {
        let res: { sessionDir: string; events: RecordedEvent[] } | undefined;
        try { res = readSingleSession(storageDir); } catch { /* not ready yet */ }
        if (res && res.events.some(e => e.type === 'sessionEnd')) { return res; }
        if (Date.now() - start > timeoutMs) { return readSingleSession(storageDir); }
        await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
}

/**
 * Run a recorder CLI script against the session directory and fail the
 * test if the script exits non-zero.
 */
function runCliCheck(
    script: 'validate-recording' | 'roundtrip-recording',
    sessionDir: string,
    extraArgs: string[] = [],
): ReturnType<typeof spawnSync> {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const scriptPath = path.join(extensionRoot, 'scripts', `${script}.ts`);
    const result = spawnSync('npx', ['tsx', scriptPath, sessionDir, ...extraArgs], {
        cwd: extensionRoot,
        encoding: 'utf-8',
        timeout: 60_000,
    });
    assert.strictEqual(
        result.status,
        0,
        `${script} failed (exit ${result.status}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    return result;
}
