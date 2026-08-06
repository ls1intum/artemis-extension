import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { ExtMsg, IrisRunUiProjection, WebSocketDisplayStatus } from '@shared/messageContracts';
import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import { mergeHistory } from '@webview/stores/mergeHistory';
import type {
    ChatMessage,
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
 * The wire shape, narrowed field-by-field below instead of duplicated by
 * hand, so a store field can never silently drift from the wire type it
 * mirrors.
 */
type WireIrisState = ExtMsg<'updateIrisState'>['state'];
type ConversationTopic = NonNullable<WireIrisState['committedContext']>;
type ContentState = NonNullable<WireIrisState['contentState']>;
type ConversationSummary = NonNullable<WireIrisState['conversations']>[number];
type DetectionUiState = WireIrisState['detectionState'];

interface ChatState {
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
     * Defaults to `'settled'`: a test double that never sends the field
     * (every fixture predating this one) must keep behaving like a snapshot
     * that has already resolved, not like a permanently-pending detection.
     */
    detectionState: DetectionUiState;
    /**
     * The host could not reach the server for the course list. Separates "you
     * have no courses" from "nobody could be asked", which an empty `courses`
     * cannot tell apart on its own. Defaults to `false` for the same reason
     * `detectionState` defaults to settled: a fixture predating the field must
     * not read as a failure.
     */
    coursesUnavailable: boolean;
    exercises: ContextItem[];
    courses: ContextItem[];

    // `null` follows the file's existing "absent" convention (see
    // `openSessionError`, `disabledMessage`) rather than `undefined`.
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
    /** The detected workspace exercise, when any (ContextPicker pin/badge). */
    workspaceExerciseId: number | null;
    /**
     * An actionless informational banner (e.g. a server-initiated repoint).
     * Cleared by the next `setIrisState` that actually NAVIGATES, matching
     * "a notice is cleared by any navigation or course change" from the
     * design. Clearing on every snapshot instead would kill the notice the
     * host posts right after a navigation: the overview refresh that the same
     * navigation fires emits another snapshot a round trip later.
     */
    notice: { text: string; tone?: 'info' | 'error' } | null;
    /** Composer draft text, lifted out of `ChatInput`'s local `useState`. */
    composerText: string;

    /**
     * A conversation the student asked for could not be opened. Distinct from
     * `unavailableMessage`: nothing about chat availability changed, only the
     * specific row they clicked could not be opened, so it renders as an
     * inline banner inside the history popover rather than the global banner.
     */
    openSessionError: string | null;

    // Messages
    messages: ChatMessage[];
    /**
     * The server's echo of a prompt we drew optimistically, held back until
     * the POST names an id and settles whose message it is. Matching on text
     * instead would fold another client's identical message into our bubble
     * and delete it, so identity has to come from the id, which only the POST
     * response can supply.
     *
     * `localId` names the bubble this echo is waiting on. A signal about any
     * other bubble (a stale rejection, a later send) says nothing about this
     * echo and must leave it held.
     */
    pendingEcho: { message: ChatMessage; sessionId: number; localId: string } | null;
    /**
     * The conversation whose transcript is currently in `messages`. `null`
     * until the first transcript arrives; the webview shows the loader until
     * this matches the open conversation.
     */
    loadedSessionId: number | null;

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
    /** Replace the transcript with `sessionId`'s, and record the hydration. */
    applyLoadedMessages: (sessionId: number, messages: ChatMessage[]) => void;
    /**
     * Non-destructive counterpart to `applyLoadedMessages`, used by the
     * reconnect reconciliation path: merges a persisted history snapshot
     * into the live list instead of replacing it, so an in-flight optimistic
     * bubble survives. Ignored if `sessionId` is no longer the open
     * conversation (the reconcile landed after a navigation).
     */
    mergeLoadedMessages: (sessionId: number, messages: ChatMessage[]) => void;
    /**
     * Upserts by server `id`; messages without one always append (see
     * `upsertMessage`). `sessionId` is inert when omitted (the optimistic
     * bubble is drawn in whatever is open), and drops the message when
     * supplied AND it is not the open conversation.
     */
    addMessage: (message: ChatMessage, sessionId?: number) => void;
    /**
     * Apply a standalone run-UI snapshot (streaming draft/activities/run
     * state). Rejects a projection for a conversation we already left, or one
     * that is not strictly newer than the last applied revision.
     */
    applyRunUi: (projection: IrisRunUiProjection) => void;
    /**
     * Commit a message and (optionally) its run-UI projection in one atomic
     * update, so the webview can never observe the draft cleared before the
     * committed message lands. The message's conversation is checked
     * independently of the projection's, since a projection-less commit
     * (e.g. an error bubble) still must not land in a conversation we already
     * left.
     */
    applyCommit: (
        message: ChatMessage,
        projection: IrisRunUiProjection | undefined,
        messageSessionId: number,
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
    flushPendingEcho: () => void;
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

    /** Sets the composer's draft text (lifted out of `ChatInput`'s local state, see above). */
    setComposerText: (text: string) => void;
    /** Raises an actionless chat notice. Cleared by the next `setIrisState` call. */
    showNotice: (notice: { text: string; tone?: 'info' | 'error' }) => void;
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
    const byId = messages.findIndex((m) => m.id === message.id);
    if (byId !== -1) {
        const next = [...messages];
        next[byId] = { ...next[byId], ...message, localId: next[byId].localId };
        return next;
    }
    // Anything else is a message this list does not have yet, including the
    // server's echo of a prompt we drew optimistically when that echo beats our
    // own POST response. It is appended, and `confirmSentMessage` resolves the
    // two into one once the response names the id. Matching on the TEXT instead
    // would fold another client's identical message into our bubble and delete
    // it: identical text says nothing about identity.
    return [...messages, message];
}

/**
 * The one optimistic user bubble waiting for its id, if there is exactly one.
 * An error bubble is not waiting for anything, so it does not count.
 */
function soleSendingBubble(messages: ChatMessage[]): ChatMessage | undefined {
    const pending = messages.filter(
        (m) => m.role === 'user' && m.id === undefined && m.status === 'sending',
    );
    return pending.length === 1 ? pending[0] : undefined;
}

/** The held echo is waiting on exactly this bubble. */
function ownsPendingEcho(state: ChatState, localId: string): boolean {
    return state.pendingEcho?.localId === localId;
}

export const useChatStore = create<ChatState>()(
    devtools(
        (set) => ({
            // Initial state
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
            messages: [],
            pendingEcho: null,
            loadedSessionId: null,
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
                set((previous) => ({
                    exercises: state.exercises,
                    courses: state.courses,
                    hasReceivedInitialIrisState: true,
                    // The wire type marks this required (the presenter always
                    // fills it), but a fixture/test double predating this
                    // field omits it, and the fallback keeps those behaving
                    // like an already-settled snapshot rather than a
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
                    // A notice is cleared by any navigation or course change
                    // (the design's phrasing). A snapshot that moves neither
                    // the conversation nor the course is not a navigation, so
                    // it leaves the notice alone.
                    notice: (state.currentSessionId ?? null) === previous.currentSessionId
                        && (state.courseId ?? null) === previous.courseId
                        ? previous.notice
                        : null,
                }), false, 'setIrisState');
            },

            applyLoadedMessages: (sessionId, messages) => {
                set({
                    messages,
                    loadedSessionId: sessionId,
                }, false, 'applyLoadedMessages');
            },

            mergeLoadedMessages: (sessionId, messages) => {
                if (sessionId !== useChatStore.getState().currentSessionId) { return; }
                set((s) => ({ messages: mergeHistory(s.messages, messages) }), false, 'mergeLoadedMessages');
            },

            addMessage: (message, sessionId) => {
                const state = useChatStore.getState();
                if (sessionId !== undefined && sessionId !== state.currentSessionId) { return; }
                const owner = message.role === 'user' && message.id !== undefined && state.pendingEcho === null
                    ? soleSendingBubble(state.messages)
                    : undefined;
                if (owner && state.currentSessionId !== null) {
                    set(
                        { pendingEcho: { message, sessionId: state.currentSessionId, localId: owner.localId } },
                        false,
                        'holdEcho',
                    );
                    return;
                }
                set((s) => ({ messages: upsertMessage(s.messages, message) }), false, 'addMessage');
            },

            applyRunUi: (projection) => {
                if (projection.sessionId !== useChatStore.getState().currentSessionId) { return; }
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

            applyCommit: (message, projection, messageSessionId) => {
                // Session-check the MESSAGE independently: a projection-less
                // error bubble still must not land in a conversation we left.
                const currentSessionId = useChatStore.getState().currentSessionId;
                if (messageSessionId !== currentSessionId) { return; }

                // One set() so the message and its run state can never be
                // observed apart, and the draft is never cleared first.
                set((s) => {
                    const messages = upsertMessage(s.messages, message);
                    const accepts = projection !== undefined
                        && projection.sessionId === currentSessionId
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
                // This send is over and will never name an id, so whatever it
                // was holding belongs to somebody else and must be shown. Only
                // for the owning bubble: a stale rejection for another send
                // says nothing, exactly as the guard below already treats it.
                if (ownsPendingEcho(useChatStore.getState(), localId)) {
                    useChatStore.getState().flushPendingEcho();
                }
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
                // Only when the bubble that was waiting is the one going away.
                // A retry removes the PREVIOUS failed bubble first
                // (IrisChatView.tsx:341), which must not release anything.
                if (ownsPendingEcho(useChatStore.getState(), localId)) {
                    useChatStore.getState().flushPendingEcho();
                }
                set((state) => ({
                    messages: state.messages.filter((m) => m.localId !== localId),
                }), false, 'removeMessage');
            },

            flushPendingEcho: () => {
                const held = useChatStore.getState().pendingEcho;
                if (!held) { return; }
                set((s) => ({
                    // Only into the conversation it was captured in. A held
                    // echo whose conversation has been left is already part of
                    // the transcript the server hands over on the way back, so
                    // dropping it there loses nothing.
                    messages: held.sessionId === s.currentSessionId
                        ? upsertMessage(s.messages, held.message)
                        : s.messages,
                    pendingEcho: null,
                }), false, 'flushPendingEcho');
            },

            confirmSentMessage: (localId, id) => {
                const store = useChatStore.getState();
                if (ownsPendingEcho(store, localId)) {
                    // The id settles whose message it is. Equal means the
                    // bubble and the echo are one message and the echo is
                    // redundant; different means it was somebody else's and
                    // has been waiting to be shown.
                    if (store.pendingEcho?.message.id === id) {
                        set({ pendingEcho: null }, false, 'discardEcho');
                    } else {
                        store.flushPendingEcho();
                    }
                }
                set((s) => {
                    // The echo may already be here (it can outrun the POST
                    // response). Then this bubble and that row are the SAME
                    // message, proven by the id rather than guessed from the
                    // text, so the optimistic one goes and the server one stays.
                    const bubble = s.messages.findIndex((m) => m.localId === localId && m.role === 'user');
                    const echo = s.messages.findIndex((m) => m.id === id);
                    if (bubble !== -1 && echo !== -1 && echo !== bubble) {
                        const messages = s.messages
                            .map((m, i) => (i === echo ? { ...m, status: 'sent' as const } : m))
                            .filter((_, i) => i !== bubble);
                        return { messages };
                    }
                    return {
                        messages: s.messages.map((m) =>
                            m.localId === localId && m.role === 'user'
                                ? { ...m, id, status: 'sent' as const }
                                : m,
                        ),
                    };
                }, false, 'confirmSentMessage');
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
 * would silently go stale the moment a second writer appears. Computing it
 * fresh on every read makes that impossible.
 */
export function selectCanChangeTopic(
    state: Pick<ChatState, 'contentState' | 'sendInFlight' | 'navigationInFlight'>,
): boolean {
    return state.contentState !== 'unknown' && !state.sendInFlight && !state.navigationInFlight;
}
