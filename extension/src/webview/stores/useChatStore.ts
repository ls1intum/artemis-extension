import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { ExtMsg, IrisRunUiProjection, WebSocketDisplayStatus } from '@shared/messageContracts';
import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import { mergeHistory } from '@webview/stores/mergeHistory';
import type { CourseHistoryEntryVM } from '@webview/views/IrisChat/historyBuckets';
import type {
    ChatContext,
    ChatMessage,
    ChatSession,
    ContextItem,
    ReferencedFilesData,
    StreamingState,
} from '@webview/views/IrisChat/types';

/**
 * Webview-side connection status. Mirrors the extension's
 * {@link WebSocketDisplayStatus} plus a synthetic 'unknown' state used for
 * the very first render before any extension push has arrived. 'unknown'
 * intentionally renders nothing — it suppresses the cold-start banner flash.
 */
type ChatWebSocketStatus = WebSocketDisplayStatus | 'unknown';


interface MessageLoadResult {
    localSessionId: string;
    status: 'success' | 'error';
}

/**
 * Course-wide conversation history for the ConversationHistory popover
 * (Task 11). `requestId` is the latest `requestCourseHistory` request the
 * webview has issued; `applyCourseHistory`/`setCourseHistoryError` ignore
 * any response whose `requestId` does not match it, so a slow response for
 * a course the user has since navigated away from cannot land here.
 */
interface CourseHistoryState {
    status: 'idle' | 'loading' | 'error' | 'ready';
    entries: CourseHistoryEntryVM[];
    requestId: number;
}

interface ChatState {
    // Context
    context: ChatContext | null;
    activeSessionId: string | null;
    sessions: ChatSession[];
    /**
     * Flips to true on the first UpdateIrisState. Lets the renderer
     * distinguish "no session" from "snapshot pending" so the cold-mount
     * frame stays on the loader instead of flashing the welcome state.
     */
    hasReceivedInitialIrisState: boolean;
    exercises: ContextItem[];
    courses: ContextItem[];

    // Course-wide conversation history (ConversationHistory popover)
    courseHistory: CourseHistoryState;
    /**
     * Task 10's cross-context `openArtemisSession` failure. Distinct from
     * `unavailableMessage`: nothing about chat availability changed, only
     * the specific row the user clicked could not be opened, so it renders
     * as an inline banner inside the history popover rather than the global
     * banner.
     */
    openSessionError: string | null;

    // Messages
    messages: ChatMessage[];
    /**
     * Outcome of the most recent message hydration. `null` means we have
     * not yet received a load result for any session; the webview shows
     * the loader until this matches the active session.
     */
    messageLoad: MessageLoadResult | null;
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

    // Streaming
    streaming: StreamingState;

    // Run UI (streaming draft, activities, run state) — projected atomically
    // with the webview's active session/revision via applyRunUi/applyCommit.
    liveDraft: { runId: string; text: string } | null;
    activities: IrisActivityDTO[];
    runState: IrisRunState | null;
    runError: { message?: string } | null;
    /** Monotonic guard against out-of-order/stale run UI projections. */
    lastRunUiRevision: number;

    // UI state
    isLoading: boolean;
    webSocketStatus: ChatWebSocketStatus;
    disabledMessage: string | null;   // Non-null = Iris disabled (reason as string)
    /**
     * Non-null = Iris is currently unreachable due to a transient infrastructure
     * failure (network, 5xx, timeout). Distinct from `disabledMessage`, which
     * means Iris is intentionally off for this context. Mutually exclusive: a
     * Set on one always clears the other.
     */
    unavailableMessage: string | null;
    isNoAiDetected: boolean;
    referencedFiles: ReferencedFilesData | null;
    showDiagnostics: boolean;

    // Actions
    setIrisState: (state: ExtMsg<'updateIrisState'>['state']) => void;
    /** Apply messages and record a successful hydration for the given session. */
    applyLoadedMessages: (localSessionId: string, messages: ChatMessage[]) => void;
    /**
     * Non-destructive counterpart to `applyLoadedMessages`, used by the
     * reconnect reconciliation path: merges a persisted history snapshot
     * into the live list instead of replacing it, so an in-flight optimistic
     * bubble survives. Ignored if `localSessionId` no longer matches the
     * active session (the reconcile landed after a session switch).
     */
    mergeLoadedMessages: (localSessionId: string, messages: ChatMessage[]) => void;
    /** Record that hydration failed for the given session. */
    setMessageLoadError: (localSessionId: string) => void;
    /** Upserts by server `id`; messages without one always append (see `upsertMessage`). */
    addMessage: (message: ChatMessage) => void;
    /** Patch the proactive outcome on the message with this Artemis id (optimistic collapse). */
    setProactiveOutcome: (messageId: number, outcome: NonNullable<ChatMessage['proactiveOutcome']>) => void;
    /**
     * Apply a standalone run-UI snapshot (streaming draft/activities/run
     * state). Rejects a projection for a session we already left, or one
     * that is not strictly newer than the last applied revision.
     */
    applyRunUi: (projection: IrisRunUiProjection, activeLocalSessionId: string) => void;
    /**
     * Commit a message and (optionally) its run-UI projection in one atomic
     * update, so the webview can never observe the draft cleared before the
     * committed message lands. The message's session is checked
     * independently of the projection's, since a projection-less commit
     * (e.g. an error bubble) still must not land in a session we already
     * left.
     */
    applyCommit: (
        message: ChatMessage,
        projection: IrisRunUiProjection | undefined,
        messageLocalSessionId: string,
        activeLocalSessionId: string,
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
    /** Stamps a still-pending optimistic user bubble with its server id and `status: 'sent'`. No-op if no such bubble exists. */
    confirmSentMessage: (localId: string, id: number) => void;
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

    // Course history actions
    /** Bumps `requestId` and moves the slice to `loading`. */
    setCourseHistoryLoading: (requestId: number) => void;
    /** Ignored if `requestId` no longer matches the slice's current `requestId`. */
    applyCourseHistory: (requestId: number, entries: CourseHistoryEntryVM[]) => void;
    /** Ignored (stale) if `requestId` no longer matches the slice's current `requestId`. */
    setCourseHistoryError: (requestId: number) => void;
    setOpenSessionError: (message: string | null) => void;

    // Streaming actions
    startStreaming: () => void;

    resetTransientChatUi: () => void;

    // UI actions
    setLoading: (loading: boolean) => void;
    setWebSocketStatus: (status: ChatWebSocketStatus) => void;
    setDisabledMessage: (message: string | null) => void;
    setUnavailableMessage: (message: string | null) => void;
    setNoAiDetected: (detected: boolean) => void;
    setReferencedFiles: (data: ReferencedFilesData | null) => void;
    setShowDiagnostics: (show: boolean) => void;
}

const IDLE_STREAMING: StreamingState = {
    isStreaming: false,
};

/**
 * Artemis resends a persisted message to attach memories or activities, so a
 * message with a known server id replaces its bubble instead of duplicating it.
 * Messages with no server id (optimistic and error bubbles) always append.
 */
function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
    if (message.id === undefined) { return [...messages, message]; }
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx === -1) { return [...messages, message]; }
    const next = [...messages];
    next[idx] = { ...next[idx], ...message, localId: next[idx].localId };
    return next;
}

export const useChatStore = create<ChatState>()(
    devtools(
        (set) => ({
            // Initial state
            context: null,
            activeSessionId: null,
            sessions: [],
            hasReceivedInitialIrisState: false,
            exercises: [],
            courses: [],
            courseHistory: { status: 'idle', entries: [], requestId: 0 },
            openSessionError: null,
            messages: [],
            messageLoad: null,
            suppressedIds: new Set<number>(),
            foldStates: new Map<string, { folded: boolean; episodeLabel?: string; closeMessageId?: number; outcome?: 'RECOVERED' | 'DISMISSED' | 'ABANDONED' }>(),
            liveEpisodeIds: new Set<string>(),
            streaming: IDLE_STREAMING,
            liveDraft: null,
            activities: [],
            runState: null,
            runError: null,
            lastRunUiRevision: 0,
            isLoading: false,
            webSocketStatus: 'unknown',
            disabledMessage: null,
            unavailableMessage: null,
            isNoAiDetected: false,
            referencedFiles: null,
            showDiagnostics: false,

            // Actions
            setIrisState: (state) => {
                set({
                    context: state.context ? {
                        type: state.context.type,
                        id: state.context.id,
                        title: state.context.title,
                        shortName: state.context.shortName,
                        courseId: state.context.courseId,
                        locked: state.context.locked,
                        source: state.context.source,
                    } : null,
                    activeSessionId: state.activeSessionId,
                    sessions: state.sessions.map(s => ({
                        id: s.id,
                        artemisSessionId: s.artemisSessionId,
                        preview: s.preview,
                        title: s.title,
                        messageCount: s.messageCount,
                        createdAt: s.createdAt,
                        lastActivity: s.lastActivity,
                    })),
                    exercises: state.exercises,
                    courses: state.courses,
                    hasReceivedInitialIrisState: true,
                }, false, 'setIrisState');
            },

            applyLoadedMessages: (localSessionId, messages) => {
                set({
                    messages,
                    messageLoad: { localSessionId, status: 'success' },
                }, false, 'applyLoadedMessages');
            },

            mergeLoadedMessages: (localSessionId, messages) => {
                if (localSessionId !== useChatStore.getState().activeSessionId) { return; }
                set((s) => ({ messages: mergeHistory(s.messages, messages) }), false, 'mergeLoadedMessages');
            },

            setMessageLoadError: (localSessionId) => {
                set({
                    messageLoad: { localSessionId, status: 'error' },
                }, false, 'setMessageLoadError');
            },

            addMessage: (message) => {
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

            applyRunUi: (projection, activeLocalSessionId) => {
                if (projection.localSessionId !== activeLocalSessionId) { return; }
                if (projection.revision <= useChatStore.getState().lastRunUiRevision) { return; }
                set({
                    liveDraft: projection.draft,
                    activities: projection.activities,
                    runState: projection.runState,
                    runError: projection.error ?? null,
                    streaming: { isStreaming: projection.waiting },
                    lastRunUiRevision: projection.revision,
                }, false, 'applyRunUi');
            },

            applyCommit: (message, projection, messageLocalSessionId, activeLocalSessionId) => {
                // Session-check the MESSAGE independently: a projection-less
                // error bubble still must not land in a session we already left.
                if (messageLocalSessionId !== activeLocalSessionId) { return; }

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
                        && projection.localSessionId === activeLocalSessionId
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
                const current = useChatStore.getState().messages;
                const target = current.find((m) => m.localId === localId);
                if (!target || target.role !== 'user' || target.status !== 'sending') {
                    return false;
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

            confirmSentMessage: (localId, id) => {
                set((s) => ({
                    messages: s.messages.map((m) =>
                        m.localId === localId && m.role === 'user'
                            ? { ...m, id, status: 'sent' as const }
                            : m,
                    ),
                }), false, 'confirmSentMessage');
            },

            clearMessages: () => {
                // liveEpisodeIds deliberately survives: it mirrors the host's slot state,
                // which does not change when the user switches sessions.
                set({
                    messages: [],
                    messageLoad: null,
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

            setCourseHistoryLoading: (requestId) => {
                set({
                    courseHistory: { status: 'loading', entries: [], requestId },
                }, false, 'setCourseHistoryLoading');
            },

            applyCourseHistory: (requestId, entries) => {
                if (requestId !== useChatStore.getState().courseHistory.requestId) { return; }
                set({
                    courseHistory: { status: 'ready', entries, requestId },
                }, false, 'applyCourseHistory');
            },

            setCourseHistoryError: (requestId) => {
                if (requestId !== useChatStore.getState().courseHistory.requestId) { return; }
                set({
                    courseHistory: { status: 'error', entries: [], requestId },
                }, false, 'setCourseHistoryError');
            },

            setOpenSessionError: (message) => {
                set({ openSessionError: message }, false, 'setOpenSessionError');
            },

            // Streaming actions
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

            // UI actions
            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            setWebSocketStatus: (status) => {
                set({ webSocketStatus: status }, false, 'setWebSocketStatus');
            },

            setDisabledMessage: (message) => {
                // Setting a real disabled reason clears any transient
                // unavailable banner — disabled is a strictly more specific
                // signal. Clearing (null) leaves unavailable untouched.
                set(
                    message === null
                        ? { disabledMessage: null }
                        : { disabledMessage: message, unavailableMessage: null },
                    false,
                    'setDisabledMessage',
                );
            },

            setUnavailableMessage: (message) => {
                // Symmetric to setDisabledMessage: setting a real unavailable
                // reason clears any stale disabled banner (defensive — the
                // extension-side helper normally enforces this already).
                set(
                    message === null
                        ? { unavailableMessage: null }
                        : { unavailableMessage: message, disabledMessage: null },
                    false,
                    'setUnavailableMessage',
                );
            },

            setNoAiDetected: (detected) => {
                set({ isNoAiDetected: detected }, false, 'setNoAiDetected');
            },

            setReferencedFiles: (data) => {
                set({ referencedFiles: data }, false, 'setReferencedFiles');
            },

            setShowDiagnostics: (show) => {
                set({ showDiagnostics: show }, false, 'setShowDiagnostics');
            },
        }),
        {
            name: 'ChatStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
