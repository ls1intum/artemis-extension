import clsx from 'clsx';
import Check from 'lucide-react/dist/esm/icons/check';
import Info from 'lucide-react/dist/esm/icons/info';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Plus from 'lucide-react/dist/esm/icons/plus';
import type { KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { CourseHistoryEntryVM, HistoryBucket } from '@webview/views/IrisChat/historyBuckets';
import { bucketHistoryByTime } from '@webview/views/IrisChat/historyBuckets';

import styles from './ConversationHistory.module.css';

const BUCKET_LABELS: Record<HistoryBucket, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    last7: 'Last 7 days',
    older: 'Older',
};

interface ConversationHistoryProps {
    entries: CourseHistoryEntryVM[];
    status: 'idle' | 'loading' | 'error' | 'ready';
    /** `artemisSessionId` of the currently active session, or null if none/not yet persisted. */
    activeArtemisSessionId: number | null;
    canCreateConversation: boolean;
    /** Task 10's cross-context open failure, rendered as an inline banner. */
    openError: string | null;
    onSelectEntry: (entry: CourseHistoryEntryVM) => void;
    onNewConversation: () => void;
    onRetry: () => void;
    onClose: () => void;
}

/**
 * Course-wide conversation-switching popover (Task 11), fed by the bucketed
 * `courseHistory` store slice rather than the current context's sessions
 * (the M1 version this replaced). Same dialog shell/focus-trap pattern as
 * `ContextPicker`.
 *
 * Selecting a row posts `openArtemisSession` (via `onSelectEntry`) but does
 * NOT close the popover — it stays open so a resulting inline `openError`
 * has a visible destination. The caller closes it once the active session
 * actually changes, or on Escape/click-outside (handled here).
 */
export function ConversationHistory({
    entries,
    status,
    activeArtemisSessionId,
    canCreateConversation,
    openError,
    onSelectEntry,
    onNewConversation,
    onRetry,
    onClose,
}: ConversationHistoryProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

    useClickOutside(dialogRef, true, onClose);

    // No search input here to anchor autoFocus to (unlike ContextPicker), so
    // focus the first enabled control on mount instead.
    useEffect(() => {
        dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    }, []);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab') { return; }

        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) { return; }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const isLoading = status === 'loading' || status === 'idle';
    // `Date.now()` is intentionally read here, in the component, on every
    // render — bucketHistoryByTime itself stays pure and takes `nowMs` as an
    // argument so it remains deterministically testable.
    const buckets = bucketHistoryByTime(entries, Date.now());

    return (
        <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
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
                                    onClick={() => onSelectEntry(entry)}
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
