import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import History from 'lucide-react/dist/esm/icons/history';
import Plus from 'lucide-react/dist/esm/icons/plus';

import styles from './ChatHeader.module.css';

interface ChatHeaderProps {
    /** Header line 1, and the only clickable label: opens the course list. */
    courseTitle: string | null;
    /** Header line 2, beside `displayMessageCount`. */
    conversationTitle: string | null;
    /** Excludes CTXSWAP marker rows; display only. */
    displayMessageCount: number;
    /**
     * True while Iris is responding to the current run. Every affordance here
     * navigates, which would abandon the in-flight run, so they are made
     * non-interactive rather than merely dimmed.
     */
    disableNavigation?: boolean;
    onOpenCoursePicker: (e: React.MouseEvent) => void;
    onNewConversation: () => void;
    onOpenHistory: (e: React.MouseEvent) => void;
}

/**
 * One row, two lines. Line 1 is the course and is the only clickable label,
 * so a click never lands on a target the label did not name. The topic is
 * deliberately absent here: it lives on the composer chip.
 *
 * The course title does appear twice, here and on the composer whenever the
 * topic IS the course. The two answer different questions (which course am I
 * in, versus what is the next message about), so the composer's copy carries
 * an aria-label that keeps the two buttons apart for anyone navigating by
 * accessible name.
 */
export function ChatHeader({
    courseTitle,
    conversationTitle,
    displayMessageCount,
    disableNavigation = false,
    onOpenCoursePicker,
    onNewConversation,
    onOpenHistory,
}: ChatHeaderProps) {
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
                <button
                    className={styles.iconBtn}
                    onClick={onNewConversation}
                    disabled={disableNavigation}
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
            </div>
        </div>
    );
}
