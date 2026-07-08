import clsx from 'clsx';
import type { ReactNode } from 'react';

import { useChatStore } from '@webview/stores/useChatStore';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { ChatMessage } from '@webview/views/IrisChat/types';

import styles from './EpisodeTimeline.module.css';

/**
 * Condensed grey line an answered offer collapses to, once the buttons are gone (spec B+/C10).
 * Static lookup only (never dynamic string concatenation) so every combination stays reviewable
 * and typo-proof.
 */
const OFFER_DECISION_LINE: Record<'stuck' | 'abandon', Record<'accept' | 'decline' | 'timeout', string>> = {
    stuck: {
        accept: 'Offered another hint · You: Show me',
        decline: 'Offered another hint · You: Not now',
        timeout: 'Offered another hint · no response',
    },
    abandon: {
        accept: 'Checked in · You: I need more help',
        decline: "Checked in · You: I'm still on it",
        timeout: 'Offered a hand · no response',
    },
};

/**
 * The offer's invitation copy, shown in place of a hint body until the student answers. Static
 * lookup (mirrors {@link OFFER_DECISION_LINE}) so the wording stays reviewable and typo-proof.
 * Without it the offer bubble is posted with empty content and reads as a blank row.
 */
const OFFER_PROMPT: Record<'stuck' | 'abandon', string> = {
    stuck: 'Still stuck on this? I can offer another hint.',
    abandon: 'Still working on this? Want a hand?',
};

interface EpisodeTimelineProps {
    messages: ChatMessage[];
    episodeId: string;
    /** True only for a live episode: gates the Dismiss action to the latest row. */
    dismissable: boolean;
    /** Dismiss the episode (only offered on the latest row of a live episode). */
    onDismiss?: (messageId: number, proactiveEpisodeId?: string) => void;
    /** Invoked when the student answers a consented offer bubble on the latest row of a live episode. */
    onOfferAnswer?: (offerId: string, episodeId: string | undefined, moment: 'stuck' | 'abandon', action: 'accept' | 'decline') => void;
    renderRowBody: (m: ChatMessage, isLatest: boolean) => ReactNode;
}

/**
 * Open episode rendered as a vertical timeline inside a tinted card: one "Iris reached out" caption
 * plus one hint node per message. The row body (the bubble) is supplied by the caller so this
 * component stays presentational.
 */
export function EpisodeTimeline({ messages, episodeId, dismissable, onDismiss, onOfferAnswer, renderRowBody }: EpisodeTimelineProps) {
    const foldStates = useChatStore((s) => s.foldStates);
    const fold = foldStates.get(episodeId);
    const latest = messages[messages.length - 1];
    // One hint is not a timeline: drop the rail/node column entirely until a follow-up arrives.
    const single = messages.length === 1;

    return (
        <div className={styles.timeline}>
            <div className={styles.caption}>Iris reached out</div>
            {messages.map((m) => {
                const isLatest = m === latest;
                // Dismiss shows only on the latest live row, and never on the close/praise row or an
                // already-dismissed row.
                const isClosingRow = m.id !== undefined && fold?.closeMessageId === m.id;
                const showDismiss = dismissable && isLatest && m.id !== undefined && !!onDismiss
                    && !isClosingRow && m.proactiveOutcome !== 'DISMISSED';
                // Consented offer buttons on the latest row only (mirrors the Dismiss ownership above).
                const offer = m.offer;
                const showOfferButtons = dismissable && isLatest && !!offer && !offer.answered && !!onOfferAnswer;
                return (
                    <div key={m.localId} data-episode-row className={clsx(styles.row, isLatest && styles.rowLast, single && styles.rowSingle)}>
                        {!single && (
                            <div className={styles.rail} data-testid="timeline-rail">
                                <span className={clsx(styles.node, styles.nodeHint)} />
                            </div>
                        )}
                        <div className={styles.body}>
                            {offer?.answered ? (
                                <div className={styles.decisionRow}>{OFFER_DECISION_LINE[offer.moment][offer.answered]}</div>
                            ) : offer ? (
                                <div className={styles.offerPrompt}>{OFFER_PROMPT[offer.moment]}</div>
                            ) : (
                                renderRowBody(m, dismissable && isLatest)
                            )}
                            {/* Hover/focus chrome: per-message timestamp, plus Dismiss only on the latest live row.
                                Collapsed at rest; the row expands it open with a short animation (see CSS). */}
                            <div
                                className={clsx(styles.foot, (showOfferButtons || showDismiss) && styles.footPersistent)}
                                data-testid="row-foot"
                            >
                                <span className={styles.time} data-testid="row-time">{formatRelativeTime(m.timestamp)}</span>
                                {showOfferButtons && offer && (
                                    <>
                                        <button
                                            type="button"
                                            className={styles.dismiss}
                                            onClick={() => onOfferAnswer?.(offer.offerId, m.proactiveEpisodeId, offer.moment, 'decline')}
                                        >
                                            {offer.moment === 'abandon' ? "I'm still on it" : 'Not now'}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.dismiss}
                                            onClick={() => onOfferAnswer?.(offer.offerId, m.proactiveEpisodeId, offer.moment, 'accept')}
                                        >
                                            {offer.moment === 'abandon' ? 'I need more help' : 'Show me'}
                                        </button>
                                    </>
                                )}
                                {showDismiss && (
                                    <button
                                        type="button"
                                        className={styles.dismiss}
                                        aria-label="Dismiss this suggestion"
                                        onClick={() => onDismiss?.(m.id as number, m.proactiveEpisodeId)}
                                    >
                                        Dismiss
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
