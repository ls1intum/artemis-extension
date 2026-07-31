import clsx from 'clsx';
import Check from 'lucide-react/dist/esm/icons/check';
import Info from 'lucide-react/dist/esm/icons/info';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';
import { useEffect, useRef, useState } from 'react';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { usePopoverKeyDown } from '@webview/hooks/usePopoverKeyDown';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { CourseHistoryEntryVM, HistoryBucket } from '@webview/views/IrisChat/historyBuckets';
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
    // ---- Pre-conversation-first props. Task 15 deletes them together with
    // the branch that reads them.
    entries?: CourseHistoryEntryVM[];
    status?: 'idle' | 'loading' | 'error' | 'ready';
    /** `artemisSessionId` of the currently active session, or null if none/not yet persisted. */
    activeArtemisSessionId?: number | null;
    canCreateConversation?: boolean;
    /** Task 10's cross-context open failure, rendered as an inline banner. */
    openError?: string | null;
    onSelectEntry?: (entry: CourseHistoryEntryVM) => void;
    onNewConversation?: () => void;
    onRetry?: () => void;
    onClose?: () => void;

    // ---- Conversation-first props (Task 12). Supplying `conversations`
    // switches this popover to the course-wide conversation list.
    /** Every conversation of the current course, whatever its mode. */
    conversations?: ConversationSummary[];
    /** The open conversation, marked with a checkmark. */
    currentSessionId?: number | null;
    onOpen?: (conversation: ConversationSummary) => void;
    /** Injected so bucketing stays deterministic in tests. */
    nowMs?: number;
}

/**
 * Dispatcher. The two variants are separate components so each keeps its own
 * hooks (see `ContextPicker` for the same split).
 */
export function ConversationHistory(props: ConversationHistoryProps) {
    if (props.conversations) {
        return (
            <ConversationList
                conversations={props.conversations}
                currentSessionId={props.currentSessionId ?? null}
                nowMs={props.nowMs}
                onOpen={props.onOpen}
                onNewConversation={props.onNewConversation}
                onClose={props.onClose}
            />
        );
    }
    return (
        <LegacyConversationHistory
            entries={props.entries ?? []}
            status={props.status ?? 'idle'}
            activeArtemisSessionId={props.activeArtemisSessionId ?? null}
            canCreateConversation={props.canCreateConversation ?? false}
            openError={props.openError ?? null}
            onSelectEntry={props.onSelectEntry}
            onNewConversation={props.onNewConversation}
            onRetry={props.onRetry}
            onClose={props.onClose}
        />
    );
}

interface ConversationListProps {
    conversations: ConversationSummary[];
    currentSessionId: number | null;
    nowMs: number | undefined;
    onOpen: ((conversation: ConversationSummary) => void) | undefined;
    onNewConversation: (() => void) | undefined;
    onClose: (() => void) | undefined;
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
function ConversationList({
    conversations,
    currentSessionId,
    nowMs,
    onOpen,
    onNewConversation,
    onClose,
}: ConversationListProps) {
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
                                                {conversation.entityName ?? 'Course chat'}
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

interface LegacyConversationHistoryProps {
    entries: CourseHistoryEntryVM[];
    status: 'idle' | 'loading' | 'error' | 'ready';
    activeArtemisSessionId: number | null;
    canCreateConversation: boolean;
    openError: string | null;
    onSelectEntry: ((entry: CourseHistoryEntryVM) => void) | undefined;
    onNewConversation: (() => void) | undefined;
    onRetry: (() => void) | undefined;
    onClose: (() => void) | undefined;
}

/**
 * Course-wide conversation-switching popover (Task 11), fed by the bucketed
 * `courseHistory` store slice rather than the current context's sessions
 * (the M1 version this replaced). Same dialog shell/focus-trap pattern as
 * `ContextPicker`.
 *
 * Selecting a row posts `openArtemisSession` (via `onSelectEntry`) but does
 * NOT close the popover: it stays open so a resulting inline `openError`
 * has a visible destination. The caller closes it once the active session
 * actually changes, or on Escape/click-outside (handled here).
 *
 * Clicking the already-active row is a no-op for navigation (there is
 * nothing to open) and just closes the popover instead of calling
 * `onSelectEntry`, so it does not trigger a needless reload or leave the
 * popover stuck open (the active-session-changed effect never fires
 * because the session does not change).
 */
function LegacyConversationHistory({
    entries,
    status,
    activeArtemisSessionId,
    canCreateConversation,
    openError,
    onSelectEntry,
    onNewConversation,
    onRetry,
    onClose,
}: LegacyConversationHistoryProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

    useClickOutside(dialogRef, true, () => onClose?.());
    const handleKeyDown = usePopoverKeyDown(dialogRef, () => onClose?.());

    // No search input here to anchor autoFocus to (unlike ContextPicker), so
    // focus the first enabled control on mount instead.
    useEffect(() => {
        dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    }, []);

    const isLoading = status === 'loading' || status === 'idle';
    // `Date.now()` is intentionally read here, in the component, on every
    // render. `bucketHistoryByTime` itself stays pure and takes `nowMs` as an
    // argument so it remains deterministically testable.
    const buckets = bucketHistoryByTime(entries, Date.now());

    return (
        <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-label="Past conversations"
            aria-modal="true"
            aria-busy={isLoading}
            onKeyDown={handleKeyDown}
        >
            <div className={styles.header}>
                <button
                    type="button"
                    className={styles.newConversationButton}
                    onClick={onNewConversation}
                    disabled={!canCreateConversation}
                >
                    <Plus size={14} />
                    New conversation
                </button>
            </div>

            {openError && (
                <div className={styles.errorBanner} role="alert">
                    <Info size={14} />
                    <span>{openError}</span>
                </div>
            )}

            <div className={styles.list}>
                {isLoading && (
                    <div className={styles.skeleton}>
                        <div className={styles.skeletonRow} />
                        <div className={styles.skeletonRow} />
                        <div className={styles.skeletonRow} />
                    </div>
                )}

                {status === 'error' && (
                    <div className={styles.errorState}>
                        <span>Could not load conversation history.</span>
                        <button type="button" className={styles.retryButton} onClick={onRetry}>
                            Retry
                        </button>
                    </div>
                )}

                {status === 'ready' && entries.length === 0 && (
                    <div className={styles.emptyState}>No past conversations</div>
                )}

                {status === 'ready' && buckets.map(({ bucket, entries: bucketEntries }) => (
                    <div key={bucket} className={styles.bucketGroup}>
                        <div className={styles.bucketHeader}>{BUCKET_LABELS[bucket]}</div>
                        {bucketEntries.map((entry) => {
                            const active = entry.artemisSessionId === activeArtemisSessionId;
                            return (
                                <button
                                    key={entry.artemisSessionId}
                                    type="button"
                                    className={clsx(styles.row, { [styles.rowActive]: active })}
                                    data-testid={active ? 'history-active' : undefined}
                                    onClick={() => (active ? onClose?.() : onSelectEntry?.(entry))}
                                >
                                    <MessageSquare size={16} className={styles.rowIcon} />
                                    <span className={styles.rowTextColumn}>
                                        <span className={styles.rowText}>
                                            {entry.title || 'Untitled conversation'}
                                        </span>
                                        <span className={styles.rowSubtitle}>
                                            {entry.entityName ?? 'Course chat'} · {formatRelativeTime(entry.lastActivity)}
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
