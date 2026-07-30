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
 * Regression coverage for the FIX described in the whole-branch review: a
 * USER-sender MESSAGE frame must never finalize the current run, even if it
 * arrives scoped to the current run's runId (today the server always sends
 * USER frames with runId/runState null, but the handler must not depend on
 * that contract — see the comment on `_handleMessage`).
 */
describe('IrisWebSocketMessageHandler: USER frames never finalize a run', () => {
    it('a USER MESSAGE scoped to the current run leaves it waiting and still accepting PARTIALs', () => {
        const runs = new IrisRunStateMachine();
        const posted: ExtensionToWebviewMessage[] = [];

        const handler = new IrisWebSocketMessageHandler(
            undefined,
            () => undefined,
            (message) => posted.push(message),
            runs,
            () => 's1',
            () => undefined,
        );

        // Start a generation and bind run 'A' as current, mirroring a real send.
        runs.beginGeneration();
        handler.handleIrisWebSocketMessage({ type: 'PARTIAL', runId: 'A', partialResult: 'first draft', partialSeq: 1 }, 1);
        expect(runs.currentRunId).toBe('A');
        expect(runs.waiting).toBe(true);

        // A USER frame scoped to the current run (the hypothetical dangerous
        // case the FIX guards against, not today's actual server behaviour).
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

// ---------------------------------------------------------------------------
// Task 6: session-scoped frames and CTXSWAP classification at the transport
// boundary. These tests exercise the NEW-model gate directly: `makeHandler`
// installs a real `ConversationState` with a session already current, so
// `_activeConversation` is defined regardless of the (dormant, until Task 14)
// production wiring.
// ---------------------------------------------------------------------------

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 5 };

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
        () => 's1',
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
        // The server pushes the marker WHILE our own POST is open, so today a
        // successful first message terminates its own run.
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
        // It is not rendered (the echo would duplicate the local bubble), but it
        // IS content, and contentState is the ownership predicate.
        const { handler, state, posted } = makeHandler({ currentSessionId: 7 });
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', message: { id: 13, sender: 'USER', content: [{ textContent: 'hi', type: 'text' }] } },
            7,
        );
        expect(state.contentState()).toBe('content');
        expect(posted.filter((p) => p.type === 'addMessage')).toHaveLength(0);
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

describe('dormancy guard: the new model must stay inert until a session is actually open', () => {
    it('processes a frame normally, whatever its sourceSessionId, when the conversation service exists but has no session open', () => {
        // Between here and Task 14, nothing calls IrisConversationService.start(),
        // so the service exists (getConversation() is truthy) but
        // ConversationState.currentSessionId is undefined. `_activeConversation`
        // MUST treat that as "no active conversation", not as "conversation
        // active with an undefined current session" — the latter would make
        // every frame's sourceSessionId (whatever it is) fail the
        // `sourceSessionId !== current` check and get dropped, silently, for
        // the whole dormant period. makeHandler() with no currentSessionId
        // reproduces exactly that shape.
        const { handler, posted, runs } = makeHandler();
        handler.handleIrisWebSocketMessage(
            { type: 'MESSAGE', runId: 'r1', message: { id: 1, sender: 'LLM', content: [{ textContent: 'x', type: 'text' }] } },
            999, // arbitrary: must not matter while the guard correctly stays closed
        );
        expect(runs.currentRunId).toBe('r1');
        expect(posted.some((p) => p.type === 'addMessage')).toBe(true);
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
