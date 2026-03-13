import * as vscode from 'vscode';
import { ArtemisApiService } from '../../api';
import { ArtemisWebsocketService } from '../websocket/artemisWebsocketService';
import { ActiveContext, type IrisChatMessage } from '../../types';
import { logger, LogLevel } from '../loggingService';

/** WebSocket message structure for Iris chat */
interface IrisWebSocketMessage {
    type?: string;
    message?: IrisChatMessage;
    [key: string]: unknown;
}

/**
 * Minimum interval between resubscription attempts (milliseconds).
 * Prevents rapid resubscription loops.
 */
const MIN_RESUBSCRIBE_INTERVAL_MS = 3000;

/**
 * Manages Iris chat sessions and WebSocket subscriptions.
 * 
 * SAFETY FEATURES to prevent connection flooding:
 * 1. Stores unsubscribe function for connection state callback
 * 2. Rate-limits resubscription attempts
 * 3. Does NOT call connect() - only subscribes if already connected
 * 4. Tracks subscription state to prevent duplicate subscriptions
 */
export class IrisSessionManager implements vscode.Disposable {
    private _currentArtemisSessionId?: number;
    private _irisUnsubscribe?: () => void;
    private _connectionStateUnsubscribe?: () => void;
    private _lastResubscribeAttempt: number = 0;
    private _isSubscribed: boolean = false;

    private readonly _onDidReceiveMessage = new vscode.EventEmitter<IrisWebSocketMessage>();
    public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;
    private readonly _onDidConnectionStateChange = new vscode.EventEmitter<boolean>();
    public readonly onDidConnectionStateChange = this._onDidConnectionStateChange.event;

    constructor(
        private readonly _artemisApiService: ArtemisApiService,
        private readonly _websocketService: ArtemisWebsocketService
    ) {
        this._startWebSocketMonitoring();
    }

    public dispose(): void {
        logger.session('Disposing...');

        // Unsubscribe from connection state changes FIRST
        if (this._connectionStateUnsubscribe) {
            this._connectionStateUnsubscribe();
            this._connectionStateUnsubscribe = undefined;
        }

        this.unsubscribe();
        this._onDidReceiveMessage.dispose();
        this._onDidConnectionStateChange.dispose();
    }

    public get currentSessionId(): number | undefined {
        return this._currentArtemisSessionId;
    }

    public unsubscribe(): void {
        if (this._irisUnsubscribe) {
            logger.session('Unsubscribing from Iris session');
            try {
                this._irisUnsubscribe();
            } catch (e) {
                logger.sessionError('Error during unsubscribe:', e);
            }
            this._irisUnsubscribe = undefined;
        }
        this._isSubscribed = false;
    }

    /** Unsubscribe AND clear the cached session ID (used on context switch). */
    public resetSession(): void {
        this.unsubscribe();
        this._currentArtemisSessionId = undefined;
    }

    public async initializeSession(context: ActiveContext, storedSessionId?: number): Promise<number> {
        logger.session(`Initializing session for ${context.type} ${context.id}`);

        let sessionId: number;

        if (storedSessionId) {
            logger.session(`Using stored Artemis session ID: ${storedSessionId}`);
            sessionId = storedSessionId;
        } else {
            logger.session('Fetching current session from Artemis');
            let session;
            if (context.type === 'course') {
                session = await this._artemisApiService.getCurrentCourseChat(context.id);
            } else if (context.type === 'exercise') {
                session = await this._artemisApiService.getCurrentExerciseChat(context.id);
            } else {
                throw new Error(`Unsupported context type: ${context.type}`);
            }
            sessionId = session.id;
        }

        this._currentArtemisSessionId = sessionId;
        await this._subscribeIfConnected(sessionId);
        return sessionId;
    }

    public async createNewSession(context: ActiveContext): Promise<number> {
        logger.session(`Creating NEW Iris session for ${context.type} ${context.id}`);

        let newSession;
        if (context.type === 'course') {
            newSession = await this._artemisApiService.createCourseChatSession(context.id);
        } else if (context.type === 'exercise') {
            newSession = await this._artemisApiService.createExerciseChatSession(context.id);
        } else {
            throw new Error(`Unsupported context type: ${context.type}`);
        }

        this._currentArtemisSessionId = newSession.id;
        await this._subscribeIfConnected(newSession.id);
        return newSession.id;
    }

    /**
     * Subscribe to session ONLY if WebSocket is already connected.
     * Does NOT attempt to connect - that would cause a loop!
     * 
     * SAFETY: This method never calls connect() on the WebSocket service.
     */
    private async _subscribeIfConnected(sessionId: number): Promise<void> {
        // Always clean up previous subscription first, even if rate-limited,
        // so fast session switches don't leave the new session unsubscribed.
        this.unsubscribe();

        // Check rate limiting
        const now = Date.now();
        const timeSinceLastAttempt = now - this._lastResubscribeAttempt;
        if (timeSinceLastAttempt < MIN_RESUBSCRIBE_INTERVAL_MS) {
            logger.session(`Rate limited: ${MIN_RESUBSCRIBE_INTERVAL_MS - timeSinceLastAttempt}ms until next subscribe`);
            return;
        }

        if (!this._websocketService.isConnected()) {
            logger.session('WebSocket not connected, will subscribe when connected');
            // NOTE: We do NOT call connect() here! The connection state callback will handle this.
            return;
        }

        // Only consume rate-limit window when we actually attempt to subscribe
        this._lastResubscribeAttempt = now;

        logger.session(`Subscribing to Iris WebSocket session: ${sessionId}`);
        try {
            this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                sessionId,
                (data: unknown) => this._handleWebSocketMessage(data)
            );
            this._isSubscribed = true;
            logger.session(`Successfully subscribed to session: ${sessionId}`);
        } catch (error) {
            logger.sessionError('Failed to subscribe:', error);
            this._isSubscribed = false;
        }
    }

    /**
     * Public method to explicitly subscribe to a session.
     * Use this when you know the WebSocket should be connected.
     */
    public async subscribeToSession(sessionId: number): Promise<void> {
        await this._subscribeIfConnected(sessionId);
    }

    private _handleWebSocketMessage(data: unknown): void {
        this._onDidReceiveMessage.fire(data as IrisWebSocketMessage);
    }

    /**
     * Monitor WebSocket connection state and resubscribe when reconnected.
     * 
     * SAFETY FEATURES:
     * 1. Stores unsubscribe function to prevent callback accumulation
     * 2. Does NOT call connect() - only subscribes if already connected
     * 3. Rate-limits resubscription attempts
     */
    private _startWebSocketMonitoring(): void {
        // Store unsubscribe function for cleanup in dispose()
        this._connectionStateUnsubscribe = this._websocketService.onConnectionStateChange((isConnected: boolean) => {
            logger.session(`WebSocket connection state changed: ${isConnected}`);
            this._onDidConnectionStateChange.fire(isConnected);

            if (!isConnected) {
                // STOMP subscriptions are cleared on disconnect; mark ourselves as unsubscribed
                // so the reconnect path below will re-attach.
                this._isSubscribed = false;
            }

            // Only resubscribe if:
            // 1. We just connected
            // 2. We have a session to subscribe to
            // 3. We're not already subscribed
            if (isConnected && this._currentArtemisSessionId && !this._isSubscribed) {
                logger.session(`Reconnected, resubscribing to session: ${this._currentArtemisSessionId}`);
                // NOTE: _subscribeIfConnected does NOT call connect() - it's safe!
                void this._subscribeIfConnected(this._currentArtemisSessionId);
            }
        });
    }
}
