import { useEffect } from 'react';

import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import { useAutoScroll } from '@webview/hooks/useAutoScroll';
import type { ChatMessage, StreamingState } from '@webview/views/IrisChat/types';

import { ActivityFeed } from './ActivityFeed';
import styles from './ChatMessageList.module.css';
import { ContextSwapRow } from './ContextSwapRow';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { WelcomeState } from './WelcomeState';

interface ChatMessageListProps {
    messages: ChatMessage[];
    streaming: StreamingState;
    /** Live tool/command activity for the in-flight run. */
    activities: IrisActivityDTO[];
    /** The streaming answer draft, or null when none is in flight. */
    liveDraft: { runId: string; text: string } | null;
    /** Current run lifecycle state (drives the FAILED error branch). */
    runState: IrisRunState | null;
    /** Error payload for a FAILED run. */
    runError: { message?: string } | null;
    onFeedback: (messageId: number, feedback: 'positive' | 'negative') => void;
    onSendPrompt: (text: string) => void;
    hasContext: boolean;
    isChatDisabled?: boolean;
    /**
     * The conversation's topic, accepted but deliberately not rendered here.
     * An earlier draft ended the transcript with a dashed preview line while
     * something was staged; it was cut, so the composer chip alone carries
     * `pending ?? committed` and the transcript carries only the markers the
     * server actually stored. Kept on the contract because the transcript is
     * where a future preview would have to live, and callers already pass it.
     */
    committedContext?: unknown;
    pendingContext?: unknown;
    /** Invoked when a failed user message's Retry button is clicked. */
    onRetry?: (localId: string) => void;
    /**
     * Predicate that decides whether the Retry button should be active for
     * a given failed message. Kept as a function (rather than a Map) so
     * the parent can derive it from live store state without rebuilding
     * the map on every render.
     */
    isRetryDisabled?: (message: ChatMessage) => boolean;
}

export function ChatMessageList({
    messages,
    streaming,
    activities,
    liveDraft,
    runState,
    runError,
    onFeedback,
    onSendPrompt,
    hasContext,
    isChatDisabled,
    onRetry,
    isRetryDisabled,
}: ChatMessageListProps) {
    const { scrollRef, contentRef, scrollOnSend } = useAutoScroll();

    // Auto-scroll when new messages arrive
    useEffect(() => {
        scrollOnSend();
    }, [messages.length, scrollOnSend]);

    // An in-flight (or just-failed) run has its own surfaces to show even
    // before the first message lands, so it suppresses the welcome state.
    const hasRunSurface =
        streaming.isStreaming || activities.length > 0 || !!liveDraft || runState === 'FAILED';
    const showWelcome = messages.length === 0 && !hasRunSurface;

    // The thinking indicator is the "nothing to show yet" placeholder: once the
    // run has produced activities or a draft, those richer surfaces replace it.
    const showThinking = streaming.isStreaming && activities.length === 0 && !liveDraft;

    return (
        <div ref={scrollRef} className={styles.scrollContainer}>
            <div ref={contentRef} className={styles.content}>
                {showWelcome ? (
                    <WelcomeState onSendPrompt={onSendPrompt} hasContext={hasContext} isChatDisabled={isChatDisabled} />
                ) : (
                    <>
                        {/* Marker rows render in transcript order, so a stored
                            topic change appears before the message it
                            triggered, matching the server's write order. */}
                        {messages.map((message) => (
                            message.role === 'contextSwap' ? (
                                <ContextSwapRow key={message.localId} text={message.content} />
                            ) : (
                                <MessageBubble
                                    key={message.localId}
                                    message={message}
                                    onFeedback={onFeedback}
                                    onRetry={onRetry}
                                    retryDisabled={
                                        isRetryDisabled ? isRetryDisabled(message) : false
                                    }
                                />
                            )
                        ))}

                        {/* Live run surfaces, in order: activity feed, the
                            streaming answer draft, then the thinking placeholder
                            (only while nothing richer exists yet). */}
                        <ActivityFeed activities={activities} mode="live" />

                        {liveDraft && (
                            <MessageBubble
                                isDraft
                                message={{
                                    localId: `draft-${liveDraft.runId}`,
                                    role: 'assistant',
                                    content: liveDraft.text,
                                    timestamp: Date.now(),
                                    status: 'sending',
                                }}
                            />
                        )}

                        <ThinkingIndicator
                            isVisible={showThinking}
                            runState={runState}
                            error={runError}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
