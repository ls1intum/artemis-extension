import { memo, useState, useMemo } from 'react';
// @ts-expect-error - streamdown is ESM but TypeScript Node16 resolution complains (TS1479). esbuild handles at bundle time.
import { Streamdown } from 'streamdown';
import clsx from 'clsx';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import { StreamingMessage } from './StreamingMessage';
import { useStreamdownConfig } from '../../../hooks/useStreamdownConfig';
import { formatRelativeTime } from '../../../utils/formatRelativeTime';
import type { ChatMessage } from '../types';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
    message: ChatMessage;
    isStreaming: boolean;
    streamingChunks: string[];
    onFeedback: (messageId: number, feedback: 'positive' | 'negative') => void;
}

function MessageBubbleComponent({
    message,
    isStreaming,
    streamingChunks,
    onFeedback,
}: MessageBubbleProps) {
    const [hovering, setHovering] = useState(false);
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

    const hasFeedback = message.helpful !== undefined && message.helpful !== null;

    return (
        <div
            className={clsx(styles.messageWrapper, {
                [styles.user]: isUser,
                [styles.assistant]: isAssistant,
            })}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            <div
                className={clsx(styles.bubble, {
                    [styles.userBubble]: isUser,
                    [styles.assistantBubble]: isAssistant,
                    [styles.error]: message.status === 'error',
                })}
            >
                {message.status === 'error' ? (
                    <div className={styles.errorContent}>
                        <p className={styles.errorMessage}>
                            {message.errorMessage || 'Failed to send message'}
                        </p>
                        <button
                            className={styles.retryButton}
                            onClick={() => {
                                // Retry logic would be handled by parent
                            }}
                        >
                            Retry
                        </button>
                    </div>
                ) : isStreaming ? (
                    <StreamingMessage chunks={streamingChunks} />
                ) : (
                    <div className={styles.content}>
                        <Streamdown
                            mode="static"
                            components={streamdownComponents}
                        >
                            {message.content}
                        </Streamdown>
                    </div>
                )}

                {isAssistant && (
                    <div
                        className={clsx(styles.feedbackContainer, {
                            [styles.visible]: hovering || hasFeedback,
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

            {hovering && (
                <span className={styles.timestamp}>{relativeTime}</span>
            )}
        </div>
    );
}

// Custom comparator for React.memo
const areEqual = (prev: MessageBubbleProps, next: MessageBubbleProps) => {
    return (
        prev.message.localId === next.message.localId &&
        prev.message.content === next.message.content &&
        prev.message.helpful === next.message.helpful &&
        prev.message.status === next.message.status &&
        prev.isStreaming === next.isStreaming &&
        prev.streamingChunks?.length === next.streamingChunks?.length
    );
};

export const MessageBubble = memo(MessageBubbleComponent, areEqual);
