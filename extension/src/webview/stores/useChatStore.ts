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

/**
 * Conversation-first wire shape (Task 10), narrowed field-by-field below
 * instead of duplicated by hand, so a store field can never silently drift
 * from the wire type it mirrors.
 */
type WireIrisState = ExtMsg<'updateIrisState'>['state'];
type ConversationTopic = NonNullable<WireIrisState['committedContext']>;
type ContentState = NonNullable<WireIrisState['contentState']>;
type ConversationSummary = NonNullable<WireIrisState['conversations']>[number];

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

    // Conversation-first mirror (Task 11). Additive alongside `context` /
    // `activeSessionId` / `sessions` above: those stay live until the
    // provider is rewired (Task 14) and are deleted only in Task 15.
    // `null` follows the file's existing "absent" convention (see
    // `openSessionError`, `disabledMessage`) rather than `undefined`.
    /** The open conversation's course id (Task 12 CoursePicker: marks the current course). */
    courseId: number | null;
    /** The open conversation's course title (Task 12 header line 1, opens CoursePicker). */
    courseTitle: string | null;
    /** The one server conversation this webview mirrors, if any. */
    currentSessionId: number | null;
    /** The open conversation's title (Task 12 header line 2, beside `displayMessageCount`). */
    conversationTitle: string | null;
    /**
     * Displayed message count, excluding CTXSWAP rows (Task 12 header line 2).
     * Display only, never the ownership predicate. `0`, not `null`, is the
     * absent value: it is a count, not an identity reference, so it follows
     * `sendInFlight`/`navigationInFlight`'s "falsy default of its own type"
     * convention rather than the `| null` one used for id/title fields.
     */
    displayMessageCount: number;
    /** The conversation's persisted topic. */
    committedContext: ConversationTopic | null;
    /** A topic staged but not yet committed (e.g. mid-navigation). */
    pendingContext: ConversationTopic | null;
    /** 'unknown' disables the topic picker, the chip remove icon and Ask-Iris. */
    contentState: ContentState;
    sendInFlight: boolean;
    navigationInFlight: boolean;
    /** Course-wide conversation list for the topic picker / history. */
    conversations: ConversationSummary[];
    /** The detected workspace exercise, when any (Task 12 ContextPicker pin/badge). */
    workspaceExerciseId: number | null;
    /**
     * An actionless informational banner (e.g. a server-initiated repoint).
     * Cleared by the next `setIrisState`, matching "a notice is cleared by
     * any navigation or course change" from the design.
     */
    notice: { text: string } | null;
    /**
     * Composer draft text. Lifted out of `ChatInput`'s local `useState`
     * (Task 11); the component itself is not rewired until Task 12.
     */
    composerText: string;

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
    mergeLoadedMessages: (localSessionId: string, messages: ChatMessage[], sessionId?: number) => void;
    /** Record that hydration failed for the given session. */
    setMessageLoadError: (localSessionId: string) => void;
    /**
     * Upserts by server `id`; messages without one always append (see
     * `upsertMessage`). `sessionId` is the conversation-first counterpart to
     * the `localSessionId`-keyed guards elsewhere in this store (Task 11):
     * inert when omitted, and drops the message only when supplied AND it
     * does not match `currentSessionId`, so Task 14 can start passing it in
     * one call site at a time without a breaking signature change here.
     */
    addMessage: (message: ChatMessage, sessionId?: number) => void;
    /**
     * Apply a standalone run-UI snapshot (streaming draft/activities/run
     * state). Rejects a projection for a session we already left, or one
     * that is not strictly newer than the last applied revision. Also
     * honours `projection.sessionId` beside `projection.localSessionId`
     * (inert when the projection carries none, see `addMessage`).
     */
    applyRunUi: (projection: IrisRunUiProjection, activeLocalSessionId: string) => void;
    /**
     * Commit a message and (optionally) its run-UI projection in one atomic
     * update, so the webview can never observe the draft cleared before the
     * committed message lands. The message's session is checked
     * independently of the projection's, since a projection-less commit
     * (e.g. an error bubble) still must not land in a session we already
     * left. `messageSessionId` is the conversation-first counterpart to
     * `messageLocalSessionId` (inert when omitted, see `addMessage`); the
     * projection's own `sessionId` (if any) is honoured the same way.
     */
    applyCommit: (
        message: ChatMessage,
        projection: IrisRunUiProjection | undefined,
        messageLocalSessionId: string,
        activeLocalSessionId: string,
        messageSessionId?: number,
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
    /** Stamps a still-pending optimistic user bubble with its server id and `status: 'sent'`. No-op if no such bubble exists. */
    confirmSentMessage: (localId: string, id: number) => void;
    clearMessages: () => void;

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

    // Conversation-first actions (Task 11)
    /** Sets the composer's draft text (lifted out of `ChatInput`'s local state, see above). */
    setComposerText: (text: string) => void;
    /** Raises an actionless chat notice. Cleared by the next `setIrisState` call. */
    showNotice: (notice: { text: string }) => void;
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
            courseId: null,
            courseTitle: null,
            currentSessionId: null,
            conversationTitle: null,
            displayMessageCount: 0,
            committedContext: null,
            pendingContext: null,
            contentState: 'unknown',
            sendInFlight: false,
            navigationInFlight: false,
            conversations: [],
            workspaceExerciseId: null,
            notice: null,
            composerText: '',
            courseHistory: { status: 'idle', entries: [], requestId: 0 },
            openSessionError: null,
            messages: [],
            messageLoad: null,
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
                    courseId: state.courseId ?? null,
                    courseTitle: state.courseTitle ?? null,
                    currentSessionId: state.currentSessionId ?? null,
                    conversationTitle: state.conversationTitle ?? null,
                    displayMessageCount: state.displayMessageCount ?? 0,
                    committedContext: state.committedContext ?? null,
                    pendingContext: state.pendingContext ?? null,
                    contentState: state.contentState ?? 'unknown',
                    sendInFlight: state.sendInFlight ?? false,
                    navigationInFlight: state.navigationInFlight ?? false,
                    conversations: state.conversations ?? [],
                    workspaceExerciseId: state.workspaceExerciseId ?? null,
                    // A notice is cleared by any navigation or course change
                    // (the design's phrasing), and setIrisState is the sole
                    // vehicle that carries a navigation result today.
                    notice: null,
                }, false, 'setIrisState');
            },

            applyLoadedMessages: (localSessionId, messages) => {
                set({
                    messages,
                    messageLoad: { localSessionId, status: 'success' },
                }, false, 'applyLoadedMessages');
            },

            mergeLoadedMessages: (localSessionId, messages, sessionId) => {
                if (localSessionId !== useChatStore.getState().activeSessionId) { return; }
                if (sessionId !== undefined && sessionId !== useChatStore.getState().currentSessionId) { return; }
                set((s) => ({ messages: mergeHistory(s.messages, messages) }), false, 'mergeLoadedMessages');
            },

            setMessageLoadError: (localSessionId) => {
                set({
                    messageLoad: { localSessionId, status: 'error' },
                }, false, 'setMessageLoadError');
            },

            addMessage: (message, sessionId) => {
                if (sessionId !== undefined && sessionId !== useChatStore.getState().currentSessionId) { return; }
                set((state) => ({ messages: upsertMessage(state.messages, message) }), false, 'addMessage');
            },

            applyRunUi: (projection, activeLocalSessionId) => {
                if (projection.localSessionId !== activeLocalSessionId) { return; }
                if (projection.sessionId !== undefined && projection.sessionId !== useChatStore.getState().currentSessionId) { return; }
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

            applyCommit: (message, projection, messageLocalSessionId, activeLocalSessionId, messageSessionId) => {
                // Session-check the MESSAGE independently: a projection-less
                // error bubble still must not land in a session we already left.
                if (messageLocalSessionId !== activeLocalSessionId) { return; }
                const currentSessionId = useChatStore.getState().currentSessionId;
                if (messageSessionId !== undefined && messageSessionId !== currentSessionId) { return; }

                // One set() so the message and its run state can never be
                // observed apart, and the draft is never cleared first.
                set((s) => {
                    const messages = upsertMessage(s.messages, message);
                    const accepts = projection !== undefined
                        && projection.localSessionId === activeLocalSessionId
                        && (projection.sessionId === undefined || projection.sessionId === currentSessionId)
                        && projection.revision > s.lastRunUiRevision;
                    if (!accepts) { return { messages }; }
                    return {
                        messages,
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
                set({
                    messages: [],
                    messageLoad: null,
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

            // Conversation-first actions (Task 11)
            setComposerText: (text) => {
                set({ composerText: text }, false, 'setComposerText');
            },

            showNotice: (notice) => {
                set({ notice }, false, 'showNotice');
            },
        }),
        {
            name: 'ChatStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);

/**
 * Whether the topic picker (and the chip's remove icon, and Ask-Iris) may be
 * used right now. Deliberately NOT a stored field: `contentState`,
 * `sendInFlight` and `navigationInFlight` are each written from a single
 * place today (`setIrisState`), but a hand-synced `canChangeTopic` field
 * would silently go stale the moment a second writer appears (Task 14 adds
 * more). Computing it fresh on every read makes that impossible.
 */
export function selectCanChangeTopic(
    state: Pick<ChatState, 'contentState' | 'sendInFlight' | 'navigationInFlight'>,
): boolean {
    return state.contentState !== 'unknown' && !state.sendInFlight && !state.navigationInFlight;
}
