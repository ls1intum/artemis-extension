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
export class IrisWebSocketSessionClient implements vscode.Disposable {
    /**
     * Transient runtime copy of the Artemis session ID for WebSocket subscription.
     * The authoritative copy lives in `ContextStore.StoredSession.artemisSessionId`
     * (used for session re-initialization across context switches).
     * Both copies are synchronized by `IrisChatSessionService` during lifecycle operations.
     */
    private _currentArtemisSessionId?: number;
    private _irisUnsubscribe?: () => void;
    private _connectionStateSubscription?: vscode.Disposable;
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
        if (this._connectionStateSubscription) {
            this._connectionStateSubscription.dispose();
            this._connectionStateSubscription = undefined;
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
        // Check rate limiting BEFORE tearing down the existing subscription.
        // Previous code unsubscribed first, then returned on rate-limit,
        // leaving zero active subscriptions.
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

        // Safe to tear down old subscription — we are about to create a new one.
        this.unsubscribe();

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
        // Store subscription disposable for cleanup in dispose()
        this._connectionStateSubscription = this._websocketService.onDidChangeConnectionState(({ connected: isConnected }) => {
            logger.session(`WebSocket connection state changed: ${isConnected}`);
            this._onDidConnectionStateChange.fire(isConnected);

            if (isConnected) {
                // Every (re)connect creates a fresh STOMP session — all prior STOMP
                // subscriptions are gone at the protocol level regardless of whether
                // we received a disconnect notification (which is debounced by 5 s).
                // Mark ourselves as unsubscribed so we always re-attach.
                this._isSubscribed = false;

                if (this._currentArtemisSessionId) {
                    logger.session(`(Re)connected, resubscribing to session: ${this._currentArtemisSessionId}`);
                    void this._subscribeIfConnected(this._currentArtemisSessionId);
                }
            } else {
                this._isSubscribed = false;
            }
        });
    }
}
