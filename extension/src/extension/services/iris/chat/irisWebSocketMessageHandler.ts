import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, IrisRunUiProjection, WebSocketDisplayStatus } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

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
        private readonly _getLocalSessionId: () => string | undefined,
        private readonly _onSessionTitleUpdate?: (artemisSessionId: number, title: string) => void,
    ) { }

    public handleIrisWebSocketMessage(data: unknown): void {
        if (!isIrisWebSocketMessage(data) || typeof data.type !== 'string') {
            logger.info(`Unknown message format: ${JSON.stringify(data)}`, LogCategory.WEBSOCKET);
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

        const intermediate = frame.final === false || msg.final === false;
        this._runs.finalizeRun(frame.runId, intermediate);

        const content = extractIrisMessageContent(msg.content);
        if (msg.sender === 'USER' || !content) {
            // Still publish: a terminal frame with no renderable content must not
            // leave the webview showing a stale waiting state.
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

        const localSessionId = this._getLocalSessionId();
        if (!localSessionId) {
            // No active session to attribute this message to. Dropping is
            // correct: rendering it would attach it to whatever session the
            // user opens next.
            logger.info('Dropping Iris message: no active local session', LogCategory.WEBSOCKET);
            return;
        }

        const sentAtMs = msg.sentAt ? new Date(msg.sentAt).getTime() : undefined;
        this._postMessage({
            type: ExtensionMsg.AddMessage,
            localSessionId,
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
     * `undefined` when there is no active local session. `localSessionId` on the
     * projection is a required `string`, and the accessor is
     * `snapshot().activeSession?.id`, so the narrowing has to happen HERE.
     * "The webview will reject it" is not reachable: tsc rejects it first.
     */
    private _buildProjection(): IrisRunUiProjection | undefined {
        const localSessionId = this._getLocalSessionId();
        if (!localSessionId) { return undefined; }
        return {
            localSessionId,
            revision: ++this._revision,
            draft: this._draft,
            activities: this._activities,
            waiting: this._runs.waiting,
            runState: this._runState,
            error: this._error,
        };
    }

    /** Publishes the current projection. */
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
        this._onSessionTitleUpdate?.(artemisSessionId, sessionTitle);
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

            // If we have an active Iris session, resubscribe to it
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
