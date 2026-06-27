import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { useAutoScroll } from '@webview/hooks/useAutoScroll';
import type { ChatMessage, IrisStageDTO, StreamingState } from '@webview/views/IrisChat/types';

import styles from './ChatMessageList.module.css';
import { groupProactiveMessages } from './groupProactiveMessages';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { WelcomeState } from './WelcomeState';

/**
 * Renders a collapsed run of consecutive proactive Iris messages: the latest
 * suggestion shows in full, the earlier repeats hide behind a toggle so the
 * chat is not flooded when Iris re-alerts about the same situation.
 */
function ProactiveRunGroup({
    earlier,
    latest,
    renderBubble,
}: {
    earlier: ChatMessage[];
    latest: ChatMessage;
    renderBubble: (message: ChatMessage) => ReactNode;
}) {
    const [expanded, setExpanded] = useState(false);
    const count = earlier.length;

    return (
        <div className={styles.proactiveRun}>
            <button
                type="button"
                className={styles.runToggle}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
            >
                {expanded ? (
                    <ChevronDown size={12} className={styles.runToggleIcon} aria-hidden="true" />
                ) : (
                    <ChevronRight size={12} className={styles.runToggleIcon} aria-hidden="true" />
                )}
                {expanded
                    ? 'Hide earlier suggestions'
                    : `Show ${count} earlier suggestion${count === 1 ? '' : 's'}`}
            </button>
            {expanded && earlier.map(renderBubble)}
            {renderBubble(latest)}
        </div>
    );
}

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

    // Collapse runs of consecutive proactive messages into one card so repeated
    // re-alerts about the same situation do not clutter the chat (display only).
    const renderItems = useMemo(() => groupProactiveMessages(messages), [messages]);

    const renderBubble = (message: ChatMessage): ReactNode => (
        <MessageBubble
            key={message.localId}
            message={message}
            onFeedback={onFeedback}
            onRetry={onRetry}
            onDismiss={onDismiss}
            retryDisabled={isRetryDisabled ? isRetryDisabled(message) : false}
        />
    );

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
                        {renderItems.map((item) =>
                            item.kind === 'single' ? (
                                renderBubble(item.message)
                            ) : (
                                <ProactiveRunGroup
                                    key={item.latest.localId}
                                    earlier={item.earlier}
                                    latest={item.latest}
                                    renderBubble={renderBubble}
                                />
                            ),
                        )}

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
