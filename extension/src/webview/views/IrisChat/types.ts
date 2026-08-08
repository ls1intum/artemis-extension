import type { ExtMsg } from '@shared/messageContracts';
import type { ExerciseRef } from '@shared/types';
import type { IrisActivityDTO } from '@shared/types/apiResponses';

/**
 * View types narrowed off the wire shape rather than re-declared, so a
 * component prop can never silently drift from the payload it renders.
 * `useChatStore` narrows the same three types locally for its own state
 * fields; both point at the one wire definition.
 */
type WireIrisState = ExtMsg<'updateIrisState'>['state'];
/** A conversation's topic: `committedContext` / `pendingContext` on the wire. */
export type ConversationTopic = NonNullable<WireIrisState['committedContext']>;
/** 'unknown' disables the topic picker and the chip's remove icon. */
export type ContentState = NonNullable<WireIrisState['contentState']>;
/** One row of the course-wide conversation list (history popover). */
export type ConversationSummary = NonNullable<WireIrisState['conversations']>[number];

// Chat message as rendered in the UI
export interface ChatMessage {
    id?: number;           // Artemis message ID (undefined for optimistic messages)
    localId: string;       // Client-generated UUID for optimistic tracking
    // 'contextSwap' is a persisted transcript-divider row, rendered as a
    // divider rather than as a bubble.
    role: 'user' | 'assistant' | 'contextSwap';
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
     *
     * Matches `sendRejected.reason` on the wire: the store must be able to
     * hold whatever the wire carries.
     */
    errorReason?:
        | 'no-ai'
        | 'no-context'
        | 'iris-disabled'
        | 'iris-unavailable'
        | 'send-in-flight'
        | 'navigation-in-flight'
        | 'no-conversation'
        | 'conversation-changed'
        | 'rate-limit'
        | 'preparation-failed'
        | 'unknown';
    /** Tool activity persisted with the message; renders as the trail. */
    activities?: IrisActivityDTO[];
    /** `false` marks an intermediate message: no feedback controls, run continues. */
    final?: boolean;
}

// Context item for picker lists
export interface ContextItem extends ExerciseRef {
    repositoryUri?: string;
    isWorkspace?: boolean;
    releaseDate?: string;
    dueDate?: string;
    lastViewed?: number;   // for compareCoursesForPicker
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
