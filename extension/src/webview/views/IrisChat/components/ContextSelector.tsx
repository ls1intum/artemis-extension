import { useState, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { formatRelativeTime } from '../../../utils/formatRelativeTime';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import type { ChatContext, ChatSession, ContextItem } from '../types';
import type { ChatContextType } from '../../../../shared/types/context';
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
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                                <path d="M14 2v6h6" />
                            </svg>
                        ) : context?.type === 'course' ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                                <path d="M6 12v5c3 3 9 3 12 0v-5" />
                            </svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="12" r="10" />
                            </svg>
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
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    className={clsx(styles.chevron, {
                        [styles.chevronExpanded]: isOpen,
                    })}
                >
                    <polyline
                        points="6 9 12 15 18 9"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {isOpen && (
                <div className={styles.dropdown}>
                    <div className={styles.searchContainer}>
                        <div className={styles.searchInputWrapper}>
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                className={styles.searchIcon}
                            >
                                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
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
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                                                    <path d="M6 12v5c3 3 9 3 12 0v-5" />
                                                </svg>
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
                                            <svg
                                                width="14"
                                                height="14"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                className={styles.sessionIcon}
                                            >
                                                <path
                                                    d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                            <div className={styles.sessionContent}>
                                                <span className={styles.sessionPreview}>
                                                    {session.title || session.preview}
                                                </span>
                                                <span className={styles.sessionMeta}>
                                                    {session.messageCount} messages · {formatRelativeTime(session.lastActivity)}
                                                </span>
                                            </div>
                                            {session.id === activeSessionId && (
                                                <svg
                                                    width="16"
                                                    height="16"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    className={styles.checkIcon}
                                                >
                                                    <polyline
                                                        points="20 6 9 17 4 12"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
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
