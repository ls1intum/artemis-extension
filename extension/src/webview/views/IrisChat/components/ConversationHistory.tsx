import clsx from 'clsx';
import Check from 'lucide-react/dist/esm/icons/check';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Plus from 'lucide-react/dist/esm/icons/plus';
import type { KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { ChatSession } from '@webview/views/IrisChat/types';

import styles from './ConversationHistory.module.css';

interface ConversationHistoryProps {
    sessions: ChatSession[];
    activeSessionId: string | null;
    canCreateConversation: boolean;
    onSelectSession: (sessionId: string) => void;
    onNewConversation: () => void;
    onClose: () => void;
}

/**
 * M1 conversation-switching popover, fed by the current context's
 * `store.sessions`. Same dialog shell/focus-trap pattern as `ContextPicker`.
 * Task 11 swaps the data source to bucketed course-wide history plus
 * `openArtemisSession` — this component's props are expected to grow then,
 * not change shape for existing fields.
 */
export function ConversationHistory({
    sessions,
    activeSessionId,
    canCreateConversation,
    onSelectSession,
    onNewConversation,
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

    return (
        <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
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

            <div className={styles.list}>
                {sessions.length === 0 && (
                    <div className={styles.emptyState}>No conversations yet</div>
                )}
                {sessions.map((session) => {
                    const active = session.id === activeSessionId;
                    return (
                        <button
                            key={session.id}
                            type="button"
                            className={clsx(styles.row, { [styles.rowActive]: active })}
                            data-testid={active ? 'history-active' : undefined}
                            onClick={() => onSelectSession(session.id)}
                        >
                            <MessageSquare size={16} className={styles.rowIcon} />
                            <span className={styles.rowTextColumn}>
                                <span className={styles.rowText}>
                                    {session.title || 'Untitled conversation'}
                                </span>
                                <span className={styles.rowSubtitle}>
                                    {formatRelativeTime(session.lastActivity)}
                                </span>
                            </span>
                            {active && <Check size={16} className={styles.checkIcon} />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
