import * as assert from 'assert';

import { buildWebSocketUrl } from '@extension/services/websocket/webSocketUrl';

suite('buildWebSocketUrl', () => {
    test('converts https:// to wss://', () => {
        assert.strictEqual(
            buildWebSocketUrl('https://artemis.example.com/'),
            'wss://artemis.example.com/websocket/websocket'
        );
    });

    test('converts http:// to ws://', () => {
        assert.strictEqual(
            buildWebSocketUrl('http://localhost:8080/'),
            'ws://localhost:8080/websocket/websocket'
        );
    });

    test('preserves port and host', () => {
        assert.strictEqual(
            buildWebSocketUrl('https://artemis.example.com:8443/path'),
            'wss://artemis.example.com:8443/websocket/websocket'
        );
    });
});
