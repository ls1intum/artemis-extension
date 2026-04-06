import { useState, useRef } from 'react';
import clsx from 'clsx';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { formatRelativeTime } from '../../../utils/formatRelativeTime';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import type { ChatContext, ChatSession, ContextItem } from '../types';
import type { ChatContextType } from '../../../../shared/types/context';
import styles from './ContextSelector.module.css';

interface ContextSelectorProps {
    context: ChatContext | null;
    sessions: ChatSession[];
    activeSessionId: string | null;
    recentExercises: ContextItem[];
    recentCourses: ContextItem[];
    allExercises: ContextItem[];
    allCourses: ContextItem[];
    forceContextPicker: boolean;
    onSelectContext: (type: ChatContextType, id: number, title: string, shortName?: string) => void;
    onSelectSession: (sessionId: string) => void;
    onCreateNewSession: () => void;
    onSwitchToWorkspace: () => void;
    onSwitchContext: () => void;
}

export function ContextSelector({
    context,
    sessions,
    activeSessionId,
    recentExercises,
    recentCourses,
    allExercises,
    allCourses,
    forceContextPicker,
    onSelectContext,
    onSelectSession,
    onCreateNewSession,
    onSwitchToWorkspace,
    onSwitchContext,
}: ContextSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useClickOutside(containerRef, isOpen, () => {
        setIsOpen(false);
        setSearchQuery('');
    });

    const toggleDropdown = () => {
        setIsOpen(!isOpen);
        if (isOpen) {
            setSearchQuery('');
        }
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

    const handleSwitchContext = () => {
        onSwitchContext();
    };

    // Check if we should show context picker
    const showContextPicker = !context || forceContextPicker || searchQuery.length > 0;

    // Filter exercises and courses based on search
    const filteredExercises = searchQuery
        ? allExercises.filter((ex) =>
              ex.title.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : recentExercises.slice(0, 3);

    const filteredCourses = searchQuery
        ? allCourses.filter((c) =>
              c.title.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : recentCourses.slice(0, 3);

    // Check if there's a workspace exercise
    const hasWorkspaceExercise = allExercises.some((ex) => ex.isWorkspace);
    const isInWorkspaceContext = context?.source === 'workspace-detected';

    // Check if new session should be disabled (no messages in current session)
    const canCreateNewSession = sessions.length > 0 && sessions.some(s => s.messageCount > 0);

    const messageCount = context
        ? sessions.find((s) => s.id === activeSessionId)?.messageCount || 0
        : 0;

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
                            {context?.title || 'Select context'}
                        </span>
                        <span className={styles.subtitle}>
                            {messageCount} message{messageCount !== 1 ? 's' : ''}
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
                    {/* Search input - always shown */}
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
                        {showContextPicker ? (
                            /* Context Picker Mode */
                            <>
                                {filteredExercises.length > 0 && (
                                    <div className={styles.section}>
                                        <div className={styles.sectionHeader}>
                                            Recent Exercises
                                        </div>
                                        {filteredExercises.map((exercise) => (
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
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {filteredCourses.length > 0 && (
                                    <div className={styles.section}>
                                        <div className={styles.sectionHeader}>Recent Courses</div>
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
                                )}

                                {filteredExercises.length === 0 &&
                                    filteredCourses.length === 0 && (
                                        <div className={styles.emptyState}>
                                            No exercises or courses found
                                        </div>
                                    )}
                            </>
                        ) : (
                            /* Session List Mode */
                            <>
                                {sessions.length > 0 && (
                                    <div className={styles.section}>
                                        <div className={styles.sectionHeader}>Sessions</div>
                                        {sessions.map((session) => (
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
                                                        {session.preview}
                                                    </span>
                                                    <span className={styles.sessionMeta}>
                                                        {session.messageCount} messages •{' '}
                                                        {formatRelativeTime(session.lastActivity)}
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
                                )}

                                <div className={styles.actions}>
                                    <button
                                        className={styles.actionButton}
                                        onClick={() => {
                                            onCreateNewSession();
                                            setIsOpen(false);
                                        }}
                                        disabled={!canCreateNewSession}
                                    >
                                        <span className={styles.actionButtonContent}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="12" y1="5" x2="12" y2="19" />
                                                <line x1="5" y1="12" x2="19" y2="12" />
                                            </svg>
                                            New Conversation
                                        </span>
                                    </button>
                                    {hasWorkspaceExercise && (
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
                                                {isInWorkspaceContext ? 'Workspace Exercise (Active)' : 'Chat about Workspace Exercise (Currently Open)'}
                                            </span>
                                        </button>
                                    )}
                                    <button
                                        className={styles.actionButton}
                                        onClick={handleSwitchContext}
                                    >
                                        <span className={styles.actionButtonContent}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="17 1 21 5 17 9" />
                                                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                                                <polyline points="7 23 3 19 7 15" />
                                                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                                            </svg>
                                            Switch to Different Context
                                        </span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
