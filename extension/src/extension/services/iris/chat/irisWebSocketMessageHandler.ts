import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, IrisRunUiProjection, WebSocketDisplayStatus } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';
import type { IrisChatMessage } from '@shared/types/apiResponses';

import { classifyIrisFrame } from '@extension/services/iris/chat/classifyIrisFrame';
import { describeContextSwap, isContextSwap, parseContextSwap } from '@extension/services/iris/context/contextMarkers';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';
import type { IrisWebSocketMessage } from '@extension/services/iris/parseIrisWs';
import { isIrisActivity, isIrisWebSocketMessage } from '@extension/services/iris/parseIrisWs';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { IrisActivityDTO, IrisRunState } from '@extension/types';

import { extractIrisMessageContent } from './messageUtils';

type ReconnectResult =
    | { status: 'reconnected' }
    | { status: 'already-connected' }
    | { status: 'no-service' }
    | { status: 'failed'; error: string };

interface ReceivedIrisChatMessage {
    content: string;
    /** Numeric message ID from the Artemis server, stringified for recording. */
    messageId?: string;
    /** Numeric session ID from the Artemis server, stringified for recording. */
    sessionId?: string;
    /** Unix-ms timestamp derived from the server's sentAt ISO string. */
    sentAt?: number;
}

export class IrisWebSocketMessageHandler {
    private readonly _onDidReceiveIrisChatMessage = new vscode.EventEmitter<ReceivedIrisChatMessage>();
    public readonly onDidReceiveIrisChatMessage = this._onDidReceiveIrisChatMessage.event;

    // Run-scoped UI projection. Held here (not just the draft) so a later
    // PARTIAL cannot erase a known runState/error and so a disconnect reset
    // can republish a clean projection without inventing a frame.
    //
    // NOTE: on disconnect, only the webview store is reset (via
    // UpdateWebSocketStatus -> resetTransientChatUi in the webview). This
    // handler-side projection is left untouched here on purpose: the
    // provider's `_recoverOnResubscribe` clears it (resetRunUiAndPublish)
    // once the reconciled history proves the run finished, which is the only
    // moment a stale partial is known to be stale.
    private _draft: { runId: string; text: string } | null = null;
    private _activities: IrisActivityDTO[] = [];
    private _runState: IrisRunState | null = null;
    private _error: { message?: string } | null = null;
    private _revision = 0;

    constructor(
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisWebSocketSessionClient: () => IrisWebSocketSessionClient | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
        private readonly _runs: IrisRunStateMachine,
        private readonly _getConversation: () => IrisConversationService | undefined,
    ) { }

    /**
     * Gates every behaviour that needs a conversation (the source-session
     * check, the CTXSWAP branch, host-state ingestion) on one being *open*,
     * not merely constructed: the service exists from activation, but
     * `ConversationState.currentSessionId` stays `undefined` until `start()`
     * or a navigation has installed something.
     */
    private get _activeConversation(): IrisConversationService | undefined {
        const conversation = this._getConversation();
        return conversation?.state.snapshot().currentSessionId !== undefined ? conversation : undefined;
    }

    public handleIrisWebSocketMessage(data: unknown, sourceSessionId: number): void {
        if (!isIrisWebSocketMessage(data) || typeof data.type !== 'string') {
            logger.info(`Unknown message format: ${JSON.stringify(data)}`, LogCategory.WEBSOCKET);
            return;
        }

        // 1. Source check FIRST: before admission, before run state, before the
        //    title handler. A frame from the conversation we just left must not
        //    be able to bind an unknown run as current or rename the live
        //    session. Skipped only while nothing is open yet, when there is
        //    no conversation to check the frame against.
        const conversation = this._activeConversation;
        if (conversation !== undefined) {
            const current = conversation.state.snapshot().currentSessionId;
            if (sourceSessionId !== current) {
                logger.info(`Dropped frame from session ${sourceSessionId} (current ${String(current)})`, LogCategory.WEBSOCKET);
                return;
            }
            // 2. A context-swap marker is not chat and never touches run state.
            if (data.type === 'MESSAGE' && data.message && isContextSwap(data.message)) {
                this._handleContextSwap(conversation, data.message);
                return;
            }
            // 3. Anything else carrying a body is CONTENT, whatever we draw.
            //    Placed here so the USER-echo, bodiless-answer and ARTIFACT
            //    early returns further down cannot skip it.
            if (data.type === 'MESSAGE' && data.message) {
                conversation.state.upsertMessage(data.message);
            }
        }

        // Proactive pushes are routed BEFORE run admission but AFTER the source
        // check and the canonical upsert above: the frame is already in
        // ConversationState, so this path only adds the proactive rendering.
        // Deliberately outside the `conversation !== undefined` guard, because
        // `_handleProactiveMessage` records the message for the study before it
        // decides whether there is anywhere to draw it.
        // A proactive push is a complete, server-initiated bubble, never part of
        // a user-initiated run; letting one that happened to carry a runId/runState
        // reach admission or applyRunState could bind, reject, or finalize a live
        // user run and wipe its draft. The proactive path bypasses run state entirely. before the
        // run state machine ever sees the frame. A proactive push is a complete,
        // server-initiated bubble, never part of a user-initiated run; letting a
        // proactive frame that happened to carry a runId/runState reach admission
        // or applyRunState could bind, reject, or finalize a live user run and
        // wipe its draft. The proactive path bypasses run state entirely.
        const frameClass = classifyIrisFrame(data);
        if (data.type === 'MESSAGE' && frameClass.kind === 'message' && frameClass.proactive) {
            this._handleProactiveMessage(data);
            return;
        }

        // Admission MUST come first: a stale run must not be able to rename the
        // live session via sessionTitle.
        if (!this._runs.admit(data)) {
            logger.info(`Discarded frame from non-current run ${String(data.runId)}`, LogCategory.WEBSOCKET);
            return;
        }

        this._handleSessionTitle(data);

        // Mirror run state into the projection ONLY when the machine accepted
        // the transition. A stale unscoped FINISHED would otherwise produce
        // waiting:true together with runState:'FINISHED' and wipe the visuals
        // of the run that is actually still going.
        if (data.runState && this._runs.applyRunState(data.runId, data.runState)) {
            this._runState = data.runState;
            this._error = data.error ?? null;
            if (data.runState !== 'RUNNING') {
                this._draft = null;
                this._activities = [];
            }
        }

        switch (data.type) {
            case 'PARTIAL': this._handlePartial(data); break;
            case 'STATUS': this._handleStatus(data); break;
            case 'MESSAGE': this._handleMessage(data); break;
            default:
                logger.info(`Unhandled Iris frame type: ${data.type}`, LogCategory.WEBSOCKET);
                this.publishCurrentRunUi();
        }
    }

    /**
     * Renders a proactive struggle push (origin `PROACTIVE_STRUGGLE`) as a
     * complete assistant bubble carrying its proactive provenance. It does NOT
     * touch the run state machine or the run-UI projection: proactive pushes are
     * not user-initiated runs, so they must never bind/finalize a run or attach
     * `runUi`. Because they are also not run-scoped, the run-scoped recorder path
     * in {@link _handleMessage} never sees them, so this path fires the recorder
     * event itself.
     */
    private _handleProactiveMessage(frame: IrisWebSocketMessage): void {
        const msg = frame.message;
        if (!msg) { return; }

        const content = extractIrisMessageContent(msg.content);
        // A USER frame is the echoed prompt, and a bodiless frame has nothing to
        // render; neither is a proactive bubble.
        if (msg.sender === 'USER' || !content) { return; }

        const sentAtMs = msg.sentAt ? new Date(msg.sentAt).getTime() : undefined;

        // Record the received message BEFORE the UI-attribution guard below: a
        // proactive push is not run-scoped, so the run-scoped recorder path in
        // _handleMessage never sees it, and recording must not depend on whether
        // a session happens to be active for rendering.
        this._onDidReceiveIrisChatMessage.fire({
            content,
            messageId: msg.id !== undefined ? String(msg.id) : undefined,
            sentAt: sentAtMs,
        });

        const localSessionId = this._targetSessionId();
        if (!localSessionId) {
            // No active session to attribute the bubble to. Dropping the render
            // is correct (it would attach to whatever session the user opens
            // next); the message is already recorded above.
            logger.info('Dropping proactive Iris message bubble: no active local session', LogCategory.WEBSOCKET);
            return;
        }

        this._postMessage({
            type: ExtensionMsg.AddMessage,
            sessionId: localSessionId,
            message: {
                id: msg.id,
                role: 'assistant',
                content,
                timestamp: sentAtMs ?? Date.now(),
                helpful: typeof msg['helpful'] === 'boolean' ? msg['helpful'] : null,
                origin: 'proactive',
                ...(msg.proactiveOutcome ? { proactiveOutcome: msg.proactiveOutcome } : {}),
                ...(msg.proactiveEpisodeId ? { proactiveEpisodeId: msg.proactiveEpisodeId } : {}),
                // Forward any tool-activity trail and final flag identically to
                // _handleMessage so a proactive answer's trail shows live (not
                // only after a reload). A proactive push carries no runUi.
                activities: Array.isArray(msg.activities) ? msg.activities.filter(isIrisActivity) : undefined,
                final: typeof msg.final === 'boolean' ? msg.final : undefined,
            },
            // No runUi: a proactive push must leave any in-flight user run untouched.
        });
    }

    private _handlePartial(frame: IrisWebSocketMessage): void {
        const { runId, partialResult, partialSeq } = frame;
        if (!runId || typeof partialResult !== 'string' || typeof partialSeq !== 'number') { return; }
        if (!this._runs.acceptPartial(runId, partialSeq)) { return; }
        this._draft = { runId, text: partialResult };
        this.publishCurrentRunUi();
    }

    private _handleStatus(frame: IrisWebSocketMessage): void {
        const { runId, activitySeq } = frame;
        if (runId && typeof activitySeq === 'number' && Array.isArray(frame.activities)) {
            if (!this._runs.acceptActivities(runId, activitySeq)) { return; }
            this._activities = frame.activities.filter(isIrisActivity);
        }
        this.publishCurrentRunUi();
    }

    private _handleMessage(frame: IrisWebSocketMessage): void {
        const msg = frame.message;
        if (!msg) {
            // A terminal MESSAGE frame can arrive with no message body. It has
            // already changed waiting state above, so it must still publish.
            this.publishCurrentRunUi();
            return;
        }

        const content = extractIrisMessageContent(msg.content);
        if (msg.sender === 'USER') {
            // Never a run terminator, whoever wrote it: it must not finalize the
            // current run even if the server ever scopes it to a runId.
            this.publishCurrentRunUi();
            this._renderForeignUserMessage(msg, content);
            return;
        }

        const intermediate = frame.final === false || msg.final === false;
        this._runs.finalizeRun(frame.runId, intermediate);

        if (!content) {
            // Bodiless assistant final answer: finalized above (waiting
            // cleared), but nothing to render.
            this.publishCurrentRunUi();
            return;
        }

        // A run-ID-less MESSAGE is a resend that attaches memories or activities
        // to an already-persisted message. It must upsert WITHOUT touching the
        // current run's draft or feed, which may belong to a different run.
        const isRunScoped = frame.runId !== undefined;
        if (isRunScoped) {
            this._draft = null;
            if (!intermediate) { this._activities = []; }
        }

        const sessionId = this._targetSessionId();
        if (sessionId === undefined) {
            // No conversation to attribute this message to. Dropping is
            // correct: rendering it would attach it to whatever conversation
            // the student opens next.
            logger.info('Dropping Iris message: no session to attribute it to', LogCategory.WEBSOCKET);
            return;
        }

        const sentAtMs = msg.sentAt ? new Date(msg.sentAt).getTime() : undefined;
        this._postMessage({
            type: ExtensionMsg.AddMessage,
            sessionId,
            message: {
                id: msg.id,
                role: 'assistant',
                content,
                timestamp: sentAtMs ?? Date.now(),
                helpful: typeof msg['helpful'] === 'boolean' ? msg['helpful'] : null,
                activities: Array.isArray(msg.activities) ? msg.activities.filter(isIrisActivity) : undefined,
                final: intermediate ? false : undefined,
            },
            runUi: isRunScoped ? this._buildProjection() : undefined,
        });

        // Only a run-scoped final answer feeds the recorder path. A run-ID-less
        // resend is a memory/activity attachment on a message already recorded,
        // so firing here would double-count it.
        if (isRunScoped && !intermediate) {
            this._onDidReceiveIrisChatMessage.fire({
                content,
                messageId: msg.id !== undefined ? String(msg.id) : undefined,
                sentAt: sentAtMs,
            });
        }
    }

    /**
     * A USER message on this conversation that the webview has not drawn: one
     * the student wrote SOMEWHERE ELSE (the Artemis web client, a second
     * window), or the server's echo of our own prompt.
     *
     * Rendering it upholds the conversation-first promise: what you see is what
     * the server has. Dropping it would still leave it in host state (every
     * MESSAGE frame with a body is upserted above), so it would reappear on the
     * next reload.
     *
     * Deliberately NOT gated on `sendInFlight`. That flag is set before file
     * collection and stays set through the POST and its reconciliation, and
     * another client can write throughout, so suppressing by timing loses those
     * messages for good: nothing re-delivers the transcript when a send settles.
     * Telling our own echo apart from a foreign message is the webview's job,
     * because only it knows what it drew (see `upsertMessage` in the store).
     */
    private _renderForeignUserMessage(msg: IrisChatMessage, content: string): void {
        if (!content) { return; }
        const sessionId = this._targetSessionId();
        if (sessionId === undefined) { return; }

        this._postMessage({
            type: ExtensionMsg.AddMessage,
            sessionId,
            message: {
                id: msg.id,
                role: 'user',
                content,
                timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
            },
        });
    }

    /** The conversation a frame belongs to, or `undefined` when none is open. */
    private _targetSessionId(): number | undefined {
        return this._activeConversation?.state.snapshot().currentSessionId;
    }

    /**
     * `undefined` when there is nothing to attribute the projection to.
     * `sessionId` is a required `number` on the projection, so the narrowing
     * has to happen HERE: "the webview will reject it" is not reachable, tsc
     * rejects it first.
     */
    private _buildProjection(): IrisRunUiProjection | undefined {
        const sessionId = this._targetSessionId();
        if (sessionId === undefined) { return undefined; }
        return {
            sessionId,
            revision: ++this._revision,
            draft: this._draft,
            activities: this._activities,
            waiting: this._runs.waiting,
            runState: this._runState,
            error: this._error,
        };
    }

    public publishCurrentRunUi(): void {
        const projection = this._buildProjection();
        if (!projection) { return; }
        this._postMessage({ type: ExtensionMsg.UpdateIrisRunUi, projection });
    }

    /**
     * Clears the projection (draft/activities/runState/error) but NOT the
     * machine or the revision, then publishes. Called on beginGeneration so a
     * new send does not republish the previous run's FAILED/error.
     */
    public resetRunUiAndPublish(): void {
        this._draft = null;
        this._activities = [];
        this._runState = null;
        this._error = null;
        this.publishCurrentRunUi();
    }

    /** Clears run state (including the machine) and publishes the empty projection. */
    public resetRuns(): void {
        this._runs.reset();
        this._draft = null;
        this._activities = [];
        this._runState = null;
        this._error = null;
        this.publishCurrentRunUi();
    }

    private _handleSessionTitle(data: Record<string, unknown>): void {
        const sessionTitle = data['sessionTitle'];
        if (typeof sessionTitle !== 'string' || !sessionTitle) {
            return;
        }

        const irisSession = this._getIrisWebSocketSessionClient();
        const artemisSessionId = irisSession?.currentSessionId;
        if (!artemisSessionId) {
            return;
        }

        logger.info(`Session title received: "${sessionTitle}" for session ${artemisSessionId}`, LogCategory.WEBSOCKET);

        const conversation = this._activeConversation;
        if (!conversation) { return; }
        conversation.state.setTitle(sessionTitle);
        // Without this, a server-side rename lands in host state but never
        // reaches the webview until some unrelated emit happens to fire: the
        // presenter repaints only off IrisConversationService.onDidChange,
        // which fires only from _emit/notifyChanged.
        conversation.notifyChanged();
    }

    /**
     * A context-swap marker is not chat: it never touches run state, and a
     * malformed one is repaired by reloading rather than guessed at.
     */
    private _handleContextSwap(conversation: IrisConversationService, message: IrisChatMessage): void {
        const swap = parseContextSwap(message);
        if (!swap) {
            // Undecodable marker: it is still content on the server, so reload the
            // detail rather than guess. Never fall through to the chat path.
            //
            // `reload` refuses while a send is unresolved and defers itself, which
            // matters here: the server writes this marker WHILE our own POST is
            // open, so an ungated reload would navigate mid-send and walk straight
            // past the dispatcher gating of spec 7.3.
            void conversation.reload();
            return;
        }
        const outcome = conversation.state.applyContextSwap(swap, message);
        const sessionId = this._targetSessionId();
        if (sessionId !== undefined) {
            this._postMessage({
                type: ExtensionMsg.AddMessage,
                sessionId,
                message: {
                    id: message.id,
                    role: 'contextSwap',
                    content: describeContextSwap(swap),
                    timestamp: message.sentAt ? new Date(message.sentAt).getTime() : Date.now(),
                },
            });
        }
        if (outcome === 'pending-dropped') {
            // Informative only, no undo: the marker itself makes the conversation
            // non-empty, so the staging could never be restored.
            this._postMessage({
                type: ExtensionMsg.ShowChatNotice,
                text: 'The topic was changed elsewhere. Your staged topic was discarded.',
            });
        }
        conversation.notifyChanged();
    }

    public async handleReconnectWebSocket(): Promise<ReconnectResult> {
        if (!this._websocketService) {
            return { status: 'no-service' };
        }

        try {
            if (this._websocketService.isConnected()) {
                this.publishCurrentStatus();
                return { status: 'already-connected' };
            }

            // Reset state in case previous attempts exhausted the limit
            this._websocketService.resetConnectionState();
            await this._websocketService.connect();

            const irisSessionManager = this._getIrisWebSocketSessionClient();
            if (irisSessionManager?.currentSessionId && this._websocketService.isConnected()) {
                logger.info(`Resubscribing to Iris session after reconnect: ${irisSessionManager.currentSessionId}`, LogCategory.IRIS_CHAT);
                void irisSessionManager.subscribeToSession(irisSessionManager.currentSessionId);
            }

            if (this._websocketService.isConnected()) {
                this.publishCurrentStatus();
                return { status: 'reconnected' };
            }

            return { status: 'failed', error: 'Connection attempt did not establish' };
        } catch (error: unknown) {
            logger.error('Failed to reconnect WebSocket', LogCategory.WEBSOCKET, error);
            this.publishCurrentStatus();
            return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Push the current display status to the webview. Reads it from the
     * websocket service so the status bar and the chat webview cannot
     * disagree about what state the connection is in.
     */
    public publishCurrentStatus(): void {
        const status = this._websocketService?.getDisplayStatus() ?? 'disconnected';
        this.publishStatus(status);
    }

    public publishStatus(status: WebSocketDisplayStatus): void {
        this._postMessage({
            type: ExtensionMsg.UpdateWebSocketStatus,
            status,
        });
    }
}
