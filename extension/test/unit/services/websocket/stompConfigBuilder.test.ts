import * as assert from 'assert';

import { buildStompConfig } from '@extension/services/websocket/stompConfigBuilder';

suite('buildStompConfig', () => {
    function makeDeps(overrides: Partial<Parameters<typeof buildStompConfig>[0]> = {}) {
        return {
            generation: 7,
            authHeaders: { Cookie: 'jwt=abc' },
            wsUrl: 'wss://example.com/websocket/websocket',
            currentGeneration: () => 7,
            onConnected: () => { /* spy */ },
            onStompError: (_msg: string) => { /* spy */ },
            onWebSocketError: (_msg: string) => { /* spy */ },
            onDisconnected: () => { /* spy */ },
            onWebSocketBeforeOpen: () => { /* spy */ },
            log: (_msg: string) => { /* spy */ },
            ...overrides,
        };
    }

    test('sets brokerURL to wsUrl and empty connectHeaders', () => {
        const cfg = buildStompConfig(makeDeps());
        assert.strictEqual(cfg.brokerURL, 'wss://example.com/websocket/websocket');
        assert.deepStrictEqual(cfg.connectHeaders, {});
    });

    test('onConnect callback gated by generation match', () => {
        let connectedCalls = 0;
        let current = 7;
        const cfg = buildStompConfig(makeDeps({
            currentGeneration: () => current,
            onConnected: () => { connectedCalls++; },
        }));

        cfg.onConnect!({} as any);
        assert.strictEqual(connectedCalls, 1);

        current = 8;
        cfg.onConnect!({} as any);
        assert.strictEqual(connectedCalls, 1, 'must not fire when generation differs');
    });

    test('onStompError callback gated by generation', () => {
        let lastError = '';
        let current = 7;
        const cfg = buildStompConfig(makeDeps({
            currentGeneration: () => current,
            onStompError: (msg) => { lastError = msg; },
        }));

        cfg.onStompError!({ headers: { message: 'broker rejected' }, body: '' } as any);
        assert.ok(lastError.includes('broker rejected'));

        current = 8;
        cfg.onStompError!({ headers: { message: 'ignored' }, body: '' } as any);
        assert.ok(!lastError.includes('ignored'));
    });

    test('onWebSocketError extracts message or type from event', () => {
        let lastError = '';
        const cfg = buildStompConfig(makeDeps({
            onWebSocketError: (msg) => { lastError = msg; },
        }));

        cfg.onWebSocketError!({ message: 'ECONNREFUSED' } as any);
        assert.ok(lastError.includes('ECONNREFUSED'));

        cfg.onWebSocketError!({ type: 'error' } as any);
        assert.ok(lastError.includes('error'));

        cfg.onWebSocketError!({} as any);
        assert.ok(lastError.includes('unknown'));
    });

    test('onWebSocketError gated by generation', () => {
        let calls = 0;
        let current = 7;
        const cfg = buildStompConfig(makeDeps({
            currentGeneration: () => current,
            onWebSocketError: () => { calls++; },
        }));
        cfg.onWebSocketError!({ message: 'x' } as any);
        assert.strictEqual(calls, 1);
        current = 8;
        cfg.onWebSocketError!({ message: 'x' } as any);
        assert.strictEqual(calls, 1, 'must not fire when generation differs');
    });

    test('onDisconnect gated by generation', () => {
        let calls = 0;
        let current = 7;
        const cfg = buildStompConfig(makeDeps({
            currentGeneration: () => current,
            onDisconnected: () => { calls++; },
        }));
        cfg.onDisconnect!({} as any);
        assert.strictEqual(calls, 1);
        current = 8;
        cfg.onDisconnect!({} as any);
        assert.strictEqual(calls, 1, 'must not fire when generation differs');
    });

    test('onWebSocketClose gated by generation', () => {
        let calls = 0;
        let current = 7;
        const cfg = buildStompConfig(makeDeps({
            currentGeneration: () => current,
            onDisconnected: () => { calls++; },
        }));
        cfg.onWebSocketClose!({} as any);
        assert.strictEqual(calls, 1);
        current = 8;
        cfg.onWebSocketClose!({} as any);
        assert.strictEqual(calls, 1, 'must not fire when generation differs');
    });

    test('webSocketFactory invokes onWebSocketBeforeOpen each call', () => {
        let beforeOpenCalls = 0;
        const cfg = buildStompConfig(makeDeps({
            onWebSocketBeforeOpen: () => { beforeOpenCalls++; },
        }));

        // Wrap to swallow constructor exceptions from `new WebSocket(...)`
        // (the fake URL won't resolve, but the hook still fires first).
        try { cfg.webSocketFactory!(); } catch { /* ignore */ }
        try { cfg.webSocketFactory!(); } catch { /* ignore */ }
        assert.strictEqual(beforeOpenCalls, 2);
    });
});
