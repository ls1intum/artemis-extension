import type { Client, IMessage, StompSubscription } from '@stomp/stompjs';

import { LogCategory, logger } from '@extension/services/loggingService';
import type { WebSocketMessageHandler } from '@extension/types';
import { parseProgrammingSubmission, parseResultDTO, parseSubmissionProcessingMessage } from '@extension/types';
import { WEBSOCKET_TOPICS } from '@extension/utils';

interface SubscriptionRegistryDeps {
    log(message: string): void;
}

/**
 * Owns the STOMP subscriptions and the `WebSocketMessageHandler` fan-out.
 *
 * The registry does not own the STOMP client; the orchestrator attaches/
 * detaches the client at connect/disconnect time. Subscriptions made
 * without an attached client throw (Iris) or no-op (personal topics) — they
 * are never silently queued.
 */
export class SubscriptionRegistry {
    private _client?: Client;
    private readonly _subscriptions: Map<string, StompSubscription> = new Map();
    private _messageHandlers: WebSocketMessageHandler[] = [];

    constructor(private readonly _deps: SubscriptionRegistryDeps) {}

    public attachClient(client: Client): void {
        this._client = client;
    }

    public detachClient(): void {
        this._client = undefined;
    }

    public registerMessageHandler(handler: WebSocketMessageHandler): void {
        if (this._messageHandlers.includes(handler)) { return; }
        this._messageHandlers.push(handler);
        this._deps.log(`Message handler registered. Total handlers: ${this._messageHandlers.length}`);
    }

    public unregisterMessageHandler(handler: WebSocketMessageHandler): void {
        const idx = this._messageHandlers.indexOf(handler);
        if (idx !== -1) { this._messageHandlers.splice(idx, 1); }
    }

    public clearMessageHandlers(): void {
        this._messageHandlers = [];
    }

    public subscribeToPersonalResults(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.NEW_RESULTS,
            (data) => parseResultDTO(data),
            (handler, result) => handler.onNewResult?.(result),
            (result) => `Received new result: score=${result.score}, successful=${result.successful}`,
        );
    }

    public subscribeToPersonalSubmissions(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.NEW_SUBMISSIONS,
            (data) => parseProgrammingSubmission(data),
            (handler, submission) => handler.onNewSubmission?.(submission),
            (submission) => `Received new submission: ${submission.id}`,
        );
    }

    public subscribeToSubmissionProcessing(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.SUBMISSION_PROCESSING,
            (data) => parseSubmissionProcessingMessage(data),
            (handler, msg) => handler.onSubmissionProcessing?.(msg),
            (msg) => `Received submission processing update: participationId=${msg.participationId}`,
        );
    }

    public subscribeToIrisSession(sessionId: number, onMessage: (message: unknown) => void): () => void {
        if (!this._client) {
            this._deps.log('Cannot subscribe: not connected');
            throw new Error('WebSocket not connected');
        }

        const topic = WEBSOCKET_TOPICS.irisSession(sessionId);

        if (this._subscriptions.has(topic)) {
            this._deps.log(`Replacing existing subscription for ${topic}`);
            const oldSub = this._subscriptions.get(topic);
            try { oldSub?.unsubscribe(); } catch { /* stale sub, ignore */ }
            this._subscriptions.delete(topic);
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                const data: unknown = JSON.parse(message.body);
                this._deps.log(`Received Iris message for session ${sessionId}`);
                onMessage(data);
            } catch (error) {
                const stack = error instanceof Error ? error.stack : String(error);
                this._deps.log(`Error processing Iris message: ${stack}`);
                logger.error('Full error processing Iris message', LogCategory.WEBSOCKET, error as Error);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._deps.log(`✅ Subscribed to Iris session: ${topic}`);

        const capturedSub = subscription;
        return () => {
            capturedSub.unsubscribe();
            if (this._subscriptions.get(topic) === capturedSub) {
                this._subscriptions.delete(topic);
            }
            this._deps.log(`Unsubscribed from ${topic}`);
        };
    }

    public subscribeToTopic(topic: string, onMessage: (data: unknown) => void): () => void {
        if (!this._client) {
            this._deps.log('Cannot subscribe: not connected');
            throw new Error('WebSocket not connected');
        }

        if (this._subscriptions.has(topic)) {
            this._deps.log(`Replacing existing subscription for ${topic}`);
            const oldSub = this._subscriptions.get(topic);
            try { oldSub?.unsubscribe(); } catch { /* stale sub, ignore */ }
            this._subscriptions.delete(topic);
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                const data: unknown = JSON.parse(message.body);
                this._deps.log(`Received message on ${topic}`);
                onMessage(data);
            } catch (error) {
                const stack = error instanceof Error ? error.stack : String(error);
                this._deps.log(`Error processing message on ${topic}: ${stack}`);
                logger.error(`Full error processing message on ${topic}`, LogCategory.WEBSOCKET, error as Error);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._deps.log(`✅ Subscribed to topic: ${topic}`);

        const capturedSub = subscription;
        return () => {
            capturedSub.unsubscribe();
            if (this._subscriptions.get(topic) === capturedSub) {
                this._subscriptions.delete(topic);
            }
            this._deps.log(`Unsubscribed from ${topic}`);
        };
    }

    public clearAll(): void {
        this._subscriptions.forEach((subscription, topic) => {
            try {
                subscription.unsubscribe();
                this._deps.log(`Unsubscribed from ${topic}`);
            } catch { /* stale sub after disconnect, safe to ignore */ }
        });
        this._subscriptions.clear();
    }

    public get size(): number {
        return this._subscriptions.size;
    }

    public get topics(): string[] {
        return Array.from(this._subscriptions.keys());
    }

    private _subscribeToTopic<T>(
        topic: string,
        parser: (data: unknown) => T,
        dispatch: (handler: WebSocketMessageHandler, parsed: T) => void,
        logFormatter: (parsed: T) => string,
    ): void {
        if (!this._client) {
            this._deps.log('Cannot subscribe: not connected');
            return;
        }
        if (this._subscriptions.has(topic)) {
            this._deps.log(`Already subscribed to ${topic}`);
            return;
        }
        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                const parsed = parser(JSON.parse(message.body));
                this._deps.log(logFormatter(parsed));
                [...this._messageHandlers].forEach(handler => dispatch(handler, parsed));
            } catch (error) {
                const stack = error instanceof Error ? error.stack : String(error);
                this._deps.log(`Error processing message on ${topic}: ${stack}`);
            }
        });
        this._subscriptions.set(topic, subscription);
        this._deps.log(`Subscribed to ${topic}`);
    }
}
