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
    onOpenContextPicker: (e: React.MouseEvent) => void;
    onNewConversation: () => void;
    onOpenHistory: (e: React.MouseEvent) => void;
}

export function ChatHeader({
    context,
    activeSession,
    courseName,
    canCreateConversation,
    onOpenContextPicker,
    onNewConversation,
    onOpenHistory,
}: ChatHeaderProps) {
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
            <button className={styles.contextRow} onClick={onOpenContextPicker}>
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
                <button
                    className={styles.iconBtn}
                    onClick={onNewConversation}
                    disabled={!canCreateConversation}
                    aria-label="New conversation"
                    title="New conversation"
                >
                    <Plus size={16} />
                </button>
                <button
                    className={styles.iconBtn}
                    onClick={onOpenHistory}
                    aria-label="View past conversations"
                    title="View past conversations"
                >
                    <History size={16} />
                </button>
            </div>
        </div>
    );
}
