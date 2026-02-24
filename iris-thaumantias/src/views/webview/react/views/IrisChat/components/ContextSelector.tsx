import { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { ChatContext, ChatSession, ContextItem } from '../types';
import styles from './ContextSelector.module.css';

interface ContextSelectorProps {
    context: ChatContext | null;
    sessions: ChatSession[];
    activeSessionId: string | null;
    recentExercises: ContextItem[];
    recentCourses: ContextItem[];
    allExercises: ContextItem[];
    allCourses: ContextItem[];
    onSelectContext: (type: string, id: number, title: string, shortName?: string) => void;
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
    onSelectContext,
    onSelectSession,
    onCreateNewSession,
    onSwitchToWorkspace,
    onSwitchContext,
}: ContextSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [forceContextPicker, setForceContextPicker] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
                setSearchQuery('');
                setForceContextPicker(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const toggleDropdown = () => {
        setIsOpen(!isOpen);
        if (isOpen) {
            setSearchQuery('');
            setForceContextPicker(false);
        }
    };

    const handleSelectContext = (
        type: string,
        id: number,
        title: string,
        shortName?: string
    ) => {
        onSelectContext(type, id, title, shortName);
        setIsOpen(false);
        setSearchQuery('');
        setForceContextPicker(false);
    };

    const handleSelectSession = (sessionId: string) => {
        onSelectSession(sessionId);
        setIsOpen(false);
    };

    const handleSwitchContext = () => {
        setForceContextPicker(true);
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

    // Check if new session should be disabled (no messages in current session)
    const canCreateNewSession = sessions.length > 0 && sessions.some(s => s.messageCount > 0);

    const messageCount = context
        ? sessions.find((s) => s.id === activeSessionId)?.messageCount || 0
        : 0;

    return (
        <div ref={containerRef} className={styles.container}>
            <button className={styles.header} onClick={toggleDropdown}>
                <div className={styles.headerContent}>
                    {context?.locked && (
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            className={styles.lockIcon}
                        >
                            <rect
                                x="5"
                                y="11"
                                width="14"
                                height="10"
                                rx="2"
                                stroke="currentColor"
                                strokeWidth="2"
                            />
                            <path
                                d="M7 11V7a5 5 0 0110 0v4"
                                stroke="currentColor"
                                strokeWidth="2"
                            />
                        </svg>
                    )}
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
                        <input
                            type="text"
                            className={styles.searchInput}
                            placeholder="Search exercises or courses..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoFocus
                        />
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
                                                    <svg
                                                        width="14"
                                                        height="14"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        className={styles.itemIcon}
                                                    >
                                                        <rect
                                                            x="5"
                                                            y="11"
                                                            width="14"
                                                            height="10"
                                                            rx="2"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                        />
                                                        <path
                                                            d="M7 11V7a5 5 0 0110 0v4"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                        />
                                                    </svg>
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
                                                <div className={styles.sessionContent}>
                                                    <span className={styles.sessionPreview}>
                                                        {session.preview}
                                                    </span>
                                                    <span className={styles.sessionMeta}>
                                                        {session.messageCount} messages •{' '}
                                                        {formatTime(session.lastActivity)}
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
                                        New Conversation
                                    </button>
                                    {hasWorkspaceExercise && (
                                        <button
                                            className={styles.actionButton}
                                            onClick={() => {
                                                onSwitchToWorkspace();
                                                setIsOpen(false);
                                            }}
                                        >
                                            Switch to Workspace
                                        </button>
                                    )}
                                    <button
                                        className={styles.actionButton}
                                        onClick={handleSwitchContext}
                                    >
                                        Switch to Different Context
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

function formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}
