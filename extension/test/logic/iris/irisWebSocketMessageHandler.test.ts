import { describe, expect, it, vi } from 'vitest';

// IrisWebSocketMessageHandler allocates a `new vscode.EventEmitter()` field
// (_onDidReceiveIrisChatMessage), so constructing the REAL handler needs that
// symbol. Mirror the shared vitest vscode stub (which has no EventEmitter)
// with a minimal one; nothing else here touches vscode at runtime.
vi.mock('vscode', () => {
    class EventEmitter<T> {
        event = (): { dispose(): void } => ({ dispose: () => { /* no-op */ } });
        fire(_value?: T): void { /* no-op */ }
        dispose(): void { /* no-op */ }
    }
    return { EventEmitter };
});

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import type { SessionDetail } from '@shared/types/serverContext';

import { IrisWebSocketMessageHandler } from '@extension/services/iris/chat/irisWebSocketMessageHandler';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { ConversationState } from '@extension/services/iris/conversation/conversationState';
import { IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';
import type { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';

/**
 * A USER-sender MESSAGE frame must never finalize the current run, even when
 * it arrives scoped to the current run's runId. The server sends USER frames
 * with runId/runState null today, but the handler must not depend on that
 * contract (see the comment on `_handleMessage`).
 */
describe('IrisWebSocketMessageHandler: USER frames never finalize a run', () => {
    it('a USER MESSAGE scoped to the current run leaves it waiting and still accepting PARTIALs', () => {
        // A conversation has to be open for the projection to have anything to
        // be addressed to; without one the handler drops every frame.
        const { handler, posted, runs } = makeHandler({ currentSessionId: 1 });

        // Start a generation and bind run 'A' as current, mirroring a real send.
        runs.beginGeneration();
        handler.handleIrisWebSocketMessage({ type: 'PARTIAL', runId: 'A', partialResult: 'first draft', partialSeq: 1 }, 1);
        expect(runs.currentRunId).toBe('A');
        expect(runs.waiting).toBe(true);

        // A USER frame scoped to the current run: the dangerous case the guard
        // covers, not today's server behaviour.
        handler.handleIrisWebSocketMessage({
            type: 'MESSAGE',
            runId: 'A',
            message: { sender: 'USER', content: 'the user prompt, echoed back' },
        }, 1);

        // The run must still be waiting: the USER frame must not have reached
        // finalizeRun.
        expect(runs.waiting).toBe(true);

        // A subsequent assistant PARTIAL for the same run must still be
        // accepted. If the USER frame had wrongly finalized run 'A', it would
        // be in `_finalizedRunIds` and this PARTIAL would be silently dropped.
        posted.length = 0;
        handler.handleIrisWebSocketMessage({ type: 'PARTIAL', runId: 'A', partialResult: 'second draft', partialSeq: 2 }, 1);

        const runUiUpdates = posted.filter((m) => m.type === 'updateIrisRunUi');
        expect(runUiUpdates).toHaveLength(1);
        const projection = runUiUpdates[0] as Extract<ExtensionToWebviewMessage, { type: 'updateIrisRunUi' }>;
        expect(projection.projection.draft).toEqual({ runId: 'A', text: 'second draft' });
    });
});

// `makeHandler` installs a real `ConversationState`; passing `currentSessionId`
// makes that session current, so `_activeConversation` is defined.

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 5 };
const EX7 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 7 };

function makeHandler(opts: { currentSessionId?: number; courseId?: number; irisSessionId?: number } = {}) {
    const runs = new IrisRunStateMachine();
    const posted: ExtensionToWebviewMessage[] = [];
    const state = new ConversationState();
    const courseId = opts.courseId ?? 42;
    state.setCourse(courseId);
    if (opts.currentSessionId !== undefined) {
        const detail: SessionDetail = {
            sessionId: opts.currentSessionId,
            courseId,
            context: { mode: 'COURSE_CHAT', entityId: courseId },
            lastActivity: 1000,
            messages: [],
        };
        state.installAcquired(detail, state.beginLoad());
    }

    let notifyChangedCalls = 0;
    const conversation = {
        state,
        reload: () => Promise.resolve(),
        notifyChanged: () => { notifyChangedCalls++; },
        onSubscriptionActive: () => { /* no-op */ },
    } as unknown as IrisConversationService;

    // Only `currentSessionId` (via ConversationState) is what `_activeConversation`
    // gates on, but `_handleSessionTitle` ALSO needs a truthy
    // `getIrisWebSocketSessionClient().currentSessionId` before it even looks at
    // `_activeConversation`, so the title tests need this wired independently.
    const irisSessionClient = opts.irisSessionId !== undefined
        ? ({ currentSessionId: opts.irisSessionId } as unknown as IrisWebSocketSessionClient)
        : undefined;

    const handler = new IrisWebSocketMessageHandler(
        undefined,
        () => irisSessionClient,
        (message) => posted.push(message),
        runs,
        () => conversation,
    );

    return { handler, posted, state, runs, getNotifyChangedCalls: () => notifyChangedCalls };
}

/** The real CTXSWAP wire shape (attributes inside a json content item). */
function ctxswapFrame(
    context?: { mode: string; entityId: number; name?: string },
    transition: 'added' | 'removed' | 'changed' = context ? 'added' : 'removed',
) {
    const attributes = transition === 'removed'
        ? { transition }
        : { transition, entityMode: context!.mode, entityId: context!.entityId, name: context!.name };
    return {
        type: 'MESSAGE',
        message: { id: 20, sender: 'CTXSWAP', content: [{ type: 'json', attributes }] },
    };
}

describe('session-scoped frames', () => {
    it('drops every frame whose source is not the current session', () => {
        const { handler, posted } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage({ type: 'MESSAGE', runId: 'r1', message: { id: 1, sender: 'LLM', content: [{ textContent: 'x' }] } }, 3);
        expect(posted).toHaveLength(0);
    });

    it('drops a stale CTXSWAP frame too, not only assistant frames', () => {
        // makeHandler installs an initial COURSE_CHAT detail so `_detail` is
        // populated (as it always is in production once currentSessionId is
        // set); the invariant under test is that the STALE swap to EX5 never
        // applies, not that no context was ever committed.
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 3);
        expect(state.snapshot().committedContext).not.toEqual(EX5);
    });

    it('drops a stale frame BEFORE the run machine can admit its run', () => {
        // Otherwise an unknown run from the conversation just left binds as
        // current (irisRunStateMachine.ts:32-48) and the composer hangs.
        const { handler, runs } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage({ type: 'STATUS', runId: 'ghost' }, 3);
        expect(runs.currentRunId).toBeUndefined();
    });
});

describe('CTXSWAP frames', () => {
    it('updates the committed context and bumps the revision', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        const before = state.guard().contextRevision;
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);
        expect(state.snapshot().committedContext).toEqual(EX5);
        expect(state.guard().contextRevision).toBe(before + 1);
    });

    it('never finalizes the run', () => {
        // The server pushes the marker while our own POST is still open, so
        // finalizing on it would kill a live run.
        const { handler, runs } = makeHandler({ currentSessionId: 7 });
        runs.beginGeneration();
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);
        expect(runs.waiting).toBe(true);
    });

    it('appends a marker row to the transcript', () => {
        const { handler, posted } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);
        expect(posted.at(-1)).toMatchObject({ type: 'addMessage', message: { role: 'contextSwap' } });
    });

    it('derives the course context from a removed marker', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7, courseId: 42 });
        handler.handleIrisWebSocketMessage(ctxswapFrame(undefined, 'removed'), 7);
        expect(state.snapshot().committedContext).toEqual({ mode: 'COURSE_CHAT', entityId: 42 });
    });

    it('tells the student when a foreign swap discarded their staging', () => {
        const { handler, state, posted } = makeHandler({ currentSessionId: 7, courseId: 42 });
        state.stagePending(EX7);

        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);

        expect(posted.some((m) => 'text' in m && String(m.text).includes('changed elsewhere'))).toBe(true);
    });

    it('says nothing when the swap only repeats the context we already committed', () => {
        // Our own send's marker, arriving after the write-back applied it. The
        // staging made since survives, so there is nothing to report and a
        // notice would name an event that did not happen.
        const { handler, state, posted } = makeHandler({ currentSessionId: 7, courseId: 42 });
        state.commitContext(EX5);
        state.stagePending(EX7);

        handler.handleIrisWebSocketMessage(ctxswapFrame(EX5), 7);

        expect(state.snapshot().pendingContext?.ctx).toEqual(EX7);
        expect(posted.some((m) => 'text' in m && String(m.text).includes('changed elsewhere'))).toBe(false);
    });
});

describe('USER frames from another client', () => {
    it('renders a message this client did not write', () => {
        // The claim the whole conversation-first model rests on: what you see is
        // what the server has. A USER frame is only ever "our own echo" while a
        // send of ours is open; otherwise the student wrote it somewhere else
        // (the Artemis web client, a second window) and it belongs on screen.
        const { handler, posted } = makeHandler({ currentSessionId: 7 });

        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', message: { id: 33, sender: 'USER', content: [{ textContent: 'from elsewhere', type: 'text' }] } },
            7,
        );

        expect(posted.at(-1)).toMatchObject({
            type: 'addMessage',
            sessionId: 7,
            message: { id: 33, role: 'user', content: 'from elsewhere' },
        });
    });

    it('renders it even while a send of ours is open', () => {
        // A send of ours does NOT make every USER frame ours: the flag is set
        // before file collection and stays set through the POST and its
        // reconciliation, and another client can write throughout. Suppressing
        // by timing loses those permanently, because nothing re-delivers the
        // transcript when the send settles. Deduplication against our own
        // optimistic bubble belongs in the webview, which knows what it drew.
        const { handler, posted, state } = makeHandler({ currentSessionId: 7 });
        state.beginSend();

        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', message: { id: 33, sender: 'USER', content: [{ textContent: 'from elsewhere', type: 'text' }] } },
            7,
        );

        expect(posted.at(-1)).toMatchObject({ type: 'addMessage', message: { id: 33, role: 'user' } });
    });

    it('never finalizes the run, whoever wrote it', () => {
        const { handler, runs } = makeHandler({ currentSessionId: 7 });
        runs.beginGeneration();

        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', message: { id: 33, sender: 'USER', content: [{ textContent: 'from elsewhere', type: 'text' }] } },
            7,
        );

        expect(runs.waiting).toBe(true);
    });
});

describe('host state ingestion (Task 6 step 7)', () => {
    it('an assistant frame makes the host conversation non-empty', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', runId: 'r1', message: { id: 12, sender: 'LLM', content: [{ textContent: 'x', type: 'text' }] } },
            7,
        );
        expect(state.contentState()).toBe('content');
    });

    it('a USER frame from another client makes the host conversation non-empty', () => {
        // The state half; the rendering half is pinned in "USER frames from
        // another client" above.
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', message: { id: 13, sender: 'USER', content: [{ textContent: 'hi', type: 'text' }] } },
            7,
        );
        expect(state.contentState()).toBe('content');
    });

    it('a bodiless persisted answer still counts as content', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage({ type: 'MESSAGE', runId: 'r1', message: { id: 14, sender: 'LLM' } }, 7);
        expect(state.contentState()).toBe('content');
    });

    it('a dropped stale frame does not touch host state', () => {
        const { handler, state } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', runId: 'r1', message: { id: 12, sender: 'LLM', content: [{ textContent: 'x', type: 'text' }] } },
            3,
        );
        expect(state.contentState()).toBe('empty');
    });
});

describe('nothing open: the source check is skipped, but there is still nothing to render into', () => {
    it('admits the run yet renders no bubble when no conversation is open', () => {
        // `currentSessionId` is undefined before anything is installed.
        // `_activeConversation` must treat that as "no conversation", not as
        // "conversation whose current session is undefined": the latter would
        // make every frame fail `sourceSessionId !== current` and be dropped
        // before the run machine ever sees it, so a run that started just
        // before the install would never be admitted at all. The bubble itself
        // is still dropped, because there is no conversation to attribute it
        // to and rendering it would attach it to whatever opens next.
        const { handler, posted, runs } = makeHandler();
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', runId: 'r1', message: { id: 1, sender: 'LLM', content: [{ textContent: 'x', type: 'text' }] } },
            999, // arbitrary: must not matter while nothing is open
        );
        expect(runs.currentRunId).toBe('r1');
        expect(posted.some((p) => p.type === 'addMessage')).toBe(false);
    });
});

describe('frames are attributed to the conversation, not the old local session', () => {
    it('an assistant message carries the conversation id and its derived local key', () => {
        const { handler, posted } = makeHandler({ currentSessionId: 900 });

        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', runId: 'r1', message: { id: 7, sender: 'LLM', content: [{ type: 'text', textContent: 'hi' }] } },
            900,
        );

        // Without this the answer lands under the PREVIOUS conversation's
        // transcript, and is persisted in a different one.
        const added = posted.find((m) => (m as { type?: string }).type === 'addMessage') as
            { sessionId?: number } | undefined;
        expect(added?.sessionId).toBe(900);
    });

    it('the run-UI projection carries it too, so the indicator belongs to one conversation', () => {
        const { handler, posted } = makeHandler({ currentSessionId: 900 });

        handler.publishCurrentRunUi();

        const runUi = posted.find((m) => (m as { type?: string }).type === 'updateIrisRunUi') as
            { projection?: { sessionId?: number } } | undefined;
        expect(runUi?.projection?.sessionId).toBe(900);
    });
});

describe('_handleSessionTitle notifies the conversation service', () => {
    it('calls notifyChanged after setTitle, so the presenter repaints off onDidChange', () => {
        const { handler, state, getNotifyChangedCalls } = makeHandler({ currentSessionId: 7, irisSessionId: 7 });
        handler.handleIrisWebSocketMessage({ type: 'STATUS', sessionTitle: 'Neuer Titel' }, 7);
        expect(state.snapshot().detail?.title).toBe('Neuer Titel');
        expect(getNotifyChangedCalls()).toBe(1);
    });
});
