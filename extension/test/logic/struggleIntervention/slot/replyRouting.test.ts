import { describe, expect, it } from 'vitest';

import type { ReplyKind } from '@extension/services/struggleIntervention/slot/replyRouting';
import { routeReply } from '@extension/services/struggleIntervention/slot/replyRouting';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LIVE_ASK_ID = 'ask-1';
const STALE_ASK_ID = 'ask-0';

const button = (
    btn: 'solved' | 'still-on-it' | 'something-else',
    askId = LIVE_ASK_ID,
): ReplyKind => ({ kind: 'button', button: btn, askId });

const freeText = (text = 'hello'): ReplyKind => ({ kind: 'free-text', text });

// ---------------------------------------------------------------------------
// §7.3 / §16 routing matrix
// ---------------------------------------------------------------------------

describe('routeReply', () => {
    // -----------------------------------------------------------------------
    // Button replies with matching askId
    // -----------------------------------------------------------------------

    it('solved + matching askId -> confirm-close', () => {
        expect(routeReply(button('solved'), true, LIVE_ASK_ID)).toEqual({ kind: 'confirm-close' });
    });

    it('still-on-it + matching askId -> stay', () => {
        expect(routeReply(button('still-on-it'), true, LIVE_ASK_ID)).toEqual({ kind: 'stay' });
    });

    it('something-else + matching askId -> free-silent (ABANDONED)', () => {
        expect(routeReply(button('something-else'), true, LIVE_ASK_ID)).toEqual({ kind: 'free-silent' });
    });

    // -----------------------------------------------------------------------
    // Button replies with stale / absent askId
    // -----------------------------------------------------------------------

    it('solved + stale askId -> none', () => {
        expect(routeReply(button('solved', STALE_ASK_ID), true, LIVE_ASK_ID)).toEqual({ kind: 'none' });
    });

    it('button + no active ask (liveAskId null) -> none', () => {
        expect(routeReply(button('solved'), false, null)).toEqual({ kind: 'none' });
    });

    // -----------------------------------------------------------------------
    // Free-text replies
    // -----------------------------------------------------------------------

    it('free-text + ask open -> reset-abandon-timer', () => {
        expect(routeReply(freeText(), true, LIVE_ASK_ID)).toEqual({ kind: 'reset-abandon-timer' });
    });

    it('free-text + no ask open -> none', () => {
        expect(routeReply(freeText(), false, null)).toEqual({ kind: 'none' });
    });
});
