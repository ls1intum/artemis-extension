import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { ExtMsg, WebSocketDisplayStatus } from '@shared/messageContracts';

import type { ChatTranscriptSlice } from '@webview/stores/chatTranscriptSlice';
import { createChatTranscriptSlice } from '@webview/stores/chatTranscriptSlice';
import type { ContextItem, ReferencedFilesData } from '@webview/views/IrisChat/types';

/**
 * Mirrors the extension's {@link WebSocketDisplayStatus} plus a synthetic
 * 'unknown' state for the first render, before any extension push has
 * arrived. 'unknown' renders nothing, suppressing the cold-start banner flash.
 */
type ChatWebSocketStatus = WebSocketDisplayStatus | 'unknown';

/**
 * The wire shape, narrowed field-by-field below rather than duplicated by
 * hand, so a store field cannot silently drift from the wire type it mirrors.
 */
type WireIrisState = ExtMsg<'updateIrisState'>['state'];
type ConversationTopic = NonNullable<WireIrisState['committedContext']>;
type ContentState = NonNullable<WireIrisState['contentState']>;
type ConversationSummary = NonNullable<WireIrisState['conversations']>[number];
type DetectionUiState = WireIrisState['detectionState'];

/**
 * The conversation shell: which course and conversation are open, what the
 * server said about availability, and the picker/composer state. The transcript
 * itself, its run UI and the proactive episode state live in
 * {@link ChatTranscriptSlice}, which is composed into the same store below.
 */
export interface ChatShellState {
    /**
     * Flips to true on the first UpdateIrisState. Lets the renderer
     * distinguish "no conversation" from "snapshot pending" so the cold-mount
     * frame stays on the loader instead of flashing the welcome state.
     */
    hasReceivedInitialIrisState: boolean;
    /**
     * Workspace detection's own progress, mirrored from the wire. Lets the
     * cold-start view tell "detection has not answered yet" and "detection
     * could not reach the server" apart from "there is genuinely nothing
     * open" (`courseId`/`currentSessionId`/`workspaceExerciseId` all null).
     * Defaults to `'settled'` so a fixture that omits the field reads as an
     * already-resolved snapshot, not a permanently-pending detection.
     */
    detectionState: DetectionUiState;
    /**
     * The host could not reach the server for the course list. Separates "you
     * have no courses" from "nobody could be asked", which an empty `courses`
     * cannot tell apart on its own. Defaults to `false` so a fixture that
     * omits the field does not read as a failure.
     */
    coursesUnavailable: boolean;
    exercises: ContextItem[];
    courses: ContextItem[];

    /** The open conversation's course id (CoursePicker: marks the current course). */
    courseId: number | null;
    /** The open conversation's course title (header line 1, opens CoursePicker). */
    courseTitle: string | null;
    /** The one server conversation this webview mirrors, if any. */
    currentSessionId: number | null;
    /** The open conversation's title (header line 2, beside `displayMessageCount`). */
    conversationTitle: string | null;
    /**
     * Displayed message count, excluding CTXSWAP rows (header line 2).
     * Display only, never the ownership predicate.
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
    /** The detected workspace exercise, when any (ContextPicker pin/badge). */
    workspaceExerciseId: number | null;
    /**
     * An actionless informational banner (e.g. a server-initiated repoint).
     * Cleared by the next `setIrisState` that actually NAVIGATES. Clearing on
     * every snapshot would kill the notice the host posts right after a
     * navigation, since the overview refresh that navigation fires emits
     * another snapshot a round trip later.
     */
    notice: { text: string; tone?: 'info' | 'error' } | null;
    composerText: string;

    /**
     * A conversation the student asked for could not be opened. Distinct from
     * `unavailableMessage`: nothing about chat availability changed, only the
     * specific row they clicked could not be opened, so it renders as an
     * inline banner inside the history popover rather than the global banner.
     */
    openSessionError: string | null;

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

    setIrisState: (state: ExtMsg<'updateIrisState'>['state']) => void;
    setOpenSessionError: (message: string | null) => void;

    setLoading: (loading: boolean) => void;
    setWebSocketStatus: (status: ChatWebSocketStatus) => void;
    setDisabledMessage: (message: string | null) => void;
    setUnavailableMessage: (message: string | null) => void;
    setNoAiDetected: (detected: boolean) => void;
    setReferencedFiles: (data: ReferencedFilesData | null) => void;
    setShowDiagnostics: (show: boolean) => void;

    setComposerText: (text: string) => void;
    /** Raises an actionless chat notice. Cleared by the next `setIrisState` call. */
    showNotice: (notice: { text: string; tone?: 'info' | 'error' }) => void;
}

/**
 * The store's public shape. Kept as one flat type on purpose: every consumer
 * reads the composed store (`useChatStore()` or `useChatStore.getState()`), and
 * three modules plus a test narrow it with `Pick<ChatState, ...>`. Splitting the
 * implementation must not split what they see.
 */
export interface ChatState extends ChatShellState, ChatTranscriptSlice { }

export const useChatStore = create<ChatState>()(
    devtools(
        (set, get, store) => ({
            ...createChatTranscriptSlice(set, get, store),
            hasReceivedInitialIrisState: false,
            detectionState: 'settled',
            coursesUnavailable: false,
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
            openSessionError: null,
            isLoading: false,
            webSocketStatus: 'unknown',
            disabledMessage: null,
            unavailableMessage: null,
            isNoAiDetected: false,
            referencedFiles: null,
            showDiagnostics: false,

            setIrisState: (state) => {
                set((previous) => ({
                    exercises: state.exercises,
                    courses: state.courses,
                    hasReceivedInitialIrisState: true,
                    // The wire type marks this required (the presenter always
                    // fills it); the fallback keeps a fixture that omits it
                    // reading as an already-settled snapshot rather than a
                    // permanently-pending detection.
                    detectionState: state.detectionState ?? 'settled',
                    coursesUnavailable: state.coursesUnavailable ?? false,
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
                    // A notice is cleared by any navigation or course change.
                    // A snapshot that moves neither the conversation nor the
                    // course is not a navigation, so it leaves it alone.
                    notice: (state.currentSessionId ?? null) === previous.currentSessionId
                        && (state.courseId ?? null) === previous.courseId
                        ? previous.notice
                        : null,
                    // A held echo belongs to the conversation it was captured
                    // in. Carrying it across would show one conversation's
                    // message in another.
                    pendingEcho: previous.pendingEcho?.sessionId === (state.currentSessionId ?? null)
                        ? previous.pendingEcho
                        : null,
                }), false, 'setIrisState');
            },

            setOpenSessionError: (message) => {
                set({ openSessionError: message }, false, 'setOpenSessionError');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            setWebSocketStatus: (status) => {
                set({ webSocketStatus: status }, false, 'setWebSocketStatus');
            },

            setDisabledMessage: (message) => {
                // Setting a real disabled reason clears any transient
                // unavailable banner, since disabled is the more specific
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
                // reason clears any stale disabled banner (defensive; the
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
 * used right now. Deliberately NOT a stored field: a hand-synced
 * `canChangeTopic` would go stale the moment a second writer of
 * `contentState`/`sendInFlight`/`navigationInFlight` appears.
 */
export function selectCanChangeTopic(
    state: Pick<ChatState, 'contentState' | 'sendInFlight' | 'navigationInFlight'>,
): boolean {
    return state.contentState !== 'unknown' && !state.sendInFlight && !state.navigationInFlight;
}

/**
 * Why a send would be refused right now, or `undefined` when it would go
 * through. Gate and label are ONE derivation so the greyed-out button and the
 * sentence explaining it can never disagree.
 *
 * The order mirrors the host's own rejection order (`sendCoordinator.ts`), so
 * whenever the host would refuse, the student reads the cause the host would
 * have named. Local `streaming` ranks LAST: it has no host counterpart and
 * covers only the window between the webview posting the command and the host
 * taking its lock. Ranking it higher would mislabel `streaming` +
 * `navigationInFlight`, reachable during snapshot races, which the host
 * rejects for navigation.
 */
export function selectSendBlockedReason(
    state: Pick<ChatState, 'sendInFlight' | 'navigationInFlight' | 'streaming'>,
): string | undefined {
    if (state.sendInFlight) { return 'Iris is still answering'; }
    if (state.navigationInFlight) { return 'The conversation is still loading'; }
    if (state.streaming.isStreaming) { return 'Iris is still answering'; }
    return undefined;
}
