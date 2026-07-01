import clsx from 'clsx';
import type { ReactNode } from 'react';

import { useChatStore } from '@webview/stores/useChatStore';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { ChatMessage } from '@webview/views/IrisChat/types';

import { type CheckinState, checkinState, episodeIsOpen, isStaleCheck, type NodeKind } from './checkinState';
import styles from './EpisodeTimeline.module.css';

interface EpisodeTimelineProps {
    messages: ChatMessage[];
    episodeId: string;
    /** True only for a live episode: gates the Dismiss action to the latest row. */
    dismissable: boolean;
    /** Dismiss the episode (only offered on the latest row of a live episode). */
    onDismiss?: (messageId: number, proactiveEpisodeId?: string) => void;
    renderRowBody: (m: ChatMessage, node: { kind: NodeKind; state?: CheckinState }, isLatest: boolean) => ReactNode;
}

/**
 * Open episode rendered as a vertical timeline inside a tinted card: one "Iris reached out" caption
 * plus one node per message. Hint nodes are filled; a stale-check node reflects its resolution
 * (pending / solved / still-working / ignored). The row body (bubble + optional quick replies) is
 * supplied by the caller so this component stays presentational.
 */
export function EpisodeTimeline({ messages, episodeId, dismissable, onDismiss, renderRowBody }: EpisodeTimelineProps) {
    const staleAskBindings = useChatStore((s) => s.staleAskBindings);
    const staleAnswers = useChatStore((s) => s.staleAnswers);
    const foldStates = useChatStore((s) => s.foldStates);
    const liveEpisodeIds = useChatStore((s) => s.liveEpisodeIds);

    const live = liveEpisodeIds.has(episodeId);
    const fold = foldStates.get(episodeId);
    const open = episodeIsOpen(episodeId, live, fold);
    const latest = messages[messages.length - 1];

    return (
        <div className={styles.timeline}>
            <div className={styles.caption}>Iris reached out</div>
            {messages.map((m) => {
                const hasBinding = m.id !== undefined && staleAskBindings.has(m.id);
                const stale = isStaleCheck(m, hasBinding);
                const isLatest = m === latest;
                const state: CheckinState | undefined = stale
                    ? checkinState({
                        message: m,
                        liveAnswer: m.id !== undefined ? staleAnswers.get(m.id) : undefined,
                        isLatestInEpisode: isLatest,
                        episodeOpen: open,
                    })
                    : undefined;
                const kind: NodeKind = stale ? 'checkin' : 'hint';
                return (
                    <div key={m.localId} className={clsx(styles.row, isLatest && styles.rowLast)}>
                        <div className={styles.rail}>
                            <span
                                className={clsx(styles.node, nodeClass(kind, state))}
                                data-node-kind={kind}
                                data-node-state={state}
                            />
                        </div>
                        <div className={styles.body}>
                            {renderRowBody(m, { kind, state }, dismissable && isLatest)}
                            {/* Hover/focus chrome: per-message timestamp, plus Dismiss only on the latest live row.
                                Collapsed at rest; the row expands it open with a short animation (see CSS). */}
                            <div className={styles.foot}>
                                <span className={styles.time} data-testid="row-time">{formatRelativeTime(m.timestamp)}</span>
                                {dismissable && isLatest && m.id !== undefined && onDismiss && (
                                    <button
                                        type="button"
                                        className={styles.dismiss}
                                        aria-label="Dismiss this suggestion"
                                        onClick={() => onDismiss(m.id as number, m.proactiveEpisodeId)}
                                    >
                                        Dismiss
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function nodeClass(kind: NodeKind, state?: CheckinState): string {
    if (kind === 'hint') { return styles.nodeHint; }
    switch (state) {
        case 'solved': return styles.nodeSolved;
        case 'still-working': return styles.nodeStill;
        case 'ignored': return styles.nodeIgnored;
        default: return styles.nodePending;
    }
}
