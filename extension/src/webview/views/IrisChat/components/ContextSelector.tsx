import clsx from 'clsx';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Check from 'lucide-react/dist/esm/icons/check';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Circle from 'lucide-react/dist/esm/icons/circle';
import File from 'lucide-react/dist/esm/icons/file';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';
import { useMemo, useRef, useState } from 'react';

import type { ChatContextType } from '@shared/types/context';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { formatRelativeTime } from '@webview/utils/formatRelativeTime';
import type { ChatContext, ChatSession, ContextItem } from '@webview/views/IrisChat/types';

import styles from './ContextSelector.module.css';

interface ContextSelectorProps {
    context: ChatContext | null;
    sessions: ChatSession[];
    activeSessionId: string | null;
    exercises: ContextItem[];
    courses: ContextItem[];
    onSelectContext: (type: ChatContextType, id: number, title: string, shortName?: string) => void;
    onSelectSession: (sessionId: string) => void;
    onCreateNewSession: () => void;
    onSwitchToWorkspace: () => void;
}

export function ContextSelector({
    context,
    sessions,
    activeSessionId,
    exercises,
    courses,
    onSelectContext,
    onSelectSession,
    onCreateNewSession,
    onSwitchToWorkspace,
}: ContextSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    useClickOutside(containerRef, isOpen, () => {
        setIsOpen(false);
        setSearchQuery('');
    });

    const courseShortById = useMemo(() => {
        const m = new Map<number, string>();
        for (const c of courses) {
            const tag = c.shortName ?? c.title;
            if (tag) { m.set(c.id, tag); }
        }
        return m;
    }, [courses]);

    const q = searchQuery.trim().toLowerCase();
    const filteredExercises = q
        ? exercises.filter(ex => {
            const courseTag = ex.courseId ? courseShortById.get(ex.courseId) ?? '' : '';
            return ex.title.toLowerCase().includes(q)
                || (ex.shortName ?? '').toLowerCase().includes(q)
                || courseTag.toLowerCase().includes(q);
        })
        : exercises;
    const filteredCourses = q
        ? courses.filter(c =>
            c.title.toLowerCase().includes(q)
            || (c.shortName ?? '').toLowerCase().includes(q)
        )
        : courses;

    const workspaceExercise = exercises.find(ex => ex.isWorkspace);
    const workspaceCourse = workspaceExercise?.courseId
        ? courses.find(c => c.id === workspaceExercise.courseId)
        : undefined;

    const isInWorkspaceContext = context?.source === 'workspace-detected';
    const isInWorkspaceCourseContext = !!workspaceCourse
        && context?.type === 'course'
        && context.id === workspaceCourse.id;
    const canCreateNewSession = sessions.length > 0 && sessions.some(s => s.messageCount > 0);
    const activeSession = context ? sessions.find(s => s.id === activeSessionId) : undefined;
    const messageCount = activeSession?.messageCount || 0;

    const hasWorkspaceShortcut = !!(workspaceExercise || workspaceCourse);
    const showTopSection = q.length === 0 && (context !== null || hasWorkspaceShortcut);

    const toggleDropdown = () => {
        setIsOpen(!isOpen);
        if (isOpen) { setSearchQuery(''); }
    };

    const handleSelectContext = (
        type: ChatContextType,
        id: number,
        title: string,
        shortName?: string
    ) => {
        onSelectContext(type, id, title, shortName);
        setIsOpen(false);
        setSearchQuery('');
    };

    const handleSelectSession = (sessionId: string) => {
        onSelectSession(sessionId);
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className={styles.container}>
            <button className={styles.header} onClick={toggleDropdown}>
                <div className={styles.headerContent}>
                    {context?.source === 'workspace-detected' ? (
                        <FolderGit2 size={14} className={styles.lockIcon} />
                    ) : (
                    <div className={styles.contextIcon}>
                        {context?.type === 'exercise' ? (
                            <File size={18} />
                        ) : context?.type === 'course' ? (
                            <BookOpen size={18} />
                        ) : (
                            <Circle size={18} />
                        )}
                    </div>
                    )}
                    <div className={styles.textContainer}>
                        <span className={styles.title}>
                            {activeSession?.title || 'New conversation'}
                        </span>
                        <span className={styles.subtitle}>
                            {context?.title ? `${context.title} · ${messageCount} msg${messageCount !== 1 ? 's' : ''}` : 'Select context'}
                        </span>
                    </div>
                </div>
                <ChevronDown
                    size={16}
                    className={clsx(styles.chevron, {
                        [styles.chevronExpanded]: isOpen,
                    })}
                />
            </button>

            {isOpen && (
                <div className={styles.dropdown}>
                    <div className={styles.searchContainer}>
                        <div className={styles.searchInputWrapper}>
                            <Search size={14} className={styles.searchIcon} />
                            <input
                                type="text"
                                className={styles.searchInput}
                                placeholder="Search exercises or courses..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className={styles.dropdownContent}>
                        {showTopSection && (
                            <div className={styles.section}>
                                <div className={styles.actions}>
                                    {context !== null && (
                                        <button
                                            className={styles.actionButton}
                                            onClick={() => {
                                                onCreateNewSession();
                                                setIsOpen(false);
                                            }}
                                            disabled={!canCreateNewSession}
                                        >
                                            <span className={styles.actionButtonContent}>
                                                <Plus size={14} />
                                                New Conversation
                                            </span>
                                        </button>
                                    )}
                                    {workspaceExercise && (
                                        <button
                                            className={styles.actionButton}
                                            disabled={isInWorkspaceContext}
                                            onClick={() => {
                                                onSwitchToWorkspace();
                                                setIsOpen(false);
                                            }}
                                        >
                                            <span className={styles.actionButtonContent}>
                                                <FolderGit2 size={14} />
                                                {isInWorkspaceContext
                                                    ? `Workspace Exercise (Active): ${workspaceExercise.title}`
                                                    : `Chat about Workspace Exercise: ${workspaceExercise.title}`}
                                            </span>
                                        </button>
                                    )}
                                    {workspaceCourse && (
                                        <button
                                            className={styles.actionButton}
                                            disabled={isInWorkspaceCourseContext}
                                            onClick={() => {
                                                handleSelectContext(
                                                    'course',
                                                    workspaceCourse.id,
                                                    workspaceCourse.title,
                                                    workspaceCourse.shortName
                                                );
                                            }}
                                        >
                                            <span className={styles.actionButtonContent}>
                                                <BookOpen size={14} />
                                                {isInWorkspaceCourseContext
                                                    ? `Workspace Course (Active): ${workspaceCourse.title}`
                                                    : `Chat about Workspace Course: ${workspaceCourse.title}`}
                                            </span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {context !== null && sessions.length > 0 && q.length === 0 && (
                            <div className={clsx(styles.section, styles.scrollSection)}>
                                <div className={styles.sectionHeader}>Conversations</div>
                                <div className={styles.scrollList}>
                                    {sessions.map(session => (
                                        <button
                                            key={session.id}
                                            className={clsx(styles.sessionItem, {
                                                [styles.sessionItemActive]:
                                                    session.id === activeSessionId,
                                            })}
                                            onClick={() => handleSelectSession(session.id)}
                                        >
                                            <MessageSquare size={14} className={styles.sessionIcon} />
                                            <div className={styles.sessionContent}>
                                                <span className={styles.sessionPreview}>
                                                    {session.title || session.preview}
                                                </span>
                                                <span className={styles.sessionMeta}>
                                                    {session.messageCount} messages · {formatRelativeTime(session.lastActivity)}
                                                </span>
                                            </div>
                                            {session.id === activeSessionId && (
                                                <Check size={16} className={styles.checkIcon} />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {filteredExercises.length > 0 && (
                            <div className={clsx(styles.section, styles.scrollSection)}>
                                <div className={styles.sectionHeader}>Exercises</div>
                                <div className={styles.scrollList}>
                                    {filteredExercises.map((exercise) => {
                                        const courseTag = exercise.courseId ? courseShortById.get(exercise.courseId) : undefined;
                                        return (
                                            <button
                                                key={exercise.id}
                                                className={styles.contextItem}
                                                onClick={() =>
                                                    handleSelectContext(
                                                        'exercise',
                                                        exercise.id,
                                                        exercise.title,
                                                        exercise.shortName
                                                    )
                                                }
                                            >
                                                {exercise.isWorkspace && (
                                                    <FolderGit2 size={14} className={styles.itemIcon} />
                                                )}
                                                <span className={styles.itemText}>
                                                    {exercise.title}
                                                </span>
                                                <span
                                                    className={styles.itemTag}
                                                    aria-hidden={courseTag ? undefined : true}
                                                    style={courseTag ? undefined : { visibility: 'hidden' }}
                                                >
                                                    {courseTag ?? ' '}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {filteredCourses.length > 0 && (
                            <div className={clsx(styles.section, styles.scrollSection)}>
                                <div className={styles.sectionHeader}>Courses</div>
                                <div className={styles.scrollList}>
                                    {filteredCourses.map((course) => (
                                        <button
                                            key={course.id}
                                            className={styles.contextItem}
                                            onClick={() =>
                                                handleSelectContext(
                                                    'course',
                                                    course.id,
                                                    course.title,
                                                    course.shortName
                                                )
                                            }
                                        >
                                            <span className={styles.itemText}>
                                                {course.title}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {filteredExercises.length === 0 && filteredCourses.length === 0 && (
                            <div className={styles.emptyState}>
                                No exercises or courses found
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
