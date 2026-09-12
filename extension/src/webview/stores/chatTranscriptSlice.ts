import type { StateCreator } from 'zustand';

import type { IrisRunUiProjection } from '@shared/messageContracts';
import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import { mergeHistory } from '@webview/stores/mergeHistory';
import type { ChatState } from '@webview/stores/useChatStore';
import type { ChatMessage, StreamingState } from '@webview/views/IrisChat/types';

/**
 * The chat transcript and everything that is written together with it: the
 * message list, the held server echo, the run UI projection, and the proactive
 * episode state (suppression and folding).
 *
 * Split out of `useChatStore` because these members move as one. `applyCommit`
 * writes a message and its run-UI projection in a SINGLE `set` so the draft can
 * never be observed cleared before the committed message lands; `addMessage`
 * and `applyCommit` both consult `suppressedIds` and extend `liveEpisodeIds`
 * while writing `messages`; `removeMessageById` updates `messages` and
 * `suppressedIds` atomically; and `clearMessages` resets all four groups at
 * once. Separating any of them would put an atomicity invariant across a module
 * boundary, which is why this is one slice rather than a transcript slice and a
 * proactive slice.
 *
 * What stayed behind in `useChatStore` is the conversation shell: courses,
 * session identity, banners, the picker and the composer.
 */
export interface ChatTranscriptSlice {
    messages: ChatMessage[];
    /**
     * Artemis message ids that have been explicitly suppressed by a stale-row drop
     * (C4). `addMessage` skips any row whose numeric `id` is in this set so a
     * chat-ws row arriving AFTER a `removeMessageById` call is never inserted
     * (guards both arrival orders).
     */
    suppressedIds: Set<number>;
    /**
     * Runtime-only fold state per proactive episode (C7). Keyed by
     * `proactiveEpisodeId`. `folded: true` collapses the group to a summary
     * fold-line. When `closeMessageId` is set (praise path), the group stays
     * expanded until the close row arrives and a ~5 s timer fires.
     * Reset in `clearMessages`; NOT populated in `applyLoadedMessages` (reloaded
     * episodes fold automatically via the `liveEpisodeIds` gate).
     */
    foldStates: Map<string, { folded: boolean; episodeLabel?: string; closeMessageId?: number; outcome?: 'RECOVERED' | 'DISMISSED' | 'ABANDONED' }>;
    /**
     * The episode ids currently considered live (C7). Two writers that agree:
     * the host's `setLiveEpisode` state frame (authoritative, re-sent on webview
     * init) and `addMessage` for proactive rows arriving live (covers the window
     * before the frame lands). Episodes absent from this set and without a
     * `foldStates` entry are reloaded episodes and fold automatically. NOT reset
     * in `clearMessages` (liveness is slot state, not session state) and NOT
     * populated in `applyLoadedMessages`.
     */
    liveEpisodeIds: Set<string>;
    /**
     * The server's echo of a prompt we drew optimistically, held back until
     * the POST names an id and settles whose message it is. Identity has to
     * come from the id: matching on text would fold another client's
     * identical message into our bubble and delete it.
     *
     * `localId` names the bubble this echo is waiting on. A signal about any
     * other bubble (a stale rejection, a later send) says nothing about this
     * echo and must leave it held.
     */
    pendingEcho: { message: ChatMessage; sessionId: number; localId: string } | null;
    /**
     * The conversation whose transcript is currently in `messages`. `null`
     * until the first transcript arrives; the webview shows the loader until
     * this matches the open conversation.
     */
    loadedSessionId: number | null;

    streaming: StreamingState;

    /**
     * "Iris is preparing the hint you asked for", mirrored from the host while a student-initiated
     * proactive help_request is in flight. Deliberately NOT folded into `streaming`: that one is
     * owned by the normal chat run, so `applyRunUi`, `resetTransientChatUi`, a history load and a
     * websocket disconnect all write it, and any of them would clear this out from under the host.
     * `setProactiveThinking` is the only writer here.
     */
    proactiveThinking: boolean;

    // Run UI (streaming draft, activities, run state), projected atomically
    // with the webview's active session/revision via applyRunUi/applyCommit.
    liveDraft: { runId: string; text: string } | null;
    activities: IrisActivityDTO[];
    runState: IrisRunState | null;
    runError: { message?: string } | null;
    /** Monotonic guard against out-of-order/stale run UI projections. */
    lastRunUiRevision: number;

    /** Replace the transcript with `sessionId`'s, and record the hydration. */
    applyLoadedMessages: (sessionId: number, messages: ChatMessage[]) => void;
    /**
     * Non-destructive counterpart to `applyLoadedMessages`, used by the
     * reconnect reconciliation path: merges a persisted history snapshot into
     * the live list instead of replacing it, so an in-flight optimistic bubble
     * survives. Ignored once `sessionId` is no longer the open conversation.
     */
    mergeLoadedMessages: (sessionId: number, messages: ChatMessage[]) => void;
    /** Patch the proactive outcome on the message with this Artemis id (optimistic collapse). */
    setProactiveOutcome: (messageId: number, outcome: NonNullable<ChatMessage['proactiveOutcome']>) => void;
    /**
     * Upserts by server `id`; messages without one always append (see
     * `upsertMessage`). `sessionId` is inert when omitted (the optimistic
     * bubble is drawn in whatever is open), and drops the message when
     * supplied AND it is not the open conversation.
     */
    addMessage: (message: ChatMessage, sessionId?: number) => void;
    /**
     * Apply a standalone run-UI snapshot (streaming draft/activities/run
     * state). Rejects a projection for a conversation we already left, or one
     * that is not strictly newer than the last applied revision.
     */
    applyRunUi: (projection: IrisRunUiProjection) => void;
    /**
     * Commit a message and (optionally) its run-UI projection in one atomic
     * update, so the webview can never observe the draft cleared before the
     * committed message lands. The message's conversation is checked
     * independently of the projection's, since a projection-less commit
     * (e.g. an error bubble) must not land in a conversation we already left.
     */
    applyCommit: (
        message: ChatMessage,
        projection: IrisRunUiProjection | undefined,
        messageSessionId: number,
    ) => void;
    /**
     * Mark a still-pending user message as failed. Returns `true` only if
     * a matching message was found AND it was a pending user send
     * (role === 'user' && status === 'sending'). Returning false lets the
     * caller skip the transient-UI reset when a rejection is stale
     * (e.g. arrived after the user already switched session or retried).
     */
    markMessageFailed: (
        localId: string,
        errorMessage: string,
        errorReason: NonNullable<ChatMessage['errorReason']>,
    ) => boolean;
    removeMessage: (localId: string) => void;
    /**
     * Remove the message with the given Artemis numeric id (if present) AND record
     * that id in `suppressedIds` so a chat-ws row with the same id arriving later
     * is never inserted. Drives the C4 stale-row suppression on both arrival orders.
     */
    removeMessageById: (id: number) => void;
    /**
     * Resolve a client-local offer bubble (spec B+): finds the message with the matching
     * `offer.offerId` and sets its `offer.answered`. No-op when no message matches (stale/foreign
     * offerId). The offer marker is ephemeral and never round-tripped from the server, so this is
     * the only writer of `answered`.
     */
    resolveOffer: (offerId: string, answered: 'accept' | 'decline' | 'timeout') => void;
    /** Host-owned mirror of an in-flight proactive help_request. See {@link proactiveThinking}. */
    setProactiveThinking: (on: boolean) => void;
    /**
     * Drop the transcript and everything derived from it: `messages`, the run
     * UI, `suppressedIds` and `foldStates`. `liveEpisodeIds` deliberately
     * survives, because it mirrors the host's slot state rather than this
     * conversation, and switching conversation does not end an episode.
     */
    clearMessages: () => void;
    /**
     * Record a fold instruction for an episode (C7). Called when the host sends
     * `FoldEpisode`. Without praise: folds immediately (`folded: true`). With
     * praise: stores `episodeLabel` + `closeMessageId` and waits for the
     * `ChatMessageList` timer to fire after the close row arrives.
     */
    foldEpisode: (episodeId: string, outcome: 'RECOVERED' | 'DISMISSED' | 'ABANDONED', praise?: { episodeLabel: string; closeMessageId: number }) => void;
    /**
     * Mark an episode as folded after the ~5 s timer fires (C7). Called by
     * `ChatMessageList` when the close row is present and the delay has elapsed.
     */
    setEpisodeFolded: (episodeId: string) => void;
    /** Collapse every proactive episode in the transcript to a fold line (student switched proactive help to Off). */
    foldAllEpisodes: () => void;
    /**
     * Host-authoritative live-episode snapshot: replaces `liveEpisodeIds`
     * wholesale (single slot => at most one live episode). Sent by the host on
     * every slot transition and re-sent on webview init, so a freshly created
     * webview renders the live episode open instead of folding it.
     */
    setLiveEpisode: (episodeId: string | null) => void;

    /**
     * Stamps a still-pending optimistic user bubble with its server id and
     * `status: 'sent'`. Before that, discards or flushes `pendingEcho` if it
     * is held for this `localId`, whether or not a matching bubble is still
     * in `messages`: a call for a `localId` with no bubble is not a no-op
     * when a held echo is still waiting on it.
     */
    confirmSentMessage: (localId: string, id: number) => void;
    /**
     * Releases a held `pendingEcho` into `messages` (or drops it if its
     * conversation has since been left), and clears the slot either way.
     * A no-op when nothing is held.
     */
    flushPendingEcho: () => void;

    startStreaming: () => void;

    resetTransientChatUi: () => void;
}

const IDLE_STREAMING: StreamingState = {
    isStreaming: false,
};

/** What the pure helpers below need; deliberately narrower than the store. */
type TranscriptStateRead = Pick<ChatTranscriptSlice, 'messages' | 'pendingEcho'>;

/**
 * Artemis resends a persisted message to attach memories or activities, so a
 * message with a known server id replaces its bubble instead of duplicating it.
 * Messages with no server id (optimistic and error bubbles) always append.
 */
function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
    if (message.id === undefined) { return [...messages, message]; }
    const byId = messages.findIndex((m) => m.id === message.id);
    if (byId !== -1) {
        const next = [...messages];
        next[byId] = { ...next[byId], ...message, localId: next[byId].localId };
        return next;
    }
    // Anything else is a message this list does not have yet, including the
    // server's echo of a prompt we drew optimistically when that echo beats our
    // own POST response. It is appended, and `confirmSentMessage` resolves the
    // two into one once the response names the id. `applyCommit` normally holds
    // that echo in `pendingEcho` before it reaches here (see `echoOwner`), so
    // this append is the fallback for when no bubble waits to claim it.
    return [...messages, message];
}

/**
 * The one optimistic user bubble waiting for its id, if there is exactly one.
 * An error bubble is not waiting for anything, so it does not count.
 */
function soleSendingBubble(messages: ChatMessage[]): ChatMessage | undefined {
    const pending = messages.filter(
        (m) => m.role === 'user' && m.id === undefined && m.status === 'sending',
    );
    return pending.length === 1 ? pending[0] : undefined;
}

/** The held echo is waiting on exactly this bubble. */
function ownsPendingEcho(state: TranscriptStateRead, localId: string): boolean {
    return state.pendingEcho?.localId === localId;
}

/**
 * The bubble `message` should be held against instead of being upserted
 * straight away, if any: a user message that already carries a server id,
 * while exactly one optimistic bubble is still waiting for one and nothing is
 * held yet. Only `applyCommit` calls this, since it is the path every wire
 * `addMessage` frame is routed through and the only way our own echo arrives.
 */
function echoOwner(state: TranscriptStateRead, message: ChatMessage): ChatMessage | undefined {
    if (message.role !== 'user' || message.id === undefined || state.pendingEcho !== null) {
        return undefined;
    }
    return soleSendingBubble(state.messages);
}

/**
 * Reads `currentSessionId` from the shell half through `get()`, and
 * `setIrisState` writes `pendingEcho` back the other way. Both are legitimate:
 * the composed store is one flat `ChatState`, and `set`/`get` are typed over
 * all of it.
 *
 * These bodies call `get()` rather than naming the store. The two are the same
 * live synchronous getter, but naming it from this file would be a genuine
 * runtime import cycle rather than the erased type-only one above.
 */
export const createChatTranscriptSlice: StateCreator<
    ChatState,
    [['zustand/devtools', never]],
    [],
    ChatTranscriptSlice
> = (set, get) => ({
            messages: [],
            suppressedIds: new Set<number>(),
            foldStates: new Map<string, { folded: boolean; episodeLabel?: string; closeMessageId?: number; outcome?: 'RECOVERED' | 'DISMISSED' | 'ABANDONED' }>(),
            liveEpisodeIds: new Set<string>(),
            pendingEcho: null,
            loadedSessionId: null,
            streaming: IDLE_STREAMING,
            proactiveThinking: false,
            liveDraft: null,
            activities: [],
            runState: null,
            runError: null,
            lastRunUiRevision: 0,

            applyLoadedMessages: (sessionId, messages) => {
                set({
                    messages,
                    loadedSessionId: sessionId,
                    // The server's own transcript replaces everything we were
                    // holding, and it already contains whatever the echo was.
                    pendingEcho: null,
                }, false, 'applyLoadedMessages');
            },

            mergeLoadedMessages: (sessionId, messages) => {
                if (sessionId !== get().currentSessionId) { return; }
                set((s) => ({ messages: mergeHistory(s.messages, messages) }), false, 'mergeLoadedMessages');
            },

            addMessage: (message, sessionId) => {
                if (sessionId !== undefined && sessionId !== get().currentSessionId) { return; }
                set((state) => {
                    // Stale-row suppression (C4): id was flagged by removeMessageById.
                    if (message.id !== undefined && state.suppressedIds.has(message.id)) {
                        return state;
                    }
                    // Track live episodes (C7): episodes that arrive via addMessage are "live"
                    // (not reloaded). The liveEpisodeIds gate controls auto-fold for reloaded rows.
                    const nextLiveEpisodeIds =
                        message.role === 'assistant' &&
                        message.origin === 'proactive' &&
                        message.proactiveEpisodeId
                            ? new Set([...state.liveEpisodeIds, message.proactiveEpisodeId])
                            : state.liveEpisodeIds;
                    // upsertMessage keeps the optimistic-vs-chat-ws pair a single row (by id).
                    return { messages: upsertMessage(state.messages, message), liveEpisodeIds: nextLiveEpisodeIds };
                }, false, 'addMessage');
            },

            setProactiveOutcome: (messageId, outcome) => {
                set((state) => ({
                    messages: state.messages.map((m) =>
                        m.id === messageId ? { ...m, proactiveOutcome: outcome } : m,
                    ),
                }), false, 'setProactiveOutcome');
            },

            applyRunUi: (projection) => {
                if (projection.sessionId !== get().currentSessionId) { return; }
                if (projection.revision <= get().lastRunUiRevision) { return; }
                set({
                    liveDraft: projection.draft,
                    activities: projection.activities,
                    runState: projection.runState,
                    runError: projection.error ?? null,
                    streaming: { isStreaming: projection.waiting },
                    lastRunUiRevision: projection.revision,
                }, false, 'applyRunUi');
            },

            applyCommit: (message, projection, messageSessionId) => {
                // Session-check the MESSAGE independently: a projection-less
                // error bubble still must not land in a conversation we left.
                const currentSessionId = get().currentSessionId;
                if (messageSessionId !== currentSessionId) { return; }

                // A user echo never carries a projection
                // (irisWebSocketMessageHandler's _renderForeignUserMessage
                // sends none), and a commit that does carry one must still be
                // applied atomically, so the hold is scoped to the
                // projection-less case only.
                if (projection === undefined) {
                    const state = get();
                    const owner = echoOwner(state, message);
                    if (owner && state.currentSessionId !== null) {
                        set(
                            { pendingEcho: { message, sessionId: state.currentSessionId, localId: owner.localId } },
                            false,
                            'holdEcho',
                        );
                        return;
                    }
                }

                // One set() so the message and its run state can never be
                // observed apart, and the draft is never cleared first.
                set((s) => {
                    // Stale-row suppression (C4): a suppressed id must never be
                    // re-inserted, even when it rides in on a run/proactive commit.
                    if (message.id !== undefined && s.suppressedIds.has(message.id)) { return s; }
                    const messages = upsertMessage(s.messages, message);
                    // Track live episodes (C7): a proactive row arriving via a commit
                    // (this is the sole AddMessage path in the webview) is "live".
                    const nextLiveEpisodeIds =
                        message.role === 'assistant' &&
                        message.origin === 'proactive' &&
                        message.proactiveEpisodeId
                            ? new Set([...s.liveEpisodeIds, message.proactiveEpisodeId])
                            : s.liveEpisodeIds;
                    const accepts = projection !== undefined
                        && projection.sessionId === currentSessionId
                        && projection.revision > s.lastRunUiRevision;
                    if (!accepts) { return { messages, liveEpisodeIds: nextLiveEpisodeIds }; }
                    return {
                        messages,
                        liveEpisodeIds: nextLiveEpisodeIds,
                        liveDraft: projection.draft,
                        activities: projection.activities,
                        runState: projection.runState,
                        runError: projection.error ?? null,
                        streaming: { isStreaming: projection.waiting },
                        lastRunUiRevision: projection.revision,
                    };
                }, false, 'applyCommit');
            },

            markMessageFailed: (localId, errorMessage, errorReason) => {
                const current = get().messages;
                const target = current.find((m) => m.localId === localId);
                if (!target || target.role !== 'user' || target.status !== 'sending') {
                    return false;
                }
                // The send is over and will never name an id, so if it was the
                // bubble the held echo was waiting on, that echo belongs to
                // somebody else and must be shown now. Kept after the guard
                // above: a call that marks nothing failed must not release the
                // buffer either.
                if (ownsPendingEcho(get(), localId)) {
                    get().flushPendingEcho();
                }
                set((state) => ({
                    messages: state.messages.map((m) =>
                        m.localId === localId
                            ? { ...m, status: 'error' as const, errorMessage, errorReason }
                            : m,
                    ),
                }), false, 'markMessageFailed');
                return true;
            },

            removeMessage: (localId) => {
                // Release only when the bubble that was waiting is the one
                // going away. A retry removes the PREVIOUS failed bubble
                // first, which must not release anything.
                //
                // Unlike `markMessageFailed`, this releases on `localId`
                // ownership alone: a `pendingEcho` is only ever armed for a
                // bubble that was in `messages` at capture time, and the only
                // other path that removes a bubble (`applyLoadedMessages`)
                // clears `pendingEcho` itself.
                if (ownsPendingEcho(get(), localId)) {
                    get().flushPendingEcho();
                }
                set((state) => ({
                    messages: state.messages.filter((m) => m.localId !== localId),
                }), false, 'removeMessage');
            },

            removeMessageById: (id) => {
                set((state) => {
                    const next = new Set(state.suppressedIds);
                    next.add(id);
                    return {
                        messages: state.messages.filter((m) => m.id !== id),
                        suppressedIds: next,
                    };
                }, false, 'removeMessageById');
            },

            setProactiveThinking: (on) => {
                set({ proactiveThinking: on }, false, 'setProactiveThinking');
            },

            resolveOffer: (offerId, answered) => {
                set((state) => ({
                    messages: state.messages.map((m) =>
                        m.offer?.offerId === offerId ? { ...m, offer: { ...m.offer, answered } } : m,
                    ),
                }), false, 'resolveOffer');
            },

            foldEpisode: (episodeId, outcome, praise) => {
                set((state) => {
                    const nextFoldStates = new Map(state.foldStates);
                    if (praise) {
                        nextFoldStates.set(episodeId, {
                            folded: false,
                            outcome,
                            episodeLabel: praise.episodeLabel,
                            closeMessageId: praise.closeMessageId,
                        });
                    } else {
                        nextFoldStates.set(episodeId, { folded: true, outcome });
                    }
                    return { foldStates: nextFoldStates };
                }, false, 'foldEpisode');
            },

            setEpisodeFolded: (episodeId) => {
                set((state) => {
                    const existing = state.foldStates.get(episodeId);
                    if (!existing) { return state; }
                    const nextFoldStates = new Map(state.foldStates);
                    nextFoldStates.set(episodeId, { ...existing, folded: true });
                    return { foldStates: nextFoldStates };
                }, false, 'setEpisodeFolded');
            },

            foldAllEpisodes: () => {
                set((state) => {
                    // Collapse every proactive episode to a fold line. folded=true is authoritative in the
                    // closed-ness check (independent of liveEpisodeIds), so this is durable; the outcome is
                    // left undefined and the fold line falls back to the neutral "Earlier hint" summary.
                    const nextFoldStates = new Map(state.foldStates);
                    let changed = false;
                    for (const m of state.messages) {
                        if (m.origin !== 'proactive' || !m.proactiveEpisodeId) { continue; }
                        const existing = nextFoldStates.get(m.proactiveEpisodeId);
                        if (existing?.folded) { continue; }
                        nextFoldStates.set(m.proactiveEpisodeId, existing ? { ...existing, folded: true } : { folded: true });
                        changed = true;
                    }
                    return changed ? { foldStates: nextFoldStates } : state;
                }, false, 'foldAllEpisodes');
            },

            setLiveEpisode: (episodeId) => {
                set({
                    liveEpisodeIds: new Set<string>(episodeId !== null ? [episodeId] : []),
                }, false, 'setLiveEpisode');
            },

            flushPendingEcho: () => {
                const held = get().pendingEcho;
                if (!held) { return; }
                set((s) => ({
                    // Only into the conversation it was captured in. A held
                    // echo whose conversation has been left is already part of
                    // the transcript the server hands over on the way back, so
                    // dropping it there loses nothing.
                    messages: held.sessionId === s.currentSessionId
                        ? upsertMessage(s.messages, held.message)
                        : s.messages,
                    pendingEcho: null,
                }), false, 'flushPendingEcho');
            },

            clearMessages: () => {
                // liveEpisodeIds deliberately survives: it mirrors the host's slot state,
                // which does not change when the user switches sessions.
                set({
                    messages: [],
                    suppressedIds: new Set<number>(),
                    foldStates: new Map<string, { folded: boolean; episodeLabel?: string; closeMessageId?: number; outcome?: 'RECOVERED' | 'DISMISSED' | 'ABANDONED' }>(),
                    streaming: IDLE_STREAMING,
                    liveDraft: null,
                    activities: [],
                    runState: null,
                    runError: null,
                    lastRunUiRevision: 0,
                }, false, 'clearMessages');
            },

            confirmSentMessage: (localId, id) => {
                const store = get();
                if (ownsPendingEcho(store, localId)) {
                    // The id settles whose message it is. Equal means the
                    // bubble and the echo are one message and the echo is
                    // redundant; different means it was somebody else's and
                    // has been waiting to be shown. Discarding rather than
                    // flushing leaves the LOCAL row as the survivor, where the
                    // branch below (echo already in `messages`, no hold) keeps
                    // the SERVER row instead.
                    if (store.pendingEcho?.message.id === id) {
                        set({ pendingEcho: null }, false, 'discardEcho');
                    } else {
                        store.flushPendingEcho();
                    }
                }
                set((s) => {
                    // The echo may already be here (it can outrun the POST
                    // response). Then this bubble and that row are the SAME
                    // message, proven by the id rather than guessed from the
                    // text, so the optimistic one goes and the server one stays.
                    const bubble = s.messages.findIndex((m) => m.localId === localId && m.role === 'user');
                    const echo = s.messages.findIndex((m) => m.id === id);
                    if (bubble !== -1 && echo !== -1 && echo !== bubble) {
                        const messages = s.messages
                            .map((m, i) => (i === echo ? { ...m, status: 'sent' as const } : m))
                            .filter((_, i) => i !== bubble);
                        return { messages };
                    }
                    return {
                        messages: s.messages.map((m) =>
                            m.localId === localId && m.role === 'user'
                                ? { ...m, id, status: 'sent' as const }
                                : m,
                        ),
                    };
                }, false, 'confirmSentMessage');
            },

            startStreaming: () => {
                set({
                    streaming: { isStreaming: true },
                }, false, 'startStreaming');
            },

            resetTransientChatUi: () => {
                set({
                    streaming: IDLE_STREAMING,
                    liveDraft: null,
                    activities: [],
                    runState: null,
                    runError: null,
                    lastRunUiRevision: 0,
                }, false, 'resetTransientChatUi');
            },
});
