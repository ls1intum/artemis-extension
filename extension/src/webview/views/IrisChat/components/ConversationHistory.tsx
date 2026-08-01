import clsx from 'clsx';
import Check from 'lucide-react/dist/esm/icons/check';
import Info from 'lucide-react/dist/esm/icons/info';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';
import { useRef, useState } from 'react';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { usePopoverKeyDown } from '@webview/hooks/usePopoverKeyDown';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import { contextLabel } from '@webview/views/IrisChat/contextLabel';
import type { HistoryBucket } from '@webview/views/IrisChat/historyBuckets';
import { bucketHistoryByTime } from '@webview/views/IrisChat/historyBuckets';
import type { ConversationSummary } from '@webview/views/IrisChat/types';

import styles from './ConversationHistory.module.css';

const BUCKET_LABELS: Record<HistoryBucket, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    older: 'Older',
};

interface ConversationHistoryProps {
    /** Every conversation of the current course, whatever its mode. */
    conversations: ConversationSummary[];
    /** The open conversation, marked with a checkmark. */
    currentSessionId?: number | null;
    onOpen?: (conversation: ConversationSummary) => void;
    onNewConversation?: () => void;
    onClose?: () => void;
    /**
     * A navigation the student asked for here that the host could not carry
     * out. Rendered inline rather than as the global banner: nothing about
     * chat availability changed, only the row they clicked could not be
     * opened, and the popover is where they are looking.
     */
    openError?: string | null;
    /** Injected so bucketing stays deterministic in tests. */
    nowMs?: number;
}

/**
 * The course-wide conversation list: a search field, then the flat list
 * bucketed by last activity.
 *
 * Lecture, text-exercise and unknown-mode conversations are listed too,
 * labelled by their `entityName` with the same neutral icon, and can be opened
 * and continued. They simply cannot be selected as a topic in the picker.
 * Hiding a conversation the student can reach from the web client is worse
 * than showing one whose topic we cannot set.
 */
export function ConversationHistory({
    conversations,
    currentSessionId = null,
    nowMs,
    onOpen,
    onNewConversation,
    onClose,
    openError = null,
}: ConversationHistoryProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useClickOutside(dialogRef, true, () => onClose?.());
    const handleKeyDown = usePopoverKeyDown(dialogRef, () => onClose?.());

    const q = searchQuery.trim().toLowerCase();
    const matches = q.length === 0
        ? conversations
        : conversations.filter((c) => (c.title ?? '').toLowerCase().includes(q)
            || (c.entityName ?? '').toLowerCase().includes(q));

    // `Date.now()` is read here, in the component, so `bucketHistoryByTime`
    // stays pure and deterministically testable.
    const buckets = bucketHistoryByTime(matches, nowMs ?? Date.now());

    return (
        <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-label="Conversations"
            aria-modal="true"
            onKeyDown={handleKeyDown}
        >
            <div className={styles.header}>
                <div className={styles.searchWrapper}>
                    <Search size={14} className={styles.searchIcon} />
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Search conversations…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                </div>
                {onNewConversation && (
                    <button
                        type="button"
                        className={styles.newConversationButton}
                        onClick={onNewConversation}
                    >
                        <Plus size={14} />
                        New conversation
                    </button>
                )}
            </div>

            {openError && (
                <div className={styles.errorBanner} role="alert">
                    <Info size={14} />
                    <span>{openError}</span>
                </div>
            )}

            <div className={styles.list}>
                {matches.length === 0 && (
                    <div className={styles.emptyState}>No conversations</div>
                )}

                {buckets.map(({ bucket, entries: bucketEntries }) => (
                    <div key={bucket} className={styles.bucketGroup}>
                        <div className={styles.bucketHeader}>{BUCKET_LABELS[bucket]}</div>
                        {bucketEntries.map((conversation) => {
                            const active = conversation.sessionId === currentSessionId;
                            return (
                                <button
                                    key={conversation.sessionId}
                                    type="button"
                                    className={clsx(styles.row, { [styles.rowActive]: active })}
                                    data-testid={active ? 'history-active' : undefined}
                                    onClick={() => (active ? onClose?.() : onOpen?.(conversation))}
                                >
                                    <MessageSquare size={16} className={styles.rowIcon} />
                                    <span className={styles.rowTextColumn}>
                                        <span className={styles.rowText}>
                                            {conversation.title || 'Untitled conversation'}
                                        </span>
                                        <span className={styles.rowSubtitleSplit}>
                                            <span className={styles.rowContext}>
                                                {/* Mode-aware: only the overview endpoint sends
                                                    `entityName`, so a nameless EXERCISE row must
                                                    not be labelled a course chat. */}
                                                {contextLabel({
                                                    mode: conversation.mode,
                                                    entityId: conversation.entityId,
                                                    name: conversation.entityName,
                                                })}
                                            </span>
                                            <span className={styles.rowTime}>
                                                {formatRelativeTime(conversation.lastActivity)}
                                            </span>
                                        </span>
                                    </span>
                                    {active && <Check size={16} className={styles.checkIcon} />}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
