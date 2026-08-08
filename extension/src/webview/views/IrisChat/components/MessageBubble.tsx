import clsx from 'clsx';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import { memo, useMemo } from 'react';
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
}

function MessageBubbleComponent({
    message,
    onFeedback,
    onRetry,
    retryDisabled,
    isDraft,
}: MessageBubbleProps) {
    const isAssistant = message.role === 'assistant';
    const isUser = message.role === 'user';
    const streamdownComponents = useStreamdownConfig();

    // Compute relative timestamp
    const relativeTime = useMemo(() => formatRelativeTime(message.timestamp), [message.timestamp]);

    const handleFeedback = (feedback: 'positive' | 'negative') => {
        if (message.id !== undefined) {
            onFeedback?.(message.id, feedback);
        }
    };

    const hasFeedback = message.helpful !== undefined && message.helpful !== null;
    const isFailed = message.status === 'error';
    const hasTrail = isAssistant && !!message.activities && message.activities.length > 0;
    // A draft, and any intermediate (`final === false`) message, cannot be
    // rated: the run is still in flight so there is nothing final to judge.
    const showFeedback = isAssistant && !isFailed && !isDraft && message.final !== false;

    return (
        <div
            data-testid="message-row"
            className={clsx(styles.messageWrapper, {
                [styles.user]: isUser,
                [styles.assistant]: isAssistant,
            })}
        >
            <div className={styles.bubbleColumn}>
                <div
                    className={clsx(styles.bubble, {
                        [styles.userBubble]: isUser,
                        [styles.assistantBubble]: isAssistant,
                        [styles.error]: isFailed,
                    })}
                >
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

                    {/* Always render the original message content. The error
                        footer below augments it instead of replacing it, so the
                        user can see what they tried to send. */}
                    <div className={styles.content}>
                        <Streamdown
                            mode={isDraft ? 'streaming' : 'static'}
                            parseIncompleteMarkdown={isDraft}
                            components={streamdownComponents}
                        >
                            {message.content}
                        </Streamdown>
                    </div>

                    {showFeedback && (
                        <div
                            className={clsx(styles.feedbackContainer, {
                                [styles.visible]: hasFeedback,
                            })}
                        >
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

                {isFailed && (
                    <div className={styles.errorFooter} role="alert">
                        <span className={styles.errorBadge}>
                            <AlertTriangle size={12} aria-hidden="true" />
                            <span>Not sent</span>
                        </span>
                        <span className={styles.errorText}>
                            {message.errorMessage || 'Failed to send message'}
                        </span>
                        {onRetry && (
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
            </div>

            <span className={styles.timestamp} data-testid="message-timestamp">
                {relativeTime}
            </span>
        </div>
    );
}

// Custom comparator for React.memo. We include `errorReason` because it
// drives `retryDisabled` derivations one layer up; if it changes, the
// parent's recomputed `retryDisabled` will already differ and trigger a
// re-render via that prop — but keeping it here makes the equality check
// honest about which fields actually matter to this component.
const areEqual = (prev: MessageBubbleProps, next: MessageBubbleProps) => {
    return (
        prev.message.localId === next.message.localId &&
        prev.message.content === next.message.content &&
        prev.message.helpful === next.message.helpful &&
        prev.message.status === next.message.status &&
        prev.message.errorMessage === next.message.errorMessage &&
        prev.message.errorReason === next.message.errorReason &&
        prev.message.final === next.message.final &&
        prev.message.activities === next.message.activities &&
        prev.isDraft === next.isDraft &&
        prev.retryDisabled === next.retryDisabled &&
        prev.onRetry === next.onRetry &&
        prev.onFeedback === next.onFeedback
    );
};

export const MessageBubble = memo(MessageBubbleComponent, areEqual);
