import { useEffect } from 'react';

import { useAutoScroll } from '@webview/hooks/useAutoScroll';

import type { ChatMessage, IrisStageDTO, StreamingState } from '../types';
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
}

export function ChatMessageList({
    messages,
    streaming,
    activeStage,
    onFeedback,
    onSendPrompt,
    hasContext,
    isChatDisabled,
}: ChatMessageListProps) {
    const { scrollRef, contentRef, scrollOnSend } = useAutoScroll();

    // Auto-scroll when new messages or streaming chunks arrive
    useEffect(() => {
        scrollOnSend();
    }, [messages.length, streaming.visibleChunks.length, scrollOnSend]);

    // Show welcome state when no messages
    const showWelcome = messages.length === 0;

    // Stage indicator takes priority; both suppressed once streaming chunks arrive
    const hasChunks = streaming.visibleChunks.length > 0;
    const showStageIndicator = activeStage !== null && !hasChunks;
    const showLegacyThinking = !showStageIndicator
        && streaming.isStreaming
        && !hasChunks;
    const showThinking = showStageIndicator || showLegacyThinking;

    return (
        <div ref={scrollRef} className={styles.scrollContainer}>
            <div ref={contentRef} className={styles.content}>
                {showWelcome ? (
                    <WelcomeState onSendPrompt={onSendPrompt} hasContext={hasContext} isChatDisabled={isChatDisabled} />
                ) : (
                    <>
                        {messages.map((message) => {
                            // Check if this message is currently streaming
                            const isStreaming =
                                streaming.isStreaming &&
                                streaming.messageLocalId === message.localId;

                            return (
                                <MessageBubble
                                    key={message.localId}
                                    message={message}
                                    isStreaming={isStreaming}
                                    streamingChunks={
                                        isStreaming ? streaming.visibleChunks : []
                                    }
                                    onFeedback={onFeedback}
                                />
                            );
                        })}

                        {/* Show thinking indicator between user message and first chunk */}
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
