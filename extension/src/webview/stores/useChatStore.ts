import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
    ChatMessage,
    ChatSession,
    ChatContext,
    ContextItem,
    ReferencedFilesData,
    StreamingState,
    IrisStageDTO,
} from '../views/IrisChat/types';
import type { ExtMsg, WebSocketDisplayStatus } from '../../shared/messageContracts';

/**
 * Webview-side connection status. Mirrors the extension's
 * {@link WebSocketDisplayStatus} plus a synthetic 'unknown' state used for
 * the very first render before any extension push has arrived. 'unknown'
 * intentionally renders nothing — it suppresses the cold-start banner flash.
 */
type ChatWebSocketStatus = WebSocketDisplayStatus | 'unknown';

interface ChatState {
    // Context
    context: ChatContext | null;
    activeSessionId: string | null;
    sessions: ChatSession[];
    recentExercises: ContextItem[];
    recentCourses: ContextItem[];
    allExercises: ContextItem[];
    allCourses: ContextItem[];

    // Messages
    messages: ChatMessage[];

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
    setMessages: (messages: ChatMessage[]) => void;
    addMessage: (message: ChatMessage) => void;
    clearMessages: () => void;
    setMessageStatus: (localId: string, status: 'sending' | 'sent' | 'error', errorMessage?: string) => void;

    // Streaming actions
    startStreaming: (localId: string) => void;
    appendStreamChunk: (chunk: string) => void;
    finishStreaming: (finalContent: string) => void;

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
    messageLocalId: null,
    visibleChunks: [],
};

export const useChatStore = create<ChatState>()(
    devtools(
        (set) => ({
            // Initial state
            context: null,
            activeSessionId: null,
            sessions: [],
            recentExercises: [],
            recentCourses: [],
            allExercises: [],
            allCourses: [],
            messages: [],
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
                    recentExercises: state.recentExercises,
                    recentCourses: state.recentCourses,
                    allExercises: state.allExercises,
                    allCourses: state.allCourses,
                }, false, 'setIrisState');
            },

            setMessages: (messages) => {
                set({ messages }, false, 'setMessages');
            },

            addMessage: (message) => {
                set((state) => ({
                    messages: [...state.messages, message],
                }), false, 'addMessage');
            },

            clearMessages: () => {
                set({
                    messages: [],
                    irisStages: [],
                    streaming: IDLE_STREAMING,
                }, false, 'clearMessages');
            },

            setMessageStatus: (localId, status, errorMessage) => {
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.localId === localId ? { ...msg, status, errorMessage } : msg
                    ),
                }), false, 'setMessageStatus');
            },

            // Streaming actions
            startStreaming: (localId) => {
                set({
                    streaming: {
                        isStreaming: true,
                        messageLocalId: localId,
                        visibleChunks: [],
                    },
                }, false, 'startStreaming');
            },

            appendStreamChunk: (chunk) => {
                set((state) => ({
                    streaming: {
                        ...state.streaming,
                        visibleChunks: [...state.streaming.visibleChunks, chunk],
                    },
                }), false, 'appendStreamChunk');
            },

            finishStreaming: (finalContent) => {
                set((state) => {
                    const { messageLocalId } = state.streaming;
                    return {
                        streaming: IDLE_STREAMING,
                        messages: messageLocalId
                            ? state.messages.map(msg =>
                                msg.localId === messageLocalId ? { ...msg, content: finalContent } : msg
                            )
                            : state.messages,
                    };
                }, false, 'finishStreaming');
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
