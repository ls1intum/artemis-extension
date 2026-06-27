import clsx from 'clsx';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import { memo, useMemo, useState } from 'react';
// @ts-expect-error - streamdown is ESM but TypeScript Node16 resolution complains (TS1479). esbuild handles at bundle time.
import { Streamdown } from 'streamdown';

import { useStreamdownConfig } from '@webview/hooks/useStreamdownConfig';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { ChatMessage } from '@webview/views/IrisChat/types';

import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
    message: ChatMessage;
    onFeedback: (messageId: number, feedback: 'positive' | 'negative') => void;
    /** Invoked when the Retry button on a failed user message is clicked. */
    onRetry?: (localId: string) => void;
    /**
     * Disables the Retry button. Set when the underlying rejection cause
     * still holds (e.g. `.noai` still detected, no context still selected,
     * Iris still disabled for the exercise).
     */
    retryDisabled?: boolean;
    /** Invoked when the student dismisses a proactive bubble (collapses it; never deletes, spec §6.3). */
    onDismiss?: (messageId: number) => void;
}

function MessageBubbleComponent({
    message,
    onFeedback,
    onRetry,
    retryDisabled,
    onDismiss,
}: MessageBubbleProps) {
    const [hovering, setHovering] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const isAssistant = message.role === 'assistant';
    const isUser = message.role === 'user';
    const streamdownComponents = useStreamdownConfig();

    // Compute relative timestamp
    const relativeTime = useMemo(() => formatRelativeTime(message.timestamp), [message.timestamp]);

    const handleFeedback = (feedback: 'positive' | 'negative') => {
        if (message.id !== undefined) {
            onFeedback(message.id, feedback);
        }
    };

    const isFailed = message.status === 'error';
    const isProactive = isAssistant && message.origin === 'proactive';
    const isDismissed = isProactive && message.proactiveOutcome === 'DISMISSED';

    return (
        <div
            className={clsx(styles.messageWrapper, {
                [styles.user]: isUser,
                [styles.assistant]: isAssistant,
            })}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            <div className={styles.bubbleColumn}>
                <div
                    className={clsx(styles.bubble, {
                        [styles.userBubble]: isUser,
                        [styles.assistantBubble]: isAssistant,
                        [styles.error]: isFailed,
                        [styles.proactiveBubble]: isProactive,
                        [styles.proactiveDismissed]: isDismissed,
                    })}
                    data-origin={isProactive ? 'proactive' : undefined}
                >
                    {isProactive && (
                        <div className={styles.proactiveCaption}>
                            Iris thought this might help
                        </div>
                    )}
                    {/* A dismissed proactive bubble collapses (caption stays, body hidden behind a toggle);
                        every other message renders its content directly. The error footer below augments
                        the content instead of replacing it, so the user can see what they tried to send. */}
                    {isDismissed && !expanded ? (
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
                                    mode="static"
                                    components={streamdownComponents}
                                >
                                    {message.content}
                                </Streamdown>
                            </div>
                            {isDismissed && expanded && (
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

                    {isAssistant && !isFailed && !(isDismissed && !expanded) && (
                        <div className={clsx(styles.actionRow, { [styles.actionRowCard]: isProactive })}>
                            {/* Hover-revealed floating bar: absolutely positioned so it reserves no
                                space in the resting state (no empty gap) and overhangs the bubble's
                                bottom edge on hover. Thumbs on the left. */}
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
                            {/* Dismiss sits to the right of the thumbs in the same bar. */}
                            {isProactive && !isDismissed && message.id !== undefined && onDismiss && (
                                <button
                                    type="button"
                                    className={styles.dismissButton}
                                    onClick={() => onDismiss(message.id as number)}
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

            {hovering && (
                <span className={styles.timestamp}>{relativeTime}</span>
            )}
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
        prev.message.origin === next.message.origin &&
        prev.message.proactiveOutcome === next.message.proactiveOutcome &&
        prev.message.errorMessage === next.message.errorMessage &&
        prev.message.errorReason === next.message.errorReason &&
        prev.retryDisabled === next.retryDisabled &&
        prev.onRetry === next.onRetry &&
        prev.onDismiss === next.onDismiss &&
        prev.onFeedback === next.onFeedback
    );
};

export const MessageBubble = memo(MessageBubbleComponent, areEqual);
