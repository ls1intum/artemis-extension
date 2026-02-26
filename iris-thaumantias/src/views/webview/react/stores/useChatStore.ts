import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
    ChatMessage,
    ChatSession,
    ChatContext,
    ContextItem,
    ReferencedFilesData,
    StreamingState
} from '../views/IrisChat/types';
import type { IrisChatStateMessage } from '../../../../shared/messageContracts';

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

    // UI state
    isLoading: boolean;
    isWebSocketConnected: boolean;
    disabledMessage: string | null;   // Non-null = Iris disabled (reason as string)
    isNoAiDetected: boolean;
    referencedFiles: ReferencedFilesData | null;
    showDiagnostics: boolean;

    // Actions
    setIrisState: (state: IrisChatStateMessage['state']) => void;
    setMessages: (messages: ChatMessage[]) => void;
    addMessage: (message: ChatMessage) => void;
    clearMessages: () => void;
    updateMessageContent: (localId: string, content: string) => void;
    setMessageStatus: (localId: string, status: 'sending' | 'sent' | 'error', errorMessage?: string) => void;

    // Streaming actions
    startStreaming: (localId: string) => void;
    appendStreamChunk: (chunk: string) => void;
    finishStreaming: (finalContent: string) => void;

    // UI actions
    setLoading: (loading: boolean) => void;
    setWebSocketConnected: (connected: boolean) => void;
    setDisabledMessage: (message: string | null) => void;
    setNoAiDetected: (detected: boolean) => void;
    setReferencedFiles: (data: ReferencedFilesData | null) => void;
    setShowDiagnostics: (show: boolean) => void;
}

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
            streaming: {
                isStreaming: false,
                messageLocalId: null,
                visibleChunks: [],
            },
            isLoading: false,
            isWebSocketConnected: false,
            disabledMessage: null,
            isNoAiDetected: false,
            referencedFiles: null,
            showDiagnostics: false,

            // Actions
            setIrisState: (state) => {
                set({
                    context: state.context ? {
                        type: state.context.type as 'course' | 'exercise',
                        id: state.context.id,
                        title: state.context.title,
                        shortName: state.context.shortName,
                        // courseId is not on the message contract context - it needs to be looked up from recentExercises/allExercises
                        courseId: state.context.type === 'exercise'
                            ? state.recentExercises.find(ex => ex.id === state.context!.id)?.courseId
                            || state.allExercises.find(ex => ex.id === state.context!.id)?.courseId
                            : undefined,
                        locked: state.context.locked,
                        source: state.context.source as 'user-selected' | 'workspace-detected' | 'system-default',
                    } : null,
                    activeSessionId: state.activeSessionId,
                    sessions: state.sessions.map(s => ({
                        id: s.id,
                        artemisSessionId: s.artemisSessionId,
                        preview: s.preview,
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
                set({ messages: [] }, false, 'clearMessages');
            },

            updateMessageContent: (localId, content) => {
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.localId === localId ? { ...msg, content } : msg
                    ),
                }), false, 'updateMessageContent');
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
                        streaming: {
                            isStreaming: false,
                            messageLocalId: null,
                            visibleChunks: [],
                        },
                        messages: messageLocalId
                            ? state.messages.map(msg =>
                                msg.localId === messageLocalId ? { ...msg, content: finalContent } : msg
                            )
                            : state.messages,
                    };
                }, false, 'finishStreaming');
            },

            // UI actions
            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            setWebSocketConnected: (connected) => {
                set({ isWebSocketConnected: connected }, false, 'setWebSocketConnected');
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
