// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReplyKind =
    | { kind: 'button'; button: 'solved' | 'still-on-it' | 'something-else'; askId: string }
    | { kind: 'free-text'; text: string };

export type ReplyEffect =
    | { kind: 'confirm-close' }         // 'solved'
    | { kind: 'stay' }                  // 'still-on-it'
    | { kind: 'free-silent' }           // 'something-else' (ABANDONED)
    | { kind: 'reset-abandon-timer' }   // free-text while an ask is open
    | { kind: 'none' };                 // free-text with no open ask / stale button click

// ---------------------------------------------------------------------------
// Pure routing function
// ---------------------------------------------------------------------------

/**
 * Decide the slot side-effect of a student reply.
 *
 * Buttons resolve the slot ONLY when reply.askId matches liveAskId.
 * A late click on a superseded or absent ask returns 'none'.
 *
 * Free-text never resolves the slot. When an ask is currently open it
 * resets the abandon timer; with no ask open it is a no-op for the slot.
 * (The caller always forwards free-text to the normal chat regardless.)
 */
export function routeReply(
    reply: ReplyKind,
    askOpen: boolean,
    liveAskId: string | null,
): ReplyEffect {
    if (reply.kind === 'free-text') {
        return routeFreeText(askOpen);
    }
    return routeButton(reply.button, reply.askId, liveAskId);
}

// ---------------------------------------------------------------------------
// Per-kind helpers
// ---------------------------------------------------------------------------

function routeFreeText(askOpen: boolean): ReplyEffect {
    return askOpen ? { kind: 'reset-abandon-timer' } : { kind: 'none' };
}

function routeButton(
    btn: 'solved' | 'still-on-it' | 'something-else',
    replyAskId: string,
    liveAskId: string | null,
): ReplyEffect {
    if (replyAskId !== liveAskId) {
        return { kind: 'none' };
    }
    switch (btn) {
        case 'solved':
            return { kind: 'confirm-close' };
        case 'still-on-it':
            return { kind: 'stay' };
        case 'something-else':
            return { kind: 'free-silent' };
    }
}
