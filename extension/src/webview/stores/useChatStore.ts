import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { ExtMsg, IrisRunUiProjection, WebSocketDisplayStatus } from '@shared/messageContracts';
import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

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
     * `unavailableMessage` — nothing about chat availability changed, only
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
    /** Record that hydration failed for the given session. */
    setMessageLoadError: (localSessionId: string) => void;
    /** Upserts by server `id`; messages without one always append (see `upsertMessage`). */
    addMessage: (message: ChatMessage) => void;
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

            setMessageLoadError: (localSessionId) => {
                set({
                    messageLoad: { localSessionId, status: 'error' },
                }, false, 'setMessageLoadError');
            },

            addMessage: (message) => {
                set((state) => ({ messages: upsertMessage(state.messages, message) }), false, 'addMessage');
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
                    const messages = upsertMessage(s.messages, message);
                    const accepts = projection !== undefined
                        && projection.localSessionId === activeLocalSessionId
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
        }),
        {
            name: 'ChatStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
