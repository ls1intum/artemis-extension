import clsx from 'clsx';
import type { ReactNode } from 'react';

import { useChatStore } from '@webview/stores/useChatStore';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { ChatMessage } from '@webview/views/IrisChat/types';

import styles from './EpisodeTimeline.module.css';

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
                const showOfferButtons = isLatest && !!offer && !offer.answered && !!onOfferAnswer;
                return (
                    <div key={m.localId} data-episode-row className={clsx(styles.row, isLatest && styles.rowLast, single && styles.rowSingle)}>
                        {!single && (
                            <div className={styles.rail} data-testid="timeline-rail">
                                <span className={clsx(styles.node, styles.nodeHint)} />
                            </div>
                        )}
                        <div className={styles.body}>
                            {renderRowBody(m, dismissable && isLatest)}
                            {/* Hover/focus chrome: per-message timestamp, plus Dismiss only on the latest live row.
                                Collapsed at rest; the row expands it open with a short animation (see CSS). */}
                            <div className={styles.foot}>
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
