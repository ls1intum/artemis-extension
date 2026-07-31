import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import File from 'lucide-react/dist/esm/icons/file';
import History from 'lucide-react/dist/esm/icons/history';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Plus from 'lucide-react/dist/esm/icons/plus';

import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { ChatContext, ChatSession } from '@webview/views/IrisChat/types';

import styles from './ChatHeader.module.css';

interface ChatHeaderProps {
    context: ChatContext | null;
    activeSession: ChatSession | undefined;
    courseName: string | null;
    canCreateConversation: boolean;
    /**
     * True while Iris is responding to the current run. All navigation
     * affordances here (context row, new conversation, history) change
     * context or the active session, which would abandon the in-flight
     * run, so they are made non-interactive rather than merely dimmed.
     */
    disableNavigation?: boolean;
    onOpenContextPicker: (e: React.MouseEvent) => void;
    onNewConversation: () => void;
    onOpenHistory: (e: React.MouseEvent) => void;

    // ---- Conversation-first props (Task 12). Supplying `onOpenCoursePicker`
    // switches this header to the one-row, two-line layout; without it the
    // pre-conversation-first two-row layout above stays. Task 15 deletes the
    // old branch together with the props that feed it.
    /** Header line 1, and the only clickable label: opens the course list. */
    courseTitle?: string | null;
    /** Header line 2, beside `displayMessageCount`. */
    conversationTitle?: string | null;
    /** Excludes CTXSWAP marker rows; display only. */
    displayMessageCount?: number;
    onOpenCoursePicker?: (e: React.MouseEvent) => void;
}

export function ChatHeader({
    context,
    activeSession,
    courseName,
    canCreateConversation,
    disableNavigation = false,
    onOpenContextPicker,
    onNewConversation,
    onOpenHistory,
    courseTitle,
    conversationTitle,
    displayMessageCount = 0,
    onOpenCoursePicker,
}: ChatHeaderProps) {
    // The `+` and `history` buttons are identical in both layouts; only what
    // they sit beside differs.
    const actionButtons = (newConversationEnabled: boolean) => (
        <>
            <button
                className={styles.iconBtn}
                onClick={onNewConversation}
                disabled={!newConversationEnabled}
                aria-label="New conversation"
                title="New conversation"
            >
                <Plus size={16} />
            </button>
            <button
                className={styles.iconBtn}
                onClick={onOpenHistory}
                disabled={disableNavigation}
                aria-label="View past conversations"
                title="View past conversations"
            >
                <History size={16} />
            </button>
        </>
    );

    if (onOpenCoursePicker) {
        // One row, two lines. Line 1 is the course and is the only clickable
        // label, so a click never lands on a target the label did not name.
        // The topic is deliberately absent here: it lives on the composer
        // chip, so each fact appears exactly once.
        const count = displayMessageCount;
        const conversationLine =
            `${conversationTitle || 'New conversation'} · ${count} ${count === 1 ? 'message' : 'messages'}`;

        return (
            <div className={styles.header}>
                <div className={styles.singleRow}>
                    <span className={styles.icon}>
                        <BookOpen size={16} />
                    </span>
                    <span className={styles.textCol}>
                        <button
                            className={styles.courseButton}
                            onClick={onOpenCoursePicker}
                            disabled={disableNavigation}
                        >
                            <span className={styles.primary}>{courseTitle ?? 'Choose a course'}</span>
                            <ChevronDown size={14} className={styles.chevron} />
                        </button>
                        <span className={styles.secondary}>{conversationLine}</span>
                    </span>
                    {actionButtons(!disableNavigation)}
                </div>
            </div>
        );
    }

    const isExercise = context?.type === 'exercise';

    const primary = context === null ? 'Select a course or exercise' : context.title;
    const secondary = context === null ? null : isExercise ? courseName : 'Course chat';

    const count = activeSession?.messageCount ?? 0;
    const convTitle = activeSession?.title || 'New conversation';
    const convMeta = activeSession
        ? `${formatRelativeTime(activeSession.lastActivity)} · ${count} message${count === 1 ? '' : 's'}`
        : 'No messages yet';

    return (
        <div className={styles.header}>
            <button className={styles.contextRow} onClick={onOpenContextPicker} disabled={disableNavigation}>
                <span className={styles.icon}>
                    {isExercise ? <File size={16} /> : <BookOpen size={16} />}
                </span>
                <span className={styles.textCol}>
                    <span className={styles.primary}>{primary}</span>
                    {secondary !== null && <span className={styles.secondary}>{secondary}</span>}
                </span>
                <ChevronDown size={14} className={styles.chevron} />
            </button>
            <div className={styles.conversationRow}>
                <span className={styles.icon}>
                    <MessageSquare size={16} />
                </span>
                <span className={styles.textCol}>
                    <span className={styles.primary}>{convTitle}</span>
                    <span className={styles.secondary}>{convMeta}</span>
                </span>
                {actionButtons(canCreateConversation && !disableNavigation)}
            </div>
        </div>
    );
}
