import clsx from 'clsx';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import { useAutoScroll } from '@webview/hooks/useAutoScroll';
import { useChatStore } from '@webview/stores/useChatStore';
import type { ChatMessage, StreamingState } from '@webview/views/IrisChat/types';

import { ActivityFeed } from './ActivityFeed';
import styles from './ChatMessageList.module.css';
import { ContextSwapRow } from './ContextSwapRow';
import { groupEarlierHints } from './earlierHints';
import { EarlierHintsGroup } from './EarlierHintsGroup';
import { type EpisodeOutcome, episodeTopic, outcomeMeta, rowOutcome } from './episodeSummary';
import { EpisodeTimeline } from './EpisodeTimeline';
import { type ChatRenderItem, groupByEpisode } from './groupProactiveMessages';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { WelcomeState } from './WelcomeState';

/** Adapter: the timeline supplies (message, isLatest); the bubble is always rendered grouped. */
type RenderBubble = (message: ChatMessage, isLatest: boolean, grouped: boolean) => ReactNode;
const timelineRowBody = (renderBubble: RenderBubble) =>
    (m: ChatMessage, isLatest: boolean): ReactNode => renderBubble(m, isLatest, true);

/**
 * Borderless summary line for a CLOSED (folded) episode (C7): a chevron plus the outcome
 * (Resolved / Dismissed / Timed out / Earlier hint) and a real topic. Expands into the
 * {@link EpisodeTimeline} with Dismiss disabled (a closed episode is not re-dismissable).
 */
function EpisodeFoldLine({
    messages,
    foldState,
    renderBubble,
    onOfferAnswer,
}: {
    messages: ChatMessage[];
    foldState: { folded: boolean; episodeLabel?: string; outcome?: EpisodeOutcome } | undefined;
    renderBubble: (message: ChatMessage, isLatest: boolean, grouped: boolean) => ReactNode;
    onOfferAnswer?: (offerId: string, episodeId: string | undefined, moment: 'stuck' | 'abandon', action: 'accept' | 'decline') => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const meta = outcomeMeta(foldState?.outcome ?? rowOutcome(messages));
    const toneClass = meta.tone === 'success'
        ? styles.toneSuccess
        : meta.tone === 'muted'
            ? styles.toneMuted
            : styles.toneNeutral;
    const topic = episodeTopic(messages, foldState?.episodeLabel);
    const OutcomeIcon = meta.Icon;
    // Collapsed: the icon IS the outcome, so it must name itself for AT. Expanded: the word is visible
    // beside it and carries the meaning, so the icon becomes decorative (avoids a double announce).
    const outcomeAria = expanded
        ? ({ 'aria-hidden': true } as const)
        : ({ role: 'img', 'aria-label': meta.word } as const);
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
                <span className={clsx(styles.foldOutcome, toneClass)} title={meta.word} {...outcomeAria}>
                    <OutcomeIcon size={13} aria-hidden="true" />
                </span>
                {/* The word + separator only appear once expanded (they spell the icon out). Collapsed the
                    icon sits right next to the topic, no floating dot. */}
                {expanded && (
                    <>
                        <span className={clsx(styles.foldWord, toneClass)}>{meta.word}</span>
                        <span className={styles.foldSep}>·</span>
                    </>
                )}
                <span className={styles.foldTopic}>{topic}</span>
            </button>
            {expanded && (
                <EpisodeTimeline
                    messages={messages}
                    episodeId={messages[0]?.proactiveEpisodeId ?? ''}
                    dismissable={false}
                    onOfferAnswer={onOfferAnswer}
                    renderRowBody={timelineRowBody(renderBubble)}
                />
            )}
        </div>
    );
}

interface ChatMessageListProps {
    messages: ChatMessage[];
    streaming: StreamingState;
    /** Host-owned: a proactive hint the student asked for is being prepared. Absent = none. */
    proactiveThinking?: boolean;
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
     * Sending is refused right now. Only reaches the welcome prompts, which
     * are sends and go inert with the send button.
     */
    sendDisabled?: boolean;
    /** Why sending is blocked, surfaced on the welcome prompts. */
    sendDisabledLabel?: string;
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
    /** Invoked when the student marks a proactive episode "Solved it" (positive close, records RECOVERED). */
    onResolve?: (messageId: number, proactiveEpisodeId?: string) => void;
    /** Invoked when the student answers a consented offer bubble (accept/decline). */
    onOfferAnswer?: (offerId: string, episodeId: string | undefined, moment: 'stuck' | 'abandon', action: 'accept' | 'decline') => void;
}

/** Delay (ms) between the close row arriving and the episode folding (C7). */
const FOLD_DELAY_MS = 5000;

export function ChatMessageList({
    messages,
    streaming,
    proactiveThinking = false,
    activities,
    liveDraft,
    runState,
    runError,
    onFeedback,
    onSendPrompt,
    hasContext,
    isChatDisabled,
    sendDisabled,
    sendDisabledLabel,
    onRetry,
    isRetryDisabled,
    onDismiss,
    onResolve,
    onOfferAnswer,
}: ChatMessageListProps) {
    const { scrollRef, contentRef, scrollOnSend } = useAutoScroll();

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

        return (
            <MessageBubble
                key={message.localId}
                message={message}
                onFeedback={onFeedback}
                onRetry={onRetry}
                onDismiss={canDismiss ? onDismiss : undefined}
                onOfferAnswer={onOfferAnswer}
                retryDisabled={isRetryDisabled ? isRetryDisabled(message) : false}
                grouped={grouped}
            />
        );
    };

    useEffect(() => {
        scrollOnSend();
    }, [messages.length, scrollOnSend]);

    // An in-flight (or just-failed) run has its own surfaces to show even
    // before the first message lands, so it suppresses the welcome state.
    const hasRunSurface =
        streaming.isStreaming || proactiveThinking || activities.length > 0 || !!liveDraft || runState === 'FAILED';
    const showWelcome = messages.length === 0 && !hasRunSurface;

    // The thinking indicator is the "nothing to show yet" placeholder: once the
    // run has produced activities or a draft, those richer surfaces replace it.
    const showThinking = (streaming.isStreaming || proactiveThinking) && activities.length === 0 && !liveDraft;
    // ThinkingIndicator is really two surfaces in one: a run's terminal error (rendered BEFORE the
    // isVisible gate) and the "preparing" spinner. Once a proactive request can be in flight while a
    // normal run has already failed, both facts are true at once and neither may hide the other, so
    // they get an instance each. With `proactiveThinking` false this is exactly the single call it
    // has always been. A LIVE run still wins: its activities/draft gate the spinner off below.
    const showProactiveThinking = proactiveThinking && activities.length === 0 && !liveDraft;

    // Closed-ness of a proactive episode: an explicit host fold frame (foldStates entry) decides
    // alone when present -- folded=false is the praise window (stays open until the ~5 s timer
    // fires), folded=true is collapsed. Without a fold frame, the liveness gate is the reload
    // default: only the episode the host marks live (SetLiveEpisode / live addMessage) stays open.
    const isEpisodeClosed = (episodeId: string): boolean => {
        const foldState = foldStates.get(episodeId);
        return foldState ? foldState.folded : !liveEpisodeIds.has(episodeId);
    };

    // Renders one grouped render item: a closed proactive episode as a fold line, an open one as the
    // timeline, anything else as a plain bubble. Also reused as the child renderer inside a collapsed
    // "earlier hints" group (which only ever hands it closed episodes, i.e. the fold-line branch).
    const renderItem = (item: ChatRenderItem): ReactNode => {
        if (item.kind === 'single') {
            // Stored topic-change markers render in transcript order, before the
            // message they triggered, matching the server's write order. They carry
            // no episode, so grouping always hands them over as a single item.
            if (item.message.role === 'contextSwap') {
                return <ContextSwapRow key={item.message.localId} text={item.message.content} />;
            }
            const episodeId = item.message.proactiveEpisodeId;
            if (episodeId) {
                if (isEpisodeClosed(episodeId)) {
                    return (
                        <EpisodeFoldLine
                            key={`fold-${episodeId}`}
                            messages={[item.message]}
                            foldState={foldStates.get(episodeId)}
                            renderBubble={renderBubble}
                            onOfferAnswer={onOfferAnswer}
                        />
                    );
                }
                // Open live single-message episode: the timeline (one node).
                return (
                    <EpisodeTimeline
                        key={`ep-${episodeId}`}
                        messages={[item.message]}
                        episodeId={episodeId}
                        dismissable
                        onDismiss={onDismiss}
                        onResolve={onResolve}
                        onOfferAnswer={onOfferAnswer}
                        renderRowBody={timelineRowBody(renderBubble)}
                    />
                );
            }
            // Proactive without an episodeId, or a non-proactive turn: a plain bubble.
            return renderBubble(item.message, true, false);
        }
        if (isEpisodeClosed(item.episodeId)) {
            return (
                <EpisodeFoldLine
                    key={`fold-${item.episodeId}`}
                    messages={item.messages}
                    foldState={foldStates.get(item.episodeId)}
                    renderBubble={renderBubble}
                    onOfferAnswer={onOfferAnswer}
                />
            );
        }
        // Open live multi-message episode: one timeline, all messages.
        return (
            <EpisodeTimeline
                key={`ep-${item.episodeId}`}
                messages={item.messages}
                episodeId={item.episodeId}
                dismissable
                onDismiss={onDismiss}
                onResolve={onResolve}
                onOfferAnswer={onOfferAnswer}
                renderRowBody={timelineRowBody(renderBubble)}
            />
        );
    };

    // Second grouping pass: collapse runs of >= 2 consecutive CLOSED proactive episodes behind one
    // "N earlier hints" line so a long session stops stacking near-identical fold lines. Closed-ness
    // is runtime store state, so it's resolved here rather than in the pure groupByEpisode.
    const closedEpisodeId = (item: ChatRenderItem): string | undefined => {
        const episodeId = item.kind === 'episode' ? item.episodeId : item.message.proactiveEpisodeId;
        if (!episodeId) { return undefined; }
        return isEpisodeClosed(episodeId) ? episodeId : undefined;
    };
    const groupedRows = groupEarlierHints(renderItems, closedEpisodeId);

    return (
        <div ref={scrollRef} className={styles.scrollContainer}>
            <div ref={contentRef} className={styles.content}>
                {showWelcome ? (
                    <WelcomeState
                        onSendPrompt={onSendPrompt}
                        hasContext={hasContext}
                        isChatDisabled={isChatDisabled}
                        sendDisabled={sendDisabled}
                        sendDisabledLabel={sendDisabledLabel}
                    />
                ) : (
                    <>
                        {groupedRows.map((row) =>
                            row.kind === 'earlier-hints'
                                ? (
                                    <EarlierHintsGroup
                                        key={`earlier-${row.key}`}
                                        items={row.items}
                                        renderFoldLine={renderItem}
                                    />
                                )
                                : renderItem(row.item),
                        )}

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
                            isVisible={showThinking && !proactiveThinking}
                            runState={runState}
                            error={runError}
                        />
                        {showProactiveThinking && <ThinkingIndicator isVisible runState={null} error={null} />}
                    </>
                )}
            </div>
        </div>
    );
}
