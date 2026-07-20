import * as vscode from 'vscode';

import { ExtensionMsg } from '@shared/messageContracts';

import type { IrisServiceDeps } from '@extension/services/iris/context/sessionSyncUtils';
import type { RunLifecycle } from '@extension/services/iris/irisRunStateMachine';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { StruggleContext } from '@extension/services/telemetry';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import { checkWorkspaceFiles } from '@extension/services/workspace/workspaceFileChecker';
import { ActiveContext } from '@extension/types';

import { IrisChatSessionService } from './chatSessionService';

interface SendMessageInput {
    text: string;
    isNoAiEnabled: boolean;
    struggleContext?: StruggleContext;
}

type SendMessageResult =
    | { sent: true }
    | {
        sent: false;
        reason: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable';
        contextLabel?: string;
        /**
         * Context that was active when sendMessage started. Needed so the
         * caller can decide whether to surface a persistent availability
         * banner: if the user has since switched contexts, posting an
         * availability for the new context based on the old context's
         * settings-check result would be wrong (issue surfaced by codex
         * review of the connectivity-resilience PR).
         */
        capturedContext?: ActiveContext;
    };

export class ChatMessageService {
    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisWebSocketSessionClient: () => IrisWebSocketSessionClient | undefined,
        private readonly _chatSessionService: IrisChatSessionService,
        private readonly _runLifecycle: RunLifecycle,
    ) { }

    public async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
        if (input.isNoAiEnabled) {
            logger.warn('Chat blocked: .noai file detected', LogCategory.IRIS_CHAT);
            return { sent: false, reason: 'no-ai' };
        }

        const activeContext = this.deps.contextStore.getActiveContext();
        if (!activeContext) {
            logger.warn('No active context', LogCategory.IRIS_CHAT);
            return { sent: false, reason: 'no-context' };
        }

        const availability = await this._chatSessionService.checkAndLoadIrisSettings(activeContext);
        if (availability.kind !== 'enabled') {
            // Distinguishing disabled from unavailable lets the webview's
            // Retry-button affordance stay active for unavailable (a network
            // blip might have cleared) while remaining disabled for the
            // intentionally-off case.
            const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
            const reason: 'iris-disabled' | 'iris-unavailable' =
                availability.kind === 'disabled' ? 'iris-disabled' : 'iris-unavailable';
            // capturedContext is the context the settings check was actually
            // run against. The provider compares it to the live active
            // context before posting availability so a slow check that
            // returns after the user switched does not pollute the new
            // context's banner state.
            return { sent: false, reason, contextLabel, capturedContext: activeContext };
        }

        await this._sendToIris(input.text, activeContext, input.struggleContext);
        return { sent: true };
    }

    private async _sendToIris(messageText: string, activeContext: ActiveContext, struggleContext?: StruggleContext): Promise<void> {
        logger.websocket(`📤 handleChatMessage called with: ${JSON.stringify({ text: messageText?.substring(0, 50) })}`);

        if (!messageText) {
            logger.websocket('⚠️ No text in message, returning');
            return;
        }

        logger.websocket(`✅ Active context: ${JSON.stringify({ type: activeContext.type, id: activeContext.id, title: activeContext.title })}`);

        if (struggleContext) {
            logger.websocket(`Struggle context: ${JSON.stringify({
                isStruggling: struggleContext.isStruggling,
                eq: struggleContext.eq,
                eqConfidence: struggleContext.eqConfidence,
                recommendedAction: struggleContext.recommendedAction
            })}`);
        }

        // Open the generation BEFORE the missing-API guard and all the
        // preparation steps, every one of which can throw (guard,
        // _ensureWebSocketConnection, _ensureIrisSession, session guard,
        // _collectUncommittedFiles) — not just the POST. The webview has
        // already set streaming=true by now, so a throw with no open
        // generation would leave nothing to abort and the composer would hang.
        const generation = this._runLifecycle.beginGeneration();
        try {
            if (!this.deps.artemisApiService) {
                throw new Error('Artemis API service not available');
            }

            // Check WebSocket connection before sending
            await this._ensureWebSocketConnection();

            // Get or create Iris session
            await this._ensureIrisSession(activeContext);

            const irisSessionManager = this._getIrisWebSocketSessionClient();
            if (!irisSessionManager?.currentSessionId) {
                throw new Error('Failed to initialize Iris session');
            }

            // Collect uncommitted files from the current workspace
            const uncommittedFiles = await this._collectUncommittedFiles();

            // Send message to Iris
            logger.websocket(`🚀 Sending message to Artemis API... ${JSON.stringify({
                sessionId: irisSessionManager.currentSessionId,
                messageLength: messageText.length,
                hasUncommittedFiles: uncommittedFiles ? uncommittedFiles.size : 0
            })}`);
            await this.deps.artemisApiService.sendChatMessage(
                irisSessionManager.currentSessionId,
                messageText,
                uncommittedFiles
            );

            logger.websocket('✅ Message sent to Iris, waiting for WebSocket response...');

            // Note: The assistant's response will arrive via WebSocket
            this.deps.contextStore.incrementActiveSessionMessageCount();
            this.deps.postSnapshot();

        } catch (error: unknown) {
            logger.error('Error sending chat message', LogCategory.IRIS_CHAT, error);
            // Abort only THIS send's generation so a concurrent/newer send is
            // untouched, then rethrow for the provider's error handling.
            this._runLifecycle.abortGeneration(generation);
            throw error;
        }
    }

    /**
     * Ensure WebSocket is connected before sending a message.
     *
     * SAFETY: connect() has all safety guards built in:
     * - State machine guards (connecting/disconnecting/gave-up)
     * - Max attempts (20 attempts, then gives up)
     * - Mutex protection via connection state
     */
    private async _ensureWebSocketConnection(): Promise<void> {
        logger.websocket('🔍 Checking WebSocket connection before sending message...');
        if (!this._websocketService) {
            logger.warn('⚠️ No WebSocket service available', LogCategory.WEBSOCKET);
            return;
        }

        if (this._websocketService.isConnected()) {
            logger.websocket('✅ WebSocket already connected');
            return;
        }

        logger.websocket('⚠️ WebSocket not connected, attempting to connect...');
        try {
            await this._websocketService.connect();
            logger.websocket('✅ WebSocket connected successfully');
        } catch {
            logger.warn('⚠️ WebSocket connection not established', LogCategory.WEBSOCKET);
        }
    }

    private async _ensureIrisSession(activeContext: ActiveContext): Promise<void> {
        const irisSessionManager = this._getIrisWebSocketSessionClient();
        logger.websocket(`🔑 Checking for existing Iris session... ${JSON.stringify({
            hasSessionId: !!irisSessionManager?.currentSessionId,
            sessionId: irisSessionManager?.currentSessionId
        })}`);

        if (!irisSessionManager?.currentSessionId) {
            logger.websocket('🆕 No active session found, initializing new Iris session...');
            if (irisSessionManager) {
                await this._chatSessionService.initializeIrisSessionAndLoadMessages(activeContext, irisSessionManager);
            }
        } else {
            logger.websocket(`✅ Using existing Iris session: ${irisSessionManager.currentSessionId}`);
        }
    }

    private async _collectUncommittedFiles(): Promise<Map<string, string> | undefined> {
        let uncommittedFiles: Map<string, string> | undefined;

        // Check if the user has enabled sending uncommitted changes
        const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);

        if (!sendUncommittedChanges) {
            logger.irisChat('📁 Uncommitted changes sending is disabled by user setting');
            return undefined;
        }

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

            // Use unified checker with full options (content + filters + status)
            const result = await checkWorkspaceFiles(workspaceFolder, {
                includeContent: true,
                applyFilters: true,
                includeStatus: true,
                checkUnpushed: true,
                includeDirty: true
            });

            // Convert to Map for backward compatibility
            uncommittedFiles = new Map();
            result.files
                .filter(f => f.status === 'included' && f.content !== undefined)
                .forEach(f => uncommittedFiles!.set(f.path, f.content!));

            if (uncommittedFiles.size > 0) {
                logger.irisChat(`📁 Sending ${uncommittedFiles.size} uncommitted file(s) to Iris`);

                // Update display with detailed analysis
                const excludedFiles = result.files
                    .filter(f => f.status === 'excluded')
                    .map(f => ({ path: f.path, reason: f.reason || 'Excluded' }));

                this.deps.postMessage({
                    type: ExtensionMsg.UpdateReferencedFiles,
                    includedFiles: Array.from(uncommittedFiles.keys()),
                    excludedFiles: excludedFiles,
                    totalCount: result.totalCount
                });
            }

            return uncommittedFiles;
        } catch (error: unknown) {
            logger.error('Error collecting uncommitted files', LogCategory.IRIS_CHAT, error);
            // Continue without uncommitted files - this is not a critical error
            return undefined;
        }
    }
}
