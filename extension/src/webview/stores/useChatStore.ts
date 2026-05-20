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
} from '../views/IrisChat/types';

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

    // Streaming
    streaming: StreamingState;

    // Iris processing stages
    irisStages: IrisStageDTO[];

    // UI state
    isLoading: boolean;
    webSocketStatus: ChatWebSocketStatus;
    disabledMessage: string | null;   // Non-null = Iris disabled (reason as string)
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

    // Streaming actions
    startStreaming: () => void;

    // Iris stage actions
    setIrisStages: (stages: IrisStageDTO[]) => void;
    resetTransientChatUi: () => void;

    // UI actions
    setLoading: (loading: boolean) => void;
    setWebSocketStatus: (status: ChatWebSocketStatus) => void;
    setDisabledMessage: (message: string | null) => void;
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
            streaming: IDLE_STREAMING,
            irisStages: [],
            isLoading: false,
            webSocketStatus: 'unknown',
            disabledMessage: null,
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
                set((state) => ({
                    messages: [...state.messages, message],
                }), false, 'addMessage');
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
                set({ disabledMessage: message }, false, 'setDisabledMessage');
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
