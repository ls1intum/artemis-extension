import { useEffect } from 'react';

import { useAutoScroll } from '@webview/hooks/useAutoScroll';
import type { ChatMessage, IrisStageDTO, StreamingState } from '@webview/views/IrisChat/types';

import styles from './ChatMessageList.module.css';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { WelcomeState } from './WelcomeState';

interface ChatMessageListProps {
    messages: ChatMessage[];
    streaming: StreamingState;
    activeStage: IrisStageDTO | null;
    onFeedback: (messageId: number, feedback: 'positive' | 'negative') => void;
    onSendPrompt: (text: string) => void;
    hasContext: boolean;
    isChatDisabled?: boolean;
    /** Invoked when a failed user message's Retry button is clicked. */
    onRetry?: (localId: string) => void;
    /**
     * Predicate that decides whether the Retry button should be active for
     * a given failed message. Kept as a function (rather than a Map) so
     * the parent can derive it from live store state without rebuilding
     * the map on every render.
     */
    isRetryDisabled?: (message: ChatMessage) => boolean;
    /** Invoked when the student dismisses a proactive bubble (collapses it; never deletes). */
    onDismiss?: (messageId: number) => void;
}

export function ChatMessageList({
    messages,
    streaming,
    activeStage,
    onFeedback,
    onSendPrompt,
    hasContext,
    isChatDisabled,
    onRetry,
    isRetryDisabled,
    onDismiss,
}: ChatMessageListProps) {
    const { scrollRef, contentRef, scrollOnSend } = useAutoScroll();

    // Auto-scroll when new messages arrive
    useEffect(() => {
        scrollOnSend();
    }, [messages.length, scrollOnSend]);

    // Show welcome state when no messages
    const showWelcome = messages.length === 0;

    // Stage indicator (real Iris pipeline stages) takes priority; the
    // legacy thinking-dots fall back when streaming flag is set but no
    // stages have been published yet.
    const showStageIndicator = activeStage !== null;
    const showLegacyThinking = !showStageIndicator && streaming.isStreaming;
    const showThinking = showStageIndicator || showLegacyThinking;

    return (
        <div ref={scrollRef} className={styles.scrollContainer}>
            <div ref={contentRef} className={styles.content}>
                {showWelcome ? (
                    <WelcomeState onSendPrompt={onSendPrompt} hasContext={hasContext} isChatDisabled={isChatDisabled} />
                ) : (
                    <>
                        {messages.map((message) => (
                            <MessageBubble
                                key={message.localId}
                                message={message}
                                onFeedback={onFeedback}
                                onRetry={onRetry}
                                onDismiss={onDismiss}
                                retryDisabled={
                                    isRetryDisabled ? isRetryDisabled(message) : false
                                }
                            />
                        ))}

                        {/* Show thinking indicator while waiting for the assistant
                            response (cleared by resetTransientChatUi once
                            AddMessage arrives). */}
                        {showThinking && (
                            <ThinkingIndicator
                                isVisible={true}
                                activeStage={showStageIndicator ? activeStage : null}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
