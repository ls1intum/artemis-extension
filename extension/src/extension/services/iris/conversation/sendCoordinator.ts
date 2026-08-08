import type { ServerContext } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { ApiError } from '@extension/domain';
import type { RunLifecycle } from '@extension/services/iris/irisRunStateMachine';

import type { IrisConversationService } from './conversationService';

export type SendRejection =
    | 'send-in-flight'
    | 'navigation-in-flight'
    | 'no-conversation'
    /** The open conversation changed between composing and handling. */
    | 'conversation-changed'
    | 'rate-limit'
    /** Local setup failed; nothing was sent, so nothing is ambiguous. */
    | 'preparation-failed';

/**
 * The user-facing text for every rejection, defined next to the reasons so a
 * reason and its message cannot drift apart. `unknown` is included because the
 * bubble is failed with it too.
 */
export const SEND_REJECTION_MESSAGES: Record<SendRejection | 'unknown', string> = {
    'send-in-flight': 'Iris is answering right now. Please wait.',
    'navigation-in-flight': 'The conversation is still loading.',
    'no-conversation': 'No conversation is open.',
    'conversation-changed': 'The conversation changed. Send your message again.',
    'rate-limit': 'You have reached your message limit.',
    'preparation-failed': 'The message could not be prepared.',
    'unknown': 'Unknown outcome. Check the transcript.',
};

export type SendOutcome =
    | { kind: 'sent'; messageId: number | undefined }
    | { kind: 'rejected'; reason: SendRejection }
    /** The POST started and its result is genuinely unknowable. */
    | { kind: 'unknown' };

export interface SendDeps {
    runLifecycle: RunLifecycle;
    resetRunUiAndPublish(): void;
    collectUncommittedFiles(): Promise<Map<string, string> | undefined>;
    /** All three address the ORIGIN session, never "whatever is open now". */
    confirmBubble(sessionId: number, localId: string, messageId: number | undefined): void;
    failBubble(sessionId: number, localId: string, reason: SendRejection | 'unknown'): void;
    reportError(message: string): void;
    getWorkspaceExerciseId(): number | undefined;
}

/** `sessionId` is the conversation the optimistic bubble was drawn in. */
export interface SendInput { text: string; localId: string; sessionId: number }

export class SendCoordinator {
    constructor(
        private readonly _api: ArtemisApiService,
        private readonly _conversation: IrisConversationService,
        private readonly _deps: SendDeps,
    ) {}

    // Takes the FULL SendInput. An earlier draft declared the parameter as
    // `{ text, localId }` while the body read `input.sessionId`, which does not
    // compile and, worse, would have silently dropped the origin-session check
    // that this field exists for.
    public async send(input: SendInput): Promise<SendOutcome> {
        const state = this._conversation.state;
        // Host-enforced, not a disabled button: the webview's streaming state
        // resets on disconnect, so UI gating is not an invariant.
        // Every early return fails the bubble, and against the ORIGIN session,
        // not the current one. The webview drew its optimistic message while
        // `input.sessionId` was open; addressing the current session instead
        // targets a bubble that may live in another conversation, and when there
        // is no current session it addresses nothing, so the bubble stays stuck
        // in `sending` forever.
        const origin = input.sessionId;
        const reject = (reason: SendRejection): SendOutcome => {
            this._deps.failBubble(origin, input.localId, reason);
            return { kind: 'rejected', reason };
        };
        if (state.sendInFlight) { return reject('send-in-flight'); }
        if (this._conversation.navigationInFlight) { return reject('navigation-in-flight'); }

        const snapshot = state.snapshot();
        const sessionId = snapshot.currentSessionId;
        if (sessionId === undefined) { return reject('no-conversation'); }
        // The command was composed against `origin`. A navigation can COMPLETE
        // between the webview posting it and the host handling it, at which
        // point `navigationInFlight` is false again and nothing above catches
        // it. Sending the prompt into whatever conversation happens to be open
        // now is the worst available outcome: the student's own text, in the
        // wrong place, with nothing on screen to say so.
        if (sessionId !== origin) { return reject('conversation-changed'); }

        const pending = snapshot.pendingContext?.ctx;
        const effective = state.effectiveContext();
        const captured = { sessionId, contextRevision: state.guard().contextRevision, ctx: pending };

        // The lock and the run generation are taken BEFORE the first await of
        // any kind, file collection included. An earlier draft collected files
        // first: two sends could both observe sendInFlight === false, both wait
        // for collection, and both POST. A navigation could start in the same
        // window, and a throw inside collection left no generation to abort even
        // though the webview had already entered its streaming state.
        state.beginSend();
        state.setOptimisticBubble(true);

        // The try opens IMMEDIATELY after the lock. beginGeneration and
        // resetRunUiAndPublish can throw synchronously, and outside the try that
        // skips the finally entirely: the lock stays latched, the optimistic
        // bubble stays, and a generation that was created is never aborted.
        let generation: number | undefined;
        let postStarted = false;
        try {
            // The webview mirrors `sendInFlight` and gates its composer on it,
            // but nothing published the ACQUISITION: the only other
            // notifyChanged is in the finally below, so the flag could travel
            // exclusively as `false`. Inside the try, after both mutations, for
            // the same reason the try opens here: a listener that throws
            // synchronously must not skip the finally and latch the lock
            // forever. `beginGeneration` is run-lifecycle state and is not part
            // of the snapshot, so publishing ahead of it is safe.
            this._conversation.notifyChanged();
            generation = this._deps.runLifecycle.beginGeneration();
            this._deps.resetRunUiAndPublish();
            // Under staging the effective context can be an exercise the
            // workspace does not belong to. Sending exercise Y's diff under X's
            // context is worse than sending none.
            const files = this._isWorkspaceContext(effective)
                ? await this._deps.collectUncommittedFiles()
                : undefined;
            postStarted = true;
            const persisted = await this._api.sendChatMessage(sessionId, input.text, files, pending);
            this._commitWriteBack(captured);
            const messageId = typeof persisted?.id === 'number' ? persisted.id : undefined;
            // Record the persisted message in STATE, not only in the webview.
            // Without this the conversation still reports `empty` once the
            // optimistic flag clears, and everything keyed on that is wrong at
            // once: the header's message count, the union that protects
            // in-flight arrivals, and the marker handling that decides whether a
            // staging is still live.
            // Only into the conversation we actually sent to. Without this check
            // a navigation that committed while the POST was open would have the
            // OLD conversation's message written into the NEW one's transcript.
            if (messageId !== undefined && state.snapshot().currentSessionId === captured.sessionId) {
                state.upsertMessage({ ...persisted, id: messageId, sender: 'USER' });
            }
            this._deps.confirmBubble(origin, input.localId, messageId);
            void this._conversation.refreshOverview();
            return { kind: 'sent', messageId };
        } catch (error) {
            // The generation must be aborted on every failing path, or the
            // thinking indicator never clears. It may not exist yet if
            // beginGeneration itself threw.
            if (generation !== undefined) { this._deps.runLifecycle.abortGeneration(generation); }
            if (!postStarted) {
                // Local preparation failed and nothing was ever sent. This is NOT
                // an ambiguous send: issuing a reconciliation GET here would spend
                // a request to confirm the obvious and report `unknown` for an
                // outcome that is perfectly known.
                this._deps.failBubble(origin, input.localId, 'preparation-failed');
                return { kind: 'rejected', reason: 'preparation-failed' };
            }
            if (error instanceof ApiError && error.status === 429) {
                this._deps.failBubble(origin, input.localId, 'rate-limit');
                return { kind: 'rejected', reason: 'rate-limit' };
            }
            return await this._reconcileUnknown(input, captured);
        } finally {
            // Released ONLY here, after the result is fully processed,
            // reconciliation included. sendSeq moves with it, so a load that
            // started earlier can never install a pre-send snapshot. There is no
            // await between _commitWriteBack and endSend on the success path, so
            // nothing can interleave between the write-back and the bump.
            state.setOptimisticBubble(false);
            state.endSend();
            this._conversation.notifyChanged();
            // A reload deferred because it arrived mid-send (an undecodable
            // CTXSWAP marker) runs now, not never. It cannot recurse: the flag is
            // cleared before the call and endSend already ran, so `reload` sees
            // sendInFlight === false. Its rejection is swallowed and logged, not
            // left as an unhandled promise.
            this._conversation.runDeferredReload();
        }
    }

    /** Uncommitted files travel only when the topic IS the open workspace. */
    private _isWorkspaceContext(ctx: ServerContext | undefined): boolean {
        return ctx?.mode === 'PROGRAMMING_EXERCISE_CHAT'
            && ctx.entityId === this._deps.getWorkspaceExerciseId();
    }

    private _commitWriteBack(captured: { sessionId: number; contextRevision: number; ctx?: ServerContext }): void {
        const state = this._conversation.state;
        const now = state.snapshot();
        if (now.currentSessionId !== captured.sessionId) { return; }        // discarded
        if (!captured.ctx) { return; }                                       // nothing was staged
        const guard = state.guard();
        if (guard.contextRevision === captured.contextRevision) {
            state.commitContext(captured.ctx);                               // exactly what was sent
            return;
        }
        // The revision moved. Either the ordinary self-CTXSWAP already installed
        // it (leave it), or the server has newer truth (leave it too: the
        // response body does not contain the session context at all).
    }

    /**
     * There is NO way to correlate a sent message after the fact:
     * messageDifferentiator is @Transient on the server, so a reconciliation GET
     * cannot see it. We therefore do not try to determine whether the message
     * landed. The job is to leave nothing corrupted.
     */
    private async _reconcileUnknown(input: SendInput, captured: { sessionId: number }): Promise<SendOutcome> {
        const state = this._conversation.state;
        try {
            const courseId = state.snapshot().courseId!;
            // The guard is captured BEFORE the request. Constructing it after the
            // response is tautological: it would always accept, and a CTXSWAP
            // that arrived while this GET was in flight would be overwritten by
            // the older snapshot the GET returns. That is precisely the race the
            // context-revision guard exists to stop, reintroduced inside the
            // recovery path.
            const guard = state.beginLoad();
            // A divergent staging is deliberately LEFT alone here. It used to be
            // dropped whenever content existed, because a retry would then have
            // rehomed that content; staging onto a conversation with content is
            // the ordinary case now, so dropping it would only undo the topic
            // the student picked and never sent. When the send did land,
            // `installDetail` clears the staging by itself: the detail comes
            // back already carrying it.
            const detail = await this._api.getChatSessionById(courseId, captured.sessionId);
            state.installDetail(detail, guard);
        } catch {
            // Reconciliation itself failed. Surface it, do not retry. But the
            // lock, the bubble and the composer must still end in a defined
            // state, which the finally block and this call guarantee.
            this._deps.reportError('Iris could not be reached. The transcript may be out of date.');
        }
        this._deps.failBubble(captured.sessionId, input.localId, 'unknown');   // bubble leaves `sending`
        // The composer text is deliberately NOT cleared and nothing is resent.
        return { kind: 'unknown' };
    }
}
