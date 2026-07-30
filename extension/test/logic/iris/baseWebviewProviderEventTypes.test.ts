import { describe, expect, it } from 'vitest';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';

import { BaseWebviewProvider } from '@extension/provider/baseWebviewProvider';

/**
 * Exercises `BaseWebviewProvider`'s actual, private `EVENT_TYPES`
 * classification (not a hand-rolled copy of it), by driving the real
 * queue-then-flush path through the protected surface a subclass has.
 *
 * `test/logic/iris/webviewQueueOrdering.test.ts` already covers the pure
 * `coalescePending` algorithm against a locally-defined event set; it would
 * not notice a regression in the production `EVENT_TYPES` set itself (e.g.
 * forgetting to list `showChatNotice`). This file closes that gap.
 */
class TestProvider extends BaseWebviewProvider {
    public render(): void { /* no-op for the test harness */ }
    protected _onReady(): void { /* no-op for the test harness */ }
    protected _handleCommand(_message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void { /* unused */ }

    /** Queues a message via the real (protected) `_postMessageSafe`. */
    public post(message: ExtensionToWebviewMessage): void {
        this._postMessageSafe(message);
    }

    /** Attaches a fake view so `_markReady` can flush the queue, and spies on delivery. */
    public attachView(onPost: (message: ExtensionToWebviewMessage) => void): void {
        this._view = { webview: { postMessage: onPost } } as unknown as typeof this._view;
    }

    public markReady(): void {
        this._markReady();
    }
}

describe('BaseWebviewProvider event-type classification', () => {
    it('never deduplicates showChatNotice: two notices queued before ready both flush', () => {
        const provider = new TestProvider();
        provider.post({ type: 'showChatNotice', text: 'first notice' });
        provider.post({ type: 'showChatNotice', text: 'second notice' });

        const delivered: ExtensionToWebviewMessage[] = [];
        provider.attachView((msg) => delivered.push(msg));
        provider.markReady();

        expect(delivered).toEqual([
            { type: 'showChatNotice', text: 'first notice' },
            { type: 'showChatNotice', text: 'second notice' },
        ]);
    });

    it('coalesces updateIrisState to last-wins: two snapshots queued before ready flush as one', () => {
        const provider = new TestProvider();
        const stateA = { context: null, activeSessionId: null, sessions: [], exercises: [], courses: [], courseId: 1 };
        const stateB = { context: null, activeSessionId: null, sessions: [], exercises: [], courses: [], courseId: 2 };
        provider.post({ type: 'updateIrisState', state: stateA as never });
        provider.post({ type: 'updateIrisState', state: stateB as never });

        const delivered: ExtensionToWebviewMessage[] = [];
        provider.attachView((msg) => delivered.push(msg));
        provider.markReady();

        expect(delivered).toHaveLength(1);
        expect(delivered[0]).toEqual({ type: 'updateIrisState', state: stateB });
    });
});
