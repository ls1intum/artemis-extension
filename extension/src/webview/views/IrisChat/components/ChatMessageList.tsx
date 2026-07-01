import clsx from 'clsx';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { useAutoScroll } from '@webview/hooks/useAutoScroll';
import { useChatStore } from '@webview/stores/useChatStore';
import type { ChatMessage, IrisStageDTO, StreamingState } from '@webview/views/IrisChat/types';

import styles from './ChatMessageList.module.css';
import { type EpisodeOutcome, episodeTopic, outcomeMeta, rowOutcome } from './episodeSummary';
import { groupByEpisode } from './groupProactiveMessages';
import { MessageBubble } from './MessageBubble';
import { StaleAskButtons } from './StaleAskButtons';
import { ThinkingIndicator } from './ThinkingIndicator';
import { WelcomeState } from './WelcomeState';

/**
 * The shared OPEN renderer for a proactive episode: ONE "Iris reached out" caption header plus
 * ALL the episode's messages under a subtle left rail (the "session" unit). Used both for a live
 * episode and when a folded episode is expanded. `dismissable` is true only for a live episode;
 * a re-opened closed episode passes false so no row exposes a Dismiss action.
 */
function EpisodeBlock({
    messages,
    dismissable,
    renderBubble,
}: {
    messages: ChatMessage[];
    dismissable: boolean;
    renderBubble: (message: ChatMessage, isLatest: boolean, grouped: boolean) => ReactNode;
}) {
    const latest = messages[messages.length - 1];
    return (
        <div className={styles.episodeBlock}>
            <div className={styles.episodeCaption}>Iris reached out</div>
            {messages.map((m) => renderBubble(m, dismissable && m === latest, true))}
        </div>
    );
}

/**
 * Borderless summary line for a CLOSED (folded) episode (C7): a chevron plus the outcome
 * (Resolved / Dismissed / Timed out / Earlier hint) and a real topic. Expands into the shared
 * {@link EpisodeBlock} with Dismiss disabled (a closed episode is not re-dismissable).
 */
function EpisodeFoldLine({
    messages,
    foldState,
    renderBubble,
}: {
    messages: ChatMessage[];
    foldState: { folded: boolean; episodeLabel?: string; outcome?: EpisodeOutcome } | undefined;
    renderBubble: (message: ChatMessage, isLatest: boolean, grouped: boolean) => ReactNode;
}) {
    const [expanded, setExpanded] = useState(false);
    const meta = outcomeMeta(foldState?.outcome ?? rowOutcome(messages));
    const toneClass = meta.tone === 'success'
        ? styles.toneSuccess
        : meta.tone === 'muted'
            ? styles.toneMuted
            : styles.toneNeutral;
    const topic = episodeTopic(messages, foldState?.episodeLabel);
    return (
        <div className={styles.episodeFold}>
            <button
                type="button"
                className={styles.episodeFoldLine}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
            >
                {expanded
                    ? <ChevronDown size={12} aria-hidden="true" />
                    : <ChevronRight size={12} aria-hidden="true" />}
                <span className={clsx(styles.foldOutcome, toneClass)}>{meta.glyph} {meta.word}</span>
                <span className={styles.foldSep}>·</span>
                <span className={styles.foldTopic}>{topic}</span>
            </button>
            {expanded && <EpisodeBlock messages={messages} dismissable={false} renderBubble={renderBubble} />}
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
    onDismiss?: (messageId: number, proactiveEpisodeId?: string) => void;
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

    const renderBubble = (message: ChatMessage, isLatest = false, grouped = false): ReactNode => {
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
                        grouped={grouped}
                    />
                    <StaleAskButtons
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
                grouped={grouped}
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
                                    // Closed: explicitly folded, or a reloaded (non-live) episode.
                                    if (foldState?.folded || !liveEpisodeIds.has(episodeId)) {
                                        return (
                                            <EpisodeFoldLine
                                                key={`fold-${episodeId}`}
                                                messages={[item.message]}
                                                foldState={foldState}
                                                renderBubble={renderBubble}
                                            />
                                        );
                                    }
                                    // Open live single-message episode: the grouped block (one message).
                                    return (
                                        <EpisodeBlock
                                            key={`ep-${episodeId}`}
                                            messages={[item.message]}
                                            dismissable
                                            renderBubble={renderBubble}
                                        />
                                    );
                                }
                                // Proactive without an episodeId, or a non-proactive turn: a plain bubble.
                                return renderBubble(item.message, true, false);
                            }
                            // item.kind === 'episode' (exhaustive: only 'single' and 'episode' exist)
                            {
                                const foldState = foldStates.get(item.episodeId);
                                // Closed: explicitly folded, or a reloaded (non-live) episode.
                                if (foldState?.folded || !liveEpisodeIds.has(item.episodeId)) {
                                    return (
                                        <EpisodeFoldLine
                                            key={`fold-${item.episodeId}`}
                                            messages={item.messages}
                                            foldState={foldState}
                                            renderBubble={renderBubble}
                                        />
                                    );
                                }
                                // Open live multi-message episode: one grouped block, all messages.
                                return (
                                    <EpisodeBlock
                                        key={`ep-${item.episodeId}`}
                                        messages={item.messages}
                                        dismissable
                                        renderBubble={renderBubble}
                                    />
                                );
                            }
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
