/**
 * Unit tests for chat send-attempt, receive-metadata and feedback events
 * (Block H).
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type { RecordingFs } from '@extension/services/telemetry/recording/storageWriter';
import { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type {
    IrisChatFeedbackEvent,
    IrisChatMessageEvent,
    IrisChatSendAttemptEvent,
    RecordedEvent,
} from '@extension/services/telemetry/recording/types';

class FakeFs implements RecordingFs {
    appendedChunks: string[] = [];
    writtenFiles: { path: string; data: string }[] = [];
    removedPaths: string[] = [];
    syncChunks: string[] = [];

    mkdir(_p: string, _opts: { recursive: boolean }): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }

    writeFile(p: string, data: string, _enc: BufferEncoding): Promise<void> {
        this.writtenFiles.push({ path: p, data });
        return Promise.resolve();
    }

    appendFile(_p: string, data: string, _enc: BufferEncoding): Promise<void> {
        this.appendedChunks.push(data);
        return Promise.resolve();
    }

    rm(p: string, _opts: { recursive: boolean; force: boolean }): Promise<void> {
        this.removedPaths.push(p);
        return Promise.resolve();
    }

    appendFileSync(_p: string, data: string, _enc: BufferEncoding): void {
        this.syncChunks.push(data);
    }
}

function collectWrittenEvents(fakeFs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of [...fakeFs.appendedChunks, ...fakeFs.syncChunks]) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try {
                events.push(JSON.parse(line) as RecordedEvent);
            } catch {
                /* skip malformed lines */
            }
        }
    }
    return events;
}

function makeRecorder(): { recorder: SessionRecorder; fs: FakeFs } {
    const fs = new FakeFs();
    const writer = new RecordingStorageWriter('/fake-base', fs, 'test-version');
    const fakeUri = vscode.Uri.file('/fake-base');
    const recorder = new SessionRecorder(
        fakeUri,
        { hasTerminalShellExecution: false, hasVscodeGitExtension: false },
        undefined,
        writer,
    );
    return { recorder, fs };
}

suite('SessionRecorder — Block H: Chat Recording', () => {
    let recorder: SessionRecorder;
    let fs: FakeFs;

    setup(async () => {
        const ctx = makeRecorder();
        recorder = ctx.recorder;
        fs = ctx.fs;
        recorder.enable();
        await recorder.startSession(42, 'participant-1');
    });

    teardown(async () => {
        try { await recorder.shutdown(); } catch { /* ignore */ }
    });

    test('pending+sent attempt events are emitted on a successful send', async () => {
        recorder.recordIrisChatSendAttempt('hello iris', 'pending');
        recorder.recordIrisChatSendAttempt('hello iris', 'sent');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const attempts = events.filter(
            (e): e is IrisChatSendAttemptEvent => e.type === 'irisChatSendAttempt',
        );

        assert.strictEqual(attempts.length, 2, 'two irisChatSendAttempt events expected');
        assert.strictEqual(attempts[0].status, 'pending');
        assert.strictEqual(attempts[0].content, 'hello iris');
        assert.strictEqual(attempts[1].status, 'sent');
        assert.strictEqual(attempts[1].content, 'hello iris');
        assert.strictEqual(attempts[1].errorMessage, undefined);
    });

    test('pending+failed attempt events are emitted on a failed send', async () => {
        recorder.recordIrisChatSendAttempt('help me', 'pending');
        recorder.recordIrisChatSendAttempt('help me', 'failed', 'Network timeout');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const attempts = events.filter(
            (e): e is IrisChatSendAttemptEvent => e.type === 'irisChatSendAttempt',
        );

        assert.strictEqual(attempts.length, 2, 'two irisChatSendAttempt events expected');
        assert.strictEqual(attempts[0].status, 'pending');
        assert.strictEqual(attempts[1].status, 'failed');
        assert.strictEqual(attempts[1].errorMessage, 'Network timeout');
    });

    test('failed send: no irisChatMessage event emitted', async () => {
        recorder.recordIrisChatSendAttempt('will fail', 'pending');
        recorder.recordIrisChatSendAttempt('will fail', 'failed', 'Timeout');
        // recordIrisChatSent is deliberately NOT called, mirroring chatWebviewProvider.
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const chatMsgs = events.filter(e => e.type === 'irisChatMessage');
        assert.strictEqual(chatMsgs.length, 0, 'no irisChatMessage should exist for a failed send');

        const attempts = events.filter(e => e.type === 'irisChatSendAttempt');
        assert.strictEqual(attempts.length, 2, 'both attempt events should exist');
    });

    test('successful send: pending+sent attempt AND irisChatMessage event', async () => {
        recorder.recordIrisChatSendAttempt('what is recursion?', 'pending');
        recorder.recordIrisChatSendAttempt('what is recursion?', 'sent');
        recorder.recordIrisChatSent('what is recursion?');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const attempts = events.filter(e => e.type === 'irisChatSendAttempt');
        const chatMsgs = events.filter(
            (e): e is IrisChatMessageEvent => e.type === 'irisChatMessage',
        );

        assert.strictEqual(attempts.length, 2, 'pending + sent attempt events');
        assert.strictEqual(chatMsgs.length, 1, 'one irisChatMessage event');
        assert.strictEqual(chatMsgs[0].direction, 'sent');
        assert.strictEqual(chatMsgs[0].content, 'what is recursion?');
    });

    test('recordIrisChatReceived passes through messageId, sessionId, sentAt', async () => {
        const sentAt = Date.now() - 1000;
        recorder.recordIrisChatReceived('Great question!', 'msg-99', 'sess-7', sentAt);
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const received = events.filter(
            (e): e is IrisChatMessageEvent =>
                e.type === 'irisChatMessage' && e.direction === 'received',
        );

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].content, 'Great question!');
        assert.strictEqual(received[0].messageId, 'msg-99');
        assert.strictEqual(received[0].sessionId, 'sess-7');
        assert.strictEqual(received[0].sentAt, sentAt);
    });

    test('recordIrisChatReceived works without metadata (backwards-compat)', async () => {
        recorder.recordIrisChatReceived('Simple reply');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const received = events.filter(
            (e): e is IrisChatMessageEvent =>
                e.type === 'irisChatMessage' && e.direction === 'received',
        );

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].content, 'Simple reply');
        assert.strictEqual(received[0].messageId, undefined);
        assert.strictEqual(received[0].sessionId, undefined);
        assert.strictEqual(received[0].sentAt, undefined);
    });

    test('recordIrisChatSent passes through messageId, sessionId, sentAt', async () => {
        const sentAt = Date.now();
        recorder.recordIrisChatSent('hello', 'msg-1', 'sess-3', sentAt);
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const sent = events.filter(
            (e): e is IrisChatMessageEvent =>
                e.type === 'irisChatMessage' && e.direction === 'sent',
        );

        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].messageId, 'msg-1');
        assert.strictEqual(sent[0].sessionId, 'sess-3');
        assert.strictEqual(sent[0].sentAt, sentAt);
    });

    test('recordIrisChatFeedback emits helpful=true event', async () => {
        recorder.recordIrisChatFeedback('msg-55', true);
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const feedback = events.filter(
            (e): e is IrisChatFeedbackEvent => e.type === 'irisChatFeedback',
        );

        assert.strictEqual(feedback.length, 1);
        assert.strictEqual(feedback[0].messageId, 'msg-55');
        assert.strictEqual(feedback[0].helpful, true);
    });

    test('recordIrisChatFeedback emits helpful=false event', async () => {
        recorder.recordIrisChatFeedback('msg-66', false);
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const feedback = events.filter(
            (e): e is IrisChatFeedbackEvent => e.type === 'irisChatFeedback',
        );

        assert.strictEqual(feedback.length, 1);
        assert.strictEqual(feedback[0].helpful, false);
    });

    test('recordIrisChatSendAttempt is a no-op when recorder is not in recording phase', async () => {
        // End the session to put recorder back in idle
        await recorder.endSession();
        const chunksBefore = fs.appendedChunks.length;

        recorder.recordIrisChatSendAttempt('ignored', 'pending');

        assert.strictEqual(
            fs.appendedChunks.length,
            chunksBefore,
            'no event should be appended when recorder is idle',
        );
    });

    test('recordIrisChatFeedback is a no-op when recorder is not in recording phase', async () => {
        await recorder.endSession();
        const chunksBefore = fs.appendedChunks.length;

        recorder.recordIrisChatFeedback('msg-x', true);

        assert.strictEqual(
            fs.appendedChunks.length,
            chunksBefore,
            'no event should be appended when recorder is idle',
        );
    });

    test('recordIrisChatSent without metadata is backwards-compatible', async () => {
        recorder.recordIrisChatSent('plain message');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const sent = events.filter(
            (e): e is IrisChatMessageEvent =>
                e.type === 'irisChatMessage' && e.direction === 'sent',
        );

        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].content, 'plain message');
        assert.strictEqual(sent[0].messageId, undefined);
        assert.strictEqual(sent[0].sessionId, undefined);
        assert.strictEqual(sent[0].sentAt, undefined);
    });
});
