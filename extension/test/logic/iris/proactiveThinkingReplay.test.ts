import { describe, expect, it } from 'vitest';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { ProactiveChatPresenter } from '@extension/services/iris/chat/proactiveChatPresenter';

/**
 * A banner-raised offer is accepted BEFORE the chat exists: `handleBannerAction` runs, then
 * `iris.chatView.focus` resolves the view and `_resetReadyState()` throws the queued message away.
 * So the presenter keeps the flag and `ChatWebviewProvider._onReady` replays it, which is what makes
 * the student land on a chat that already shows Iris working.
 */
describe('proactive thinking replay', () => {
    function presenter(): { p: ProactiveChatPresenter; posted: ExtensionToWebviewMessage[] } {
        const posted: ExtensionToWebviewMessage[] = [];
        const p = new ProactiveChatPresenter({
            postMessage: (m: ExtensionToWebviewMessage) => { posted.push(m); },
            getConversation: () => undefined,
            getView: () => undefined,
            focusChat: () => Promise.resolve(undefined),
            artemisApi: undefined,
        } as never);
        return { p, posted };
    }

    it('posts the flag when the host sets it', () => {
        const { p, posted } = presenter();
        p.setThinking(true);
        expect(posted).toEqual([{ type: ExtensionMsg.SetProactiveThinking, thinking: true }]);
    });

    it('replays a still-true flag to a freshly-ready webview', () => {
        const { p, posted } = presenter();
        p.setThinking(true);
        posted.length = 0;

        p.replayThinking();

        expect(posted).toEqual([{ type: ExtensionMsg.SetProactiveThinking, thinking: true }]);
    });

    it('replays nothing once the request has settled', () => {
        const { p, posted } = presenter();
        p.setThinking(true);
        p.setThinking(false);
        posted.length = 0;

        p.replayThinking();

        expect(posted).toEqual([]);
    });

    it('replays nothing when no request was ever made', () => {
        const { p, posted } = presenter();
        p.replayThinking();
        expect(posted).toEqual([]);
    });

    it('is safe to replay repeatedly: a re-resolve does not double-count anything', () => {
        const { p, posted } = presenter();
        p.setThinking(true);
        posted.length = 0;

        p.replayThinking();
        p.replayThinking();

        expect(posted).toHaveLength(2);
        expect(posted.every(m => m.type === ExtensionMsg.SetProactiveThinking)).toBe(true);
    });
});
