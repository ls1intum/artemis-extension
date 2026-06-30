import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { ExtMsg, WebSocketDisplayStatus } from '@shared/messageContracts';

import type {
    ChatContext,
    ChatMessage,
    ChatSession,
    ContextItem,
    IrisStageDTO,
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
     * Runtime-only map from Artemis message id to the live stale-ask binding
     * (C6). Set by `attachStaleAsk` when the host sends `AddStaleAsk`. Reset
     * in `clearMessages`; NOT repopulated in `applyLoadedMessages` (reloaded
     * rows have no live askId, so their buttons do not render).
     */
    staleAskBindings: Map<number, { askId: string; question: string }>;

    // Streaming
    streaming: StreamingState;

    // Iris processing stages
    irisStages: IrisStageDTO[];

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
    addMessage: (message: ChatMessage) => void;
    /** Patch the proactive outcome on the message with this Artemis id (optimistic collapse). */
    setProactiveOutcome: (messageId: number, outcome: NonNullable<ChatMessage['proactiveOutcome']>) => void;
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
    clearMessages: () => void;
    /**
     * Attach a live stale-ask binding to the message identified by `messageId`
     * (C6). Adds an entry to `staleAskBindings` AND patches the message row with
     * `staleAsk: true` so the Dismiss button is hidden. Handles both arrival
     * orders: if the binding arrives before the message row (row not yet in
     * `messages`), the patch is a no-op for now and `addMessage` applies
     * `staleAsk: true` when the row eventually arrives.
     */
    attachStaleAsk: (messageId: number, askId: string, question: string) => void;

    // Streaming actions
    startStreaming: () => void;

    // Iris stage actions
    setIrisStages: (stages: IrisStageDTO[]) => void;
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
            messages: [],
            messageLoad: null,
            suppressedIds: new Set<number>(),
            staleAskBindings: new Map<number, { askId: string; question: string }>(),
            streaming: IDLE_STREAMING,
            irisStages: [],
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
                set((state) => {
                    if (message.id !== undefined) {
                        // Dedup: already present (optimistic bubble vs chat-ws row)
                        if (state.messages.some(m => m.id === message.id)) {
                            return state;
                        }
                        // Stale-row suppression (C4): id was flagged by removeMessageById
                        if (state.suppressedIds.has(message.id)) {
                            return state;
                        }
                    }
                    // Stale-ask binding-before-row (C6): if `attachStaleAsk` arrived
                    // before this message, mark the row immediately so Dismiss is hidden.
                    const hasBinding = message.id !== undefined && state.staleAskBindings.has(message.id);
                    const finalMessage = hasBinding ? { ...message, staleAsk: true as const } : message;
                    return { messages: [...state.messages, finalMessage] };
                }, false, 'addMessage');
            },

            setProactiveOutcome: (messageId, outcome) => {
                set((state) => ({
                    messages: state.messages.map((m) =>
                        m.id === messageId ? { ...m, proactiveOutcome: outcome } : m,
                    ),
                }), false, 'setProactiveOutcome');
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

            attachStaleAsk: (messageId, askId, question) => {
                set((state) => {
                    const nextBindings = new Map(state.staleAskBindings);
                    nextBindings.set(messageId, { askId, question });
                    // Patch the message with staleAsk: true if it already exists.
                    // If the row has not arrived yet, addMessage will apply the flag
                    // when it detects the pre-existing binding (row-after-binding path).
                    const messages = state.messages.map((m) =>
                        m.id === messageId ? { ...m, staleAsk: true as const } : m,
                    );
                    return { staleAskBindings: nextBindings, messages };
                }, false, 'attachStaleAsk');
            },

            clearMessages: () => {
                set({
                    messages: [],
                    messageLoad: null,
                    suppressedIds: new Set<number>(),
                    staleAskBindings: new Map<number, { askId: string; question: string }>(),
                    irisStages: [],
                    streaming: IDLE_STREAMING,
                }, false, 'clearMessages');
            },

            // Streaming actions
            startStreaming: () => {
                set({
                    streaming: { isStreaming: true },
                }, false, 'startStreaming');
            },

            setIrisStages: (stages) => {
                set({ irisStages: stages }, false, 'setIrisStages');
            },

            resetTransientChatUi: () => {
                set({
                    irisStages: [],
                    streaming: IDLE_STREAMING,
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
