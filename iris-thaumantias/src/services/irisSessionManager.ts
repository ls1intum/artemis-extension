import * as vscode from 'vscode';
import { ArtemisApiService } from '../api';
import { ArtemisWebsocketService } from './artemisWebsocketService';
import { ActiveContext } from '../provider/contextTypes';

export class IrisSessionManager implements vscode.Disposable {
    private _currentArtemisSessionId?: number;
    private _irisUnsubscribe?: () => void;
    private readonly _onDidReceiveMessage = new vscode.EventEmitter<any>();
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
        this.unsubscribe();
        this._onDidReceiveMessage.dispose();
        this._onDidConnectionStateChange.dispose();
    }

    public get currentSessionId(): number | undefined {
        return this._currentArtemisSessionId;
    }

    public unsubscribe(): void {
        if (this._irisUnsubscribe) {
            console.log('[IrisSessionManager] Unsubscribing from previous Iris session');
            this._irisUnsubscribe();
            this._irisUnsubscribe = undefined;
        }
    }

    public async initializeSession(context: ActiveContext, storedSessionId?: number): Promise<number> {
        console.log('[IrisSessionManager] Initializing session for', context.type, context.id);
        
        let sessionId: number;

        if (storedSessionId) {
            console.log('[IrisSessionManager] Using stored Artemis session ID:', storedSessionId);
            sessionId = storedSessionId;
        } else {
            console.log('[IrisSessionManager] Fetching current session from Artemis');
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
        this.subscribeToSession(sessionId);
        return sessionId;
    }

    public async createNewSession(context: ActiveContext): Promise<number> {
        console.log('[IrisSessionManager] Creating NEW Iris session for', context.type, context.id);

        let newSession;
        if (context.type === 'course') {
            newSession = await this._artemisApiService.createCourseChatSession(context.id);
        } else if (context.type === 'exercise') {
            newSession = await this._artemisApiService.createExerciseChatSession(context.id);
        } else {
            throw new Error(`Unsupported context type: ${context.type}`);
        }

        this._currentArtemisSessionId = newSession.id;
        this.subscribeToSession(newSession.id);
        return newSession.id;
    }

    public subscribeToSession(sessionId: number): void {
        this.unsubscribe();

        if (this._websocketService.isConnected()) {
            console.log('[IrisSessionManager] Subscribing to Iris WebSocket session:', sessionId);
            try {
                this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                    sessionId,
                    (data: any) => this._handleWebSocketMessage(data)
                );
                console.log('[IrisSessionManager] Successfully subscribed');
            } catch (error) {
                console.error('[IrisSessionManager] Failed to subscribe:', error);
            }
        } else {
            console.log('[IrisSessionManager] WebSocket not connected, attempting to connect...');
            this._websocketService.connect().then(() => {
                console.log('[IrisSessionManager] Connected, subscribing to:', sessionId);
                this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                    sessionId,
                    (data: any) => this._handleWebSocketMessage(data)
                );
            }).catch(err => {
                console.error('[IrisSessionManager] Failed to connect WebSocket:', err);
            });
        }
    }

    private _handleWebSocketMessage(data: any): void {
        this._onDidReceiveMessage.fire(data);
    }

    private _startWebSocketMonitoring(): void {
        this._websocketService.onConnectionStateChange((isConnected: boolean) => {
            console.log('[IrisSessionManager] WebSocket connection state changed:', isConnected);
            this._onDidConnectionStateChange.fire(isConnected);

            if (isConnected && this._currentArtemisSessionId) {
                console.log('[IrisSessionManager] Reconnected, resubscribing to session:', this._currentArtemisSessionId);
                this.subscribeToSession(this._currentArtemisSessionId);
            }
        });
    }
}
