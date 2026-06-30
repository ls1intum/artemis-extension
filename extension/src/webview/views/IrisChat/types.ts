import type { ExerciseRef } from '@shared/types';
export type { IrisStageDTO } from '@shared/types/apiResponses';

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
    /**
     * Reason the send was rejected by the extension host. Set together
     * with `status: 'error'`. Used by the UI to decide whether Retry is
     * meaningful right now (e.g. `iris-disabled` is persistent; `no-ai`
     * stays non-retryable as long as `.noai` is still detected).
     */
    errorReason?: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable';
    /**
     * Durable provenance marker for assistant messages. `'proactive'` flags a
     * message Iris pushed unprompted (struggle intervention) so the bubble can
     * render distinctly. Survives a history reload because the extension maps
     * the server's `'PROACTIVE_STRUGGLE'` onto this flag on both the live
     * websocket path and the GET /messages history path.
     */
    origin?: 'proactive';
    /**
     * Durable reaction to a proactive message. `'DISMISSED'` means the student
     * collapsed the bubble; `'RECOVERED'` means progress confirmed; `'ABANDONED'`
     * means the watchdog timed out. Survives a history reload (server round-trips
     * it on `IrisMessageResponseDTO`).
     */
    proactiveOutcome?: 'DISMISSED' | 'RECOVERED' | 'ABANDONED';
    /**
     * Client-allocated uuid grouping proactive messages by episode (C4/C6).
     * Present on both live ws rows (via chat-ws AddMessage) and reloaded history.
     * Used by C6 to render episode groups and by C7 for fold animation targeting.
     */
    proactiveEpisodeId?: string;
    /**
     * Runtime marker set by `attachStaleAsk` when the host attaches a live
     * stale-ask ask-id binding to this row (C6). Used to gate the Dismiss
     * button (hidden on stale-ask rows) and to distinguish stale-ask rows
     * from plain hint cards. NOT persisted to the server; absent on reload.
     */
    staleAsk?: boolean;
}

// Chat session summary (from extension)
export interface ChatSession {
    id: string;
    artemisSessionId?: number;
    preview: string;
    title?: string;
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

// Transient flag for "Iris is preparing a response" UI.
// The Artemis Iris WebSocket never streams chunks to this client — it sends
// only the final MESSAGE frame (see irisWebSocketMessageHandler) — so the
// only thing this flag drives is the thinking indicator between send and
// the final AddMessage push that clears it via resetTransientChatUi.
export interface StreamingState {
    isStreaming: boolean;
}
