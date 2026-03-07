import { memo, useState, useMemo } from 'react';
// @ts-expect-error - streamdown is ESM but TypeScript Node16 resolution complains (TS1479). esbuild handles at bundle time.
import { Streamdown } from 'streamdown';
import clsx from 'clsx';
import { StreamingMessage } from './StreamingMessage';
import { CodeBlock } from './CodeBlock';
import type { ChatMessage } from '../types';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
    message: ChatMessage;
    isStreaming: boolean;
    streamingChunks: string[];
    onFeedback: (messageId: string, feedback: 'positive' | 'negative') => void;
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

    // Compute relative timestamp
    const relativeTime = useMemo(() => {
        const now = Date.now();
        const diff = now - message.timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) {return 'just now';}
        if (minutes < 60) {return `${minutes} min ago`;}
        if (hours < 24) {return `${hours}h ago`;}
        return `${days}d ago`;
    }, [message.timestamp]);

    const handleFeedback = (feedback: 'positive' | 'negative') => {
        if (message.id !== undefined) {
            onFeedback(String(message.id), feedback);
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
            {isAssistant && (
                <div className={styles.avatar}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="2"
                        />
                        <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                        <circle cx="15" cy="10" r="1.5" fill="currentColor" />
                        <path
                            d="M8 15c0 2 1.5 3 4 3s4-1 4-3"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>
            )}

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
                            components={{
                                code: ({ node, className, children, ...props }: { node?: unknown; className?: string; children?: React.ReactNode; [key: string]: unknown }) => {
                                    const match = /language-(\w+)/.exec(className || '');
                                    const language = match ? match[1] : undefined;

                                    if (language || className?.includes('language-')) {
                                        return (
                                            <CodeBlock language={language}>
                                                {String(children).replace(/\n$/, '')}
                                            </CodeBlock>
                                        );
                                    }

                                    return (
                                        <code className={className} {...props}>
                                            {children}
                                        </code>
                                    );
                                },
                            }}
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
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M7 22V11M2 13v6a2 2 0 002 2h2.5M2 13l6.6-7.6c.5-.5 1.2-.7 1.9-.7.6 0 1.3.2 1.8.6.5.3.8.8 1 1.4l1.4 4.3h5.7c1.1 0 2 .9 2 2v2c0 .4-.1.7-.3 1l-3.3 6c-.2.5-.7.7-1.2.7H7"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill={message.helpful === true ? 'currentColor' : 'none'}
                                />
                            </svg>
                        </button>
                        <button
                            className={clsx(styles.feedbackButton, {
                                [styles.selected]: message.helpful === false,
                            })}
                            onClick={() => handleFeedback('negative')}
                            aria-label="Not helpful"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M17 2v11m5-2v-6a2 2 0 00-2-2h-2.5M22 11l-6.6 7.6c-.5.5-1.2.7-1.9.7-.6 0-1.3-.2-1.8-.6-.5-.3-.8-.8-1-1.4L9.3 13H3.6c-1.1 0-2-.9-2-2V9c0-.4.1-.7.3-1l3.3-6c.2-.5.7-.7 1.2-.7H17"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill={message.helpful === false ? 'currentColor' : 'none'}
                                />
                            </svg>
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
