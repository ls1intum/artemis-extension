import type { ChatMessage } from '@webview/views/IrisChat/types';

export type NodeKind = 'hint' | 'checkin';
export type CheckinState = 'pending' | 'solved' | 'still-working' | 'ignored';
export type StaleAnswer = 'solved' | 'still-on-it' | 'something-else';

/** Fold state for one episode as tracked in the chat store. */
export interface EpisodeFoldInfo {
    folded: boolean;
    outcome?: 'RECOVERED' | 'DISMISSED' | 'ABANDONED';
}

/**
 * An episode is OPEN only while it has no terminal fold state yet: it is live, not folded, and its
 * fold state carries no terminal `outcome`. A terminal outcome (even during the order-B grace window
 * where `folded` is still false and the close row has not landed) counts as NOT open. This keeps an
 * unanswered latest check-in from sticking on `pending` forever.
 */
export function episodeIsOpen(_episodeId: string, live: boolean, fold: EpisodeFoldInfo | undefined): boolean {
    if (!live) { return false; }
    if (fold?.folded) { return false; }
    if (fold?.outcome !== undefined) { return false; }
    return true;
}

/** A proactive row is a stale-check if a live ask-binding is attached, or if reload tagged it. */
export function isStaleCheck(message: ChatMessage, hasLiveBinding: boolean): boolean {
    return hasLiveBinding || message.proactiveKind === 'stale-check';
}

/**
 * Row-local resolution (NOT derived from episode-level proactiveOutcome, which lives on the canonical
 * row and cannot disambiguate multiple check-ins). Answer comes from the reloaded `staleAnswer` first,
 * then the live runtime answer.
 */
export function checkinState(args: {
    message: ChatMessage;
    liveAnswer?: StaleAnswer;
    isLatestInEpisode: boolean;
    episodeOpen: boolean;
}): CheckinState {
    const answer = args.message.staleAnswer ?? args.liveAnswer;
    if (answer === 'solved') { return 'solved'; }
    if (answer === 'still-on-it' || answer === 'something-else') { return 'still-working'; }
    if (args.isLatestInEpisode && args.episodeOpen) { return 'pending'; }
    return 'ignored';
}
