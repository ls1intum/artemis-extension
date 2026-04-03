import type { ExerciseRef } from '../../../shared/types';

// Chat message as rendered in the UI
export interface ChatMessage {
    id?: number;           // Artemis message ID (undefined for optimistic messages)
    localId: string;       // Client-generated UUID for optimistic tracking
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    helpful?: boolean | null;  // Feedback state: true=positive, false=negative, null=none
    status?: 'sending' | 'sent' | 'error';  // For optimistic display
    errorMessage?: string;     // Error text for failed messages
}

// Chat session summary (from extension)
export interface ChatSession {
    id: string;
    artemisSessionId?: number;
    preview: string;
    messageCount: number;
    createdAt: number;
    lastActivity: number;
}

// Chat context (course or exercise)
export interface ChatContext {
    type: 'course' | 'exercise';
    id: number;
    title: string;
    shortName?: string;
    courseId?: number;
    locked: boolean;
    source: 'user-selected' | 'workspace-detected' | 'system-default';
}

// Context item for picker lists
export interface ContextItem extends ExerciseRef {
    repositoryUri?: string;
    isWorkspace?: boolean;
}

// Referenced file info
export interface ReferencedFile {
    path: string;
    reason?: string;
}

export interface ReferencedFilesData {
    includedFiles: string[];
    excludedFiles: ReferencedFile[];
    totalCount: number;
}

// Streaming state
export interface StreamingState {
    isStreaming: boolean;
    messageLocalId: string | null;  // Which message is currently streaming
    visibleChunks: string[];        // Accumulated visible chunks
}
