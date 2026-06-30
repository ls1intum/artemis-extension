import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { useAutoScroll } from '@webview/hooks/useAutoScroll';
import { useChatStore } from '@webview/stores/useChatStore';
import type { ChatMessage, IrisStageDTO, StreamingState } from '@webview/views/IrisChat/types';

import styles from './ChatMessageList.module.css';
import { groupByEpisode } from './groupProactiveMessages';
import { MessageBubble } from './MessageBubble';
import { StaleAskButtons } from './StaleAskButtons';
import { ThinkingIndicator } from './ThinkingIndicator';
import { WelcomeState } from './WelcomeState';

/** Truncate message content to at most 40 chars for use as a fold-line label. */
function deriveEpisodeLabel(content: string): string {
    const t = content.trim().slice(0, 40);
    return t.length > 0 ? t : 'Proactive hint';
}

/**
 * Renders a group of proactive Iris messages (either a consecutive run or an
 * episode keyed by `proactiveEpisodeId`): the latest suggestion shows in full,
 * the earlier ones hide behind a toggle so repeated re-alerts do not clutter
 * the chat. Used for both `{kind:'proactive-run'}` and `{kind:'episode'}` items.
 */
function ProactiveRunGroup({
    earlier,
    latest,
    renderBubble,
}: {
    earlier: ChatMessage[];
    latest: ChatMessage;
    renderBubble: (message: ChatMessage, isLatest: boolean) => ReactNode;
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
            {expanded && earlier.map((m) => renderBubble(m, false))}
            {renderBubble(latest, true)}
        </div>
    );
}

/**
 * Collapsible fold-line for a folded episode (C7). Shows a chevron toggle and
 * the episode summary label; expands to reveal the episode's messages.
 */
function EpisodeFoldLine({
    label,
    isPraise,
    messages,
    renderBubble,
}: {
    label: string;
    isPraise: boolean;
    messages: ChatMessage[];
    renderBubble: (message: ChatMessage, isLatest: boolean) => ReactNode;
}) {
    const [expanded, setExpanded] = useState(false);
    const displayLabel = isPraise ? `✓ ${label}` : label;
    return (
        <div className={styles.episodeFold}>
            <button type="button" className={styles.episodeFoldLine} onClick={() => setExpanded((v) => !v)}>
                {expanded
                    ? <ChevronDown size={12} aria-hidden="true" />
                    : <ChevronRight size={12} aria-hidden="true" />}
                {displayLabel}
            </button>
            {expanded && messages.map((m) => renderBubble(m, false))}
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
    /**
     * Invoked when the student clicks one of the three stale-ask quick-reply
     * buttons on a row that has a live `askId` binding (C6).
     */
    onStaleAskButton?: (askId: string, button: 'solved' | 'still-on-it' | 'something-else') => void;
}

/** Delay (ms) between the close row arriving and the episode folding (C7). */
const FOLD_DELAY_MS = 5000;

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
    onStaleAskButton,
}: ChatMessageListProps) {
    const { scrollRef, contentRef, scrollOnSend } = useAutoScroll();

    // Read the live stale-ask bindings from the store directly (C6). The map is
    // runtime-only (absent after reload), so bindings never render on historical rows.
    const staleAskBindings = useChatStore((s) => s.staleAskBindings);

    // Read fold states and live episode tracking (C7).
    const foldStates = useChatStore((s) => s.foldStates);
    const liveEpisodeIds = useChatStore((s) => s.liveEpisodeIds);
    const setEpisodeFolded = useChatStore((s) => s.setEpisodeFolded);

    // Group proactive messages by episodeId so all messages sharing an episode
    // collapse into one foldable group regardless of non-proactive turns between them.
    const renderItems = useMemo(() => groupByEpisode(messages), [messages]);

    // Order-safe fold timer (C7). When a foldEpisode with praise arrives, we wait
    // for the close row (closeMessageId) to land before starting a ~5 s countdown.
    // This effect handles BOTH arrival orders:
    //   Order A (close row first, then foldEpisode): when foldEpisode updates
    //     foldStates, messages already contains the close row; timer starts immediately.
    //   Order B (foldEpisode first, close row later): when addMessage inserts the
    //     close row, messages changes; effect re-runs, finds the row, starts timer.
    const foldTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    useEffect(() => {
        foldStates.forEach((state, episodeId) => {
            if (state.folded || state.closeMessageId === undefined) { return; }
            if (foldTimers.current.has(episodeId)) { return; } // timer already running
            const closeRowPresent = messages.some((m) => m.id === state.closeMessageId);
            if (closeRowPresent) {
                const timer = setTimeout(() => {
                    setEpisodeFolded(episodeId);
                    foldTimers.current.delete(episodeId);
                }, FOLD_DELAY_MS);
                foldTimers.current.set(episodeId, timer);
            }
        });
    }, [foldStates, messages, setEpisodeFolded]);

    // Clear all pending fold timers on unmount.
    useEffect(() => {
        const timers = foldTimers.current;
        return () => {
            timers.forEach((t) => clearTimeout(t));
            timers.clear();
        };
    }, []);

    const renderBubble = (message: ChatMessage, isLatest = false): ReactNode => {
        // Dismiss gate (C7): suppress Dismiss on earlier group members and on the
        // closing row of a praise episode (the close row is a confirmation, not a hint).
        const isClosingRow =
            message.id !== undefined &&
            message.proactiveEpisodeId !== undefined &&
            foldStates.get(message.proactiveEpisodeId)?.closeMessageId === message.id;
        const canDismiss = isLatest && !isClosingRow;

        const binding = message.id !== undefined ? staleAskBindings.get(message.id) : undefined;
        if (binding) {
            return (
                <Fragment key={message.localId}>
                    <MessageBubble
                        message={message}
                        onFeedback={onFeedback}
                        onRetry={onRetry}
                        onDismiss={canDismiss ? onDismiss : undefined}
                        retryDisabled={isRetryDisabled ? isRetryDisabled(message) : false}
                    />
                    <StaleAskButtons
                        askId={binding.askId}
                        question={binding.question}
                        onButton={(button) => onStaleAskButton?.(binding.askId, button)}
                    />
                </Fragment>
            );
        }
        return (
            <MessageBubble
                key={message.localId}
                message={message}
                onFeedback={onFeedback}
                onRetry={onRetry}
                onDismiss={canDismiss ? onDismiss : undefined}
                retryDisabled={isRetryDisabled ? isRetryDisabled(message) : false}
            />
        );
    };

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
                        {renderItems.map((item) => {
                            if (item.kind === 'single') {
                                const episodeId = item.message.proactiveEpisodeId;
                                if (episodeId) {
                                    const foldState = foldStates.get(episodeId);
                                    // Fold: either explicitly folded or not a live episode (reloaded).
                                    if (foldState?.folded || !liveEpisodeIds.has(episodeId)) {
                                        const label = foldState?.episodeLabel ?? deriveEpisodeLabel(item.message.content);
                                        const isPraise = !!foldState?.episodeLabel;
                                        return (
                                            <EpisodeFoldLine
                                                key={`fold-${episodeId}`}
                                                label={label}
                                                isPraise={isPraise}
                                                messages={[item.message]}
                                                renderBubble={renderBubble}
                                            />
                                        );
                                    }
                                }
                                return renderBubble(item.message, true);
                            }
                            if (item.kind === 'episode') {
                                const foldState = foldStates.get(item.episodeId);
                                // Fold: either explicitly folded or not a live episode (reloaded).
                                if (foldState?.folded || !liveEpisodeIds.has(item.episodeId)) {
                                    const latest = item.messages[item.messages.length - 1];
                                    const label = foldState?.episodeLabel ?? deriveEpisodeLabel(latest.content);
                                    const isPraise = !!foldState?.episodeLabel;
                                    return (
                                        <EpisodeFoldLine
                                            key={`fold-${item.episodeId}`}
                                            label={label}
                                            isPraise={isPraise}
                                            messages={item.messages}
                                            renderBubble={renderBubble}
                                        />
                                    );
                                }
                                const earlier = item.messages.slice(0, -1);
                                const latest = item.messages[item.messages.length - 1];
                                return (
                                    <ProactiveRunGroup
                                        key={item.episodeId}
                                        earlier={earlier}
                                        latest={latest}
                                        renderBubble={renderBubble}
                                    />
                                );
                            }
                            // kind === 'proactive-run'
                            return (
                                <ProactiveRunGroup
                                    key={item.latest.localId}
                                    earlier={item.earlier}
                                    latest={item.latest}
                                    renderBubble={renderBubble}
                                />
                            );
                        })}

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
