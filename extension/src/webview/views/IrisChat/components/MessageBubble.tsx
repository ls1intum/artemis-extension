import clsx from 'clsx';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import { memo, useMemo, useState } from 'react';
// @ts-expect-error - streamdown is ESM but TypeScript Node16 resolution complains (TS1479). esbuild handles at bundle time.
import { Streamdown } from 'streamdown';

import { useStreamdownConfig } from '@webview/hooks/useStreamdownConfig';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import { activityTrailSummary } from '@webview/views/IrisChat/activityLabels';
import type { ChatMessage } from '@webview/views/IrisChat/types';

import { ActivityFeed } from './ActivityFeed';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
    message: ChatMessage;
    /**
     * Optional: a draft (streaming) bubble has nothing to rate, so it renders
     * without feedback controls and needs no handler.
     */
    onFeedback?: (messageId: number, feedback: 'positive' | 'negative') => void;
    /** Invoked when the Retry button on a failed user message is clicked. */
    onRetry?: (localId: string) => void;
    /**
     * Disables the Retry button. Set when the underlying rejection cause
     * still holds (e.g. `.noai` still detected, no context still selected,
     * Iris still disabled for the exercise).
     */
    retryDisabled?: boolean;
    /**
     * Marks the live streaming draft. Streamdown renders in streaming mode
     * (incomplete-markdown tolerant) and feedback controls are suppressed.
     */
    isDraft?: boolean;
    /** Invoked when the student dismisses a proactive bubble (collapses it; never deletes, spec §6.3). */
    onDismiss?: (messageId: number, proactiveEpisodeId?: string) => void;
    /**
     * Invoked when the student answers a consented offer bubble (Moment-1 "stuck" / Moment-3
     * "abandon"): 'accept' opens the suggestion, 'decline' waits it out. Only a proactive bubble
     * carrying an unanswered `message.offer` renders the two buttons.
     */
    onOfferAnswer?: (offerId: string, episodeId: string | undefined, moment: 'stuck' | 'abandon', action: 'accept' | 'decline') => void;
    /**
     * True when this bubble is rendered inside an episode group (EpisodeBlock): suppresses the
     * per-message "Iris reached out" caption and the tinted card (the block owns both) and never
     * collapses a DISMISSED row (the episode-level fold is the only collapse).
     */
    grouped?: boolean;
}

function MessageBubbleComponent({
    message,
    onFeedback,
    onRetry,
    retryDisabled,
    isDraft,
    onDismiss,
    onOfferAnswer,
    grouped,
}: MessageBubbleProps) {
    const [expanded, setExpanded] = useState(false);
    const isAssistant = message.role === 'assistant';
    const isUser = message.role === 'user';
    const streamdownComponents = useStreamdownConfig();

    const relativeTime = useMemo(() => formatRelativeTime(message.timestamp), [message.timestamp]);

    const handleFeedback = (feedback: 'positive' | 'negative') => {
        if (message.id !== undefined) {
            onFeedback?.(message.id, feedback);
        }
    };

    const hasFeedback = message.helpful !== undefined && message.helpful !== null;
    const isFailed = message.status === 'error';
    const isProactive = isAssistant && message.origin === 'proactive';
    const isDismissed = isProactive && message.proactiveOutcome === 'DISMISSED';
    // Grouped rows never collapse individually (the episode-level fold is the only collapse).
    const collapsible = isDismissed && !grouped;
    const bodyVisible = !(collapsible && !expanded);
    const hasTrail = isAssistant && !!message.activities && message.activities.length > 0;
    // Feedback thumbs: assistant, not failed, not a draft/intermediate run, body visible,
    // and never on a proactive row (proactive replies carry no feedback per spec).
    const showFeedback = isAssistant && !isFailed && !isDraft && message.final !== false
        && bodyVisible && !isProactive;
    // A grouped (timeline) row never renders its own Dismiss (the EpisodeTimeline footer owns it). A
    // non-grouped proactive bubble (proactive without an episode) still shows its Dismiss.
    const showDismiss = isProactive && !grouped && !isDismissed
        && message.id !== undefined && !!onDismiss && bodyVisible && !isFailed;
    // A consented offer bubble (Moment-1 "stuck" / Moment-3 "abandon") renders its own accept/decline
    // buttons until answered. Same ownership split as Dismiss: a grouped (timeline) row never renders
    // its own buttons (the EpisodeTimeline footer owns the grouped case).
    // `!isFailed` mirrors showDismiss above: a send that never reached the server has no offer to
    // answer, and its floating bar would otherwise cover the error footer below the bubble (#368).
    const offer = message.offer;
    const showOfferButtons = isProactive && !grouped && !!offer && !offer.answered && !!onOfferAnswer && !isFailed;

    return (
        <div
            data-testid="message-row"
            className={clsx(styles.messageWrapper, {
                [styles.user]: isUser,
                [styles.assistant]: isAssistant,
                [styles.groupedWrapper]: isProactive && grouped,
                // Reserves room for the action bar that overhangs this card's bottom edge. Gated on
                // the same condition as the bar itself, so a card without one keeps the tight rhythm.
                [styles.proactiveWrapper]: showDismiss || showOfferButtons,
            })}
        >
            <div className={styles.bubbleColumn}>
                <div
                    className={clsx(styles.bubble, {
                        [styles.userBubble]: isUser,
                        [styles.assistantBubble]: isAssistant,
                        [styles.error]: isFailed,
                        [styles.proactiveBubble]: isProactive && !grouped,
                        [styles.groupedBubble]: isProactive && grouped,
                        [styles.proactiveDismissed]: collapsible,
                    })}
                    data-origin={isProactive ? 'proactive' : undefined}
                >
                    {isProactive && !grouped && (
                        <div className={styles.proactiveCaption}>
                            Iris reached out
                        </div>
                    )}

                    {/* Tool-activity trail, rendered above the answer for
                        finished assistant messages that carried activities. */}
                    {hasTrail && (
                        <details className={styles.trail} open>
                            <summary className={styles.trailSummary}>
                                {activityTrailSummary(message.activities!)}
                            </summary>
                            <ActivityFeed activities={message.activities!} mode="trail" />
                        </details>
                    )}

                    {/* A dismissed proactive bubble collapses (caption stays, body hidden behind a toggle);
                        every other message renders its content directly. The error footer below augments
                        the content instead of replacing it, so the user can see what they tried to send. */}
                    {collapsible && !expanded ? (
                        <button
                            type="button"
                            className={styles.dismissedToggle}
                            onClick={() => setExpanded(true)}
                        >
                            Show suggestion
                        </button>
                    ) : (
                        <>
                            <div className={styles.content}>
                                <Streamdown
                                    mode={isDraft ? 'streaming' : 'static'}
                                    parseIncompleteMarkdown={isDraft}
                                    components={streamdownComponents}
                                >
                                    {message.content}
                                </Streamdown>
                            </div>
                            {collapsible && expanded && (
                                <button
                                    type="button"
                                    className={styles.dismissedToggle}
                                    onClick={() => setExpanded(false)}
                                >
                                    Hide
                                </button>
                            )}
                        </>
                    )}

                    {(showDismiss || showOfferButtons) && (
                        <div className={clsx(styles.actionRow, { [styles.actionRowCard]: isProactive })}>
                            {/* Consented offer buttons on a non-grouped proactive bubble (a grouped/timeline row's
                                buttons live in the EpisodeTimeline footer instead). */}
                            {showOfferButtons && offer && (
                                <>
                                    <button
                                        type="button"
                                        className={styles.dismissButton}
                                        onClick={() => onOfferAnswer?.(offer.offerId, message.proactiveEpisodeId, offer.moment, 'decline')}
                                    >
                                        {offer.moment === 'abandon' ? "I'm still on it" : 'Not now'}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.dismissButton}
                                        onClick={() => onOfferAnswer?.(offer.offerId, message.proactiveEpisodeId, offer.moment, 'accept')}
                                    >
                                        {offer.moment === 'abandon' ? 'I need more help' : 'Show me'}
                                    </button>
                                </>
                            )}
                            {/* Dismiss on a non-grouped proactive bubble (a grouped/timeline row's Dismiss lives
                                in the EpisodeTimeline footer instead). */}
                            {showDismiss && (
                                <button
                                    type="button"
                                    className={styles.dismissButton}
                                    onClick={() => onDismiss?.(message.id as number, message.proactiveEpisodeId)}
                                    aria-label="Dismiss this suggestion"
                                >
                                    Dismiss
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {isFailed && (
                    <div className={styles.errorFooter} role="alert">
                        <span className={styles.errorBadge}>
                            <AlertTriangle size={12} aria-hidden="true" />
                            <span>Not sent</span>
                        </span>
                        <span className={styles.errorText}>
                            {message.errorMessage || 'Failed to send message'}
                        </span>
                        {/* Retry is meaningful only on non-proactive failed sends.
                            Proactive rows have no "retry the hint" affordance in
                            the slot model (spec §5/§7). */}
                        {!isProactive && onRetry && (
                            <button
                                type="button"
                                className={styles.retryButton}
                                onClick={() => onRetry(message.localId)}
                                disabled={retryDisabled}
                                aria-label="Retry sending this message"
                            >
                                Retry
                            </button>
                        )}
                    </div>
                )}

                {/* One footer row carries the feedback buttons and the timestamp, so the space for
                    both is reserved exactly once and hover only changes their colour, never the
                    layout. It sits OUTSIDE the bubble on purpose: .proactiveDismissed dims the
                    bubble with opacity, which would composite this row too and put the 11px
                    timestamp below any usable contrast. Suppressed inside an episode block, where
                    the timeline owns the per-row chrome. */}
                {!grouped && (
                    <div className={clsx(styles.footRow, { [styles.visible]: hasFeedback })}>
                        <span className={styles.timestamp} data-testid="message-timestamp">
                            {relativeTime}
                        </span>
                        {showFeedback && (
                            <div className={styles.feedbackContainer}>
                                <button
                                    className={clsx(styles.feedbackButton, {
                                        [styles.selected]: message.helpful === true,
                                    })}
                                    onClick={() => handleFeedback('positive')}
                                    aria-label="Helpful"
                                >
                                    <ThumbsUp
                                        size={16}
                                        fill={message.helpful === true ? 'currentColor' : 'none'}
                                    />
                                </button>
                                <button
                                    className={clsx(styles.feedbackButton, {
                                        [styles.selected]: message.helpful === false,
                                    })}
                                    onClick={() => handleFeedback('negative')}
                                    aria-label="Not helpful"
                                >
                                    <ThumbsDown
                                        size={16}
                                        fill={message.helpful === false ? 'currentColor' : 'none'}
                                    />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
}

// Custom comparator for React.memo. We include `errorReason` because it
// drives `retryDisabled` derivations one layer up; if it changes, the
// parent's recomputed `retryDisabled` will already differ and trigger a
// re-render via that prop, but keeping it here makes the equality check
// honest about which fields actually matter to this component.
const areEqual = (prev: MessageBubbleProps, next: MessageBubbleProps) => {
    return (
        prev.message.localId === next.message.localId &&
        prev.message.content === next.message.content &&
        prev.message.helpful === next.message.helpful &&
        prev.message.status === next.message.status &&
        prev.message.origin === next.message.origin &&
        prev.message.proactiveOutcome === next.message.proactiveOutcome &&
        prev.message.errorMessage === next.message.errorMessage &&
        prev.message.errorReason === next.message.errorReason &&
        prev.message.final === next.message.final &&
        prev.message.activities === next.message.activities &&
        prev.message.offer?.offerId === next.message.offer?.offerId &&
        prev.message.offer?.answered === next.message.offer?.answered &&
        prev.isDraft === next.isDraft &&
        prev.grouped === next.grouped &&
        prev.retryDisabled === next.retryDisabled &&
        prev.onRetry === next.onRetry &&
        prev.onDismiss === next.onDismiss &&
        prev.onOfferAnswer === next.onOfferAnswer &&
        prev.onFeedback === next.onFeedback
    );
};

export const MessageBubble = memo(MessageBubbleComponent, areEqual);
