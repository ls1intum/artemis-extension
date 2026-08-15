import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import * as assert from 'assert';

import { SubscriptionRegistry } from '@extension/services/websocket/subscriptionRegistry';
import type { WebSocketMessageHandler } from '@extension/types';

class FakeClient {
    public subscribed: Map<string, (msg: IMessage) => void> = new Map();
    public connected = true;
    private _id = 0;
    public subscribe(topic: string, cb: (msg: IMessage) => void): StompSubscription {
        this.subscribed.set(topic, cb);
        const id = `sub-${++this._id}`;
        return {
            id,
            unsubscribe: () => {
                if (this.subscribed.get(topic) === cb) { this.subscribed.delete(topic); }
            },
        };
    }
}

function makeRegistry(): { registry: SubscriptionRegistry; client: FakeClient } {
    const registry = new SubscriptionRegistry({ log: () => { /* silent */ } });
    const client = new FakeClient();
    registry.attachClient(client as unknown as Client);
    return { registry, client };
}

suite('SubscriptionRegistry', () => {
    test('subscribeToPersonalResults dispatches to registered handlers', () => {
        const { registry, client } = makeRegistry();
        let received: any;
        const handler: WebSocketMessageHandler = { onNewResult: (r) => { received = r; } };
        registry.registerMessageHandler(handler);

        registry.subscribeToPersonalResults();
        const cb = client.subscribed.get('/user/topic/newResults');
        assert.ok(cb, 'subscription registered');
        cb!({ body: JSON.stringify({ id: 1, score: 75, successful: true }) } as IMessage);

        assert.strictEqual(received.id, 1);
        assert.strictEqual(received.score, 75);
    });

    test('duplicate subscribe is idempotent', () => {
        const { registry, client } = makeRegistry();
        registry.subscribeToPersonalResults();
        registry.subscribeToPersonalResults();
        assert.strictEqual(client.subscribed.size, 1);
    });

    test('clearAll unsubscribes everything', () => {
        const { registry, client } = makeRegistry();
        registry.subscribeToPersonalResults();
        registry.subscribeToPersonalSubmissions();
        registry.subscribeToSubmissionProcessing();
        assert.strictEqual(client.subscribed.size, 3);

        registry.clearAll();
        assert.strictEqual(client.subscribed.size, 0);
    });

    test('subscribeToIrisSession returns unsubscribe that ignores stale replacement', () => {
        const { registry, client } = makeRegistry();
        const sessionId = 99;
        const topic = '/user/topic/iris/99';

        const unsub1 = registry.subscribeToIrisSession(sessionId, () => { /* noop */ });
        assert.ok(client.subscribed.has(topic));

        const unsub2 = registry.subscribeToIrisSession(sessionId, () => { /* noop */ });
        assert.ok(client.subscribed.has(topic));

        // Stale unsubscribe must not remove the active one
        unsub1();
        assert.ok(client.subscribed.has(topic));

        unsub2();
        assert.strictEqual(client.subscribed.has(topic), false);
    });

    test('subscribe throws if no client attached', () => {
        const registry = new SubscriptionRegistry({ log: () => { /* silent */ } });
        assert.throws(() => registry.subscribeToIrisSession(1, () => { /* noop */ }), /not connected/);
    });

    test('handler unregister stops dispatch', () => {
        const { registry, client } = makeRegistry();
        let calls = 0;
        const handler: WebSocketMessageHandler = { onNewResult: () => { calls++; } };
        registry.registerMessageHandler(handler);
        registry.subscribeToPersonalResults();
        const cb = client.subscribed.get('/user/topic/newResults')!;
        cb({ body: JSON.stringify({ id: 1, score: 1, successful: true }) } as IMessage);
        assert.strictEqual(calls, 1);

        registry.unregisterMessageHandler(handler);
        cb({ body: JSON.stringify({ id: 2, score: 2, successful: true }) } as IMessage);
        assert.strictEqual(calls, 1);
    });
});
