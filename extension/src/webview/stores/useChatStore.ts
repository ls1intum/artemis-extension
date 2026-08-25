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

export interface ChatState {
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

    messages: ChatMessage[];
    /**
     * The server's echo of a prompt we drew optimistically, held back until
     * the POST names an id and settles whose message it is. Identity has to
     * come from the id: matching on text would fold another client's
     * identical message into our bubble and delete it.
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

    streaming: StreamingState;

    // Run UI (streaming draft, activities, run state), projected atomically
    // with the webview's active session/revision via applyRunUi/applyCommit.
    liveDraft: { runId: string; text: string } | null;
    activities: IrisActivityDTO[];
    runState: IrisRunState | null;
    runError: { message?: string } | null;
    /** Monotonic guard against out-of-order/stale run UI projections. */
    lastRunUiRevision: number;

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
    /** Replace the transcript with `sessionId`'s, and record the hydration. */
    applyLoadedMessages: (sessionId: number, messages: ChatMessage[]) => void;
    /**
     * Non-destructive counterpart to `applyLoadedMessages`, used by the
     * reconnect reconciliation path: merges a persisted history snapshot into
     * the live list instead of replacing it, so an in-flight optimistic bubble
     * survives. Ignored once `sessionId` is no longer the open conversation.
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
     * (e.g. an error bubble) must not land in a conversation we already left.
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
    /**
     * Stamps a still-pending optimistic user bubble with its server id and
     * `status: 'sent'`. Before that, discards or flushes `pendingEcho` if it
     * is held for this `localId`, whether or not a matching bubble is still
     * in `messages`: a call for a `localId` with no bubble is not a no-op
     * when a held echo is still waiting on it.
     */
    confirmSentMessage: (localId: string, id: number) => void;
    /**
     * Releases a held `pendingEcho` into `messages` (or drops it if its
     * conversation has since been left), and clears the slot either way.
     * A no-op when nothing is held.
     */
    flushPendingEcho: () => void;
    setOpenSessionError: (message: string | null) => void;

    startStreaming: () => void;

    resetTransientChatUi: () => void;

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
    // two into one once the response names the id. `applyCommit` normally holds
    // that echo in `pendingEcho` before it reaches here (see `echoOwner`), so
    // this append is the fallback for when no bubble waits to claim it.
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

/**
 * The bubble `message` should be held against instead of being upserted
 * straight away, if any: a user message that already carries a server id,
 * while exactly one optimistic bubble is still waiting for one and nothing is
 * held yet. Only `applyCommit` calls this, since it is the path every wire
 * `addMessage` frame is routed through and the only way our own echo arrives.
 */
function echoOwner(state: ChatState, message: ChatMessage): ChatMessage | undefined {
    if (message.role !== 'user' || message.id === undefined || state.pendingEcho !== null) {
        return undefined;
    }
    return soleSendingBubble(state.messages);
}

export const useChatStore = create<ChatState>()(
    devtools(
        (set) => ({
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

            applyLoadedMessages: (sessionId, messages) => {
                set({
                    messages,
                    loadedSessionId: sessionId,
                    // The server's own transcript replaces everything we were
                    // holding, and it already contains whatever the echo was.
                    pendingEcho: null,
                }, false, 'applyLoadedMessages');
            },

            mergeLoadedMessages: (sessionId, messages) => {
                if (sessionId !== useChatStore.getState().currentSessionId) { return; }
                set((s) => ({ messages: mergeHistory(s.messages, messages) }), false, 'mergeLoadedMessages');
            },

            addMessage: (message, sessionId) => {
                const state = useChatStore.getState();
                if (sessionId !== undefined && sessionId !== state.currentSessionId) { return; }
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

                // A user echo never carries a projection
                // (irisWebSocketMessageHandler's _renderForeignUserMessage
                // sends none), and a commit that does carry one must still be
                // applied atomically, so the hold is scoped to the
                // projection-less case only.
                if (projection === undefined) {
                    const state = useChatStore.getState();
                    const owner = echoOwner(state, message);
                    if (owner && state.currentSessionId !== null) {
                        set(
                            { pendingEcho: { message, sessionId: state.currentSessionId, localId: owner.localId } },
                            false,
                            'holdEcho',
                        );
                        return;
                    }
                }

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
                const current = useChatStore.getState().messages;
                const target = current.find((m) => m.localId === localId);
                if (!target || target.role !== 'user' || target.status !== 'sending') {
                    return false;
                }
                // The send is over and will never name an id, so if it was the
                // bubble the held echo was waiting on, that echo belongs to
                // somebody else and must be shown now. Kept after the guard
                // above: a call that marks nothing failed must not release the
                // buffer either.
                if (ownsPendingEcho(useChatStore.getState(), localId)) {
                    useChatStore.getState().flushPendingEcho();
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
                // Release only when the bubble that was waiting is the one
                // going away. A retry removes the PREVIOUS failed bubble
                // first, which must not release anything.
                //
                // Unlike `markMessageFailed`, this releases on `localId`
                // ownership alone: a `pendingEcho` is only ever armed for a
                // bubble that was in `messages` at capture time, and the only
                // other path that removes a bubble (`applyLoadedMessages`)
                // clears `pendingEcho` itself.
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
                    // has been waiting to be shown. Discarding rather than
                    // flushing leaves the LOCAL row as the survivor, where the
                    // branch below (echo already in `messages`, no hold) keeps
                    // the SERVER row instead.
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
