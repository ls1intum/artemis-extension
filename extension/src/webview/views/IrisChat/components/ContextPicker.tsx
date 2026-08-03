import clsx from 'clsx';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Check from 'lucide-react/dist/esm/icons/check';
import File from 'lucide-react/dist/esm/icons/file';
import Search from 'lucide-react/dist/esm/icons/search';
import { useMemo, useRef, useState } from 'react';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { usePopoverKeyDown } from '@webview/hooks/usePopoverKeyDown';
import { compareExercisesForPicker } from '@webview/views/IrisChat/pickerSort';
import type { ContentState, ContextItem, ConversationTopic } from '@webview/views/IrisChat/types';

import styles from './ContextPicker.module.css';

interface ContextPickerProps {
    onClose?: () => void;
    exercises: ContextItem[];
    /** The course the picker is scoped to. There are no cross-course entries. */
    courseId: number;
    committedContext?: ConversationTopic;
    pendingContext?: ConversationTopic;
    contentState?: ContentState;
    sendInFlight?: boolean;
    /** Pinned and badged in the list when it belongs to this course. */
    workspaceExerciseId?: number | null;
    onSelect: (topic: ConversationTopic) => void;
}

/**
 * The topic picker: "Course chat" as a fixed first entry, then this course's
 * exercises with the workspace one pinned and badged. One checkmark, on
 * `pending ?? committed`.
 *
 * No cross-course entries. The host rejects a cross-course topic change
 * outright, so such a pick could never be a staging, and folding a course
 * navigation into this menu would make one click mean two different things.
 */
export function ContextPicker({
    courseId,
    exercises,
    committedContext,
    pendingContext,
    contentState = 'unknown',
    sendInFlight = false,
    workspaceExerciseId = null,
    onSelect,
    onClose,
}: ContextPickerProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);

    useClickOutside(dialogRef, true, () => onClose?.());
    const handleKeyDown = usePopoverKeyDown(dialogRef, () => onClose?.());

    // The chip shows `pending ?? committed`, and so does the checkmark: the
    // two must never disagree about what the topic currently is.
    const selected = pendingContext ?? committedContext;
    // A pick always stages into the OPEN conversation, so there is no
    // consequence to warn about. 'unknown' is still disabled: without the
    // transcript we cannot tell a real change from a no-op. An in-flight send
    // owns the conversation until it resolves.
    const entriesDisabled = contentState === 'unknown' || sendInFlight;

    const q = searchQuery.trim().toLowerCase();

    const courseExercises = useMemo(
        () => exercises
            .filter((ex) => ex.courseId === courseId)
            .map((ex) => ({ ...ex, isWorkspace: ex.isWorkspace || ex.id === workspaceExerciseId }))
            .sort(compareExercisesForPicker),
        [exercises, courseId, workspaceExerciseId],
    );

    const visibleExercises = q.length === 0
        ? courseExercises
        : courseExercises.filter((ex) => ex.title.toLowerCase().includes(q)
            || (ex.shortName ?? '').toLowerCase().includes(q));
    const showCourseChat = q.length === 0 || 'course chat'.includes(q);

    const isSelected = (mode: string, entityId: number) =>
        selected?.mode === mode && selected.entityId === entityId;

    return (
        <div
            ref={dialogRef}
            className={styles.dialogUp}
            role="dialog"
            aria-label="Select topic"
            aria-modal="true"
            onKeyDown={handleKeyDown}
        >
            <div className={styles.searchWrapper}>
                <Search size={14} className={styles.searchIcon} />
                <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Search topics…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                />
            </div>

            <div className={styles.list}>
                {showCourseChat && (
                    <button
                        type="button"
                        className={clsx(styles.row, { [styles.rowActive]: isSelected('COURSE_CHAT', courseId) })}
                        data-testid="picker-entry-course"
                        aria-current={isSelected('COURSE_CHAT', courseId) || undefined}
                        disabled={entriesDisabled}
                        onClick={() => onSelect({ mode: 'COURSE_CHAT', entityId: courseId })}
                    >
                        <BookOpen size={16} className={styles.rowIcon} />
                        <span className={styles.rowText}>Course chat</span>
                        {isSelected('COURSE_CHAT', courseId) && <Check size={16} className={styles.checkIcon} />}
                    </button>
                )}

                {visibleExercises.map((exercise) => {
                    const active = isSelected('PROGRAMMING_EXERCISE_CHAT', exercise.id);
                    return (
                        <button
                            key={exercise.id}
                            type="button"
                            className={clsx(styles.row, { [styles.rowActive]: active })}
                            data-testid={`picker-entry-${exercise.id}`}
                            aria-current={active || undefined}
                            disabled={entriesDisabled}
                            onClick={() => onSelect({
                                mode: 'PROGRAMMING_EXERCISE_CHAT',
                                entityId: exercise.id,
                                name: exercise.title,
                            })}
                        >
                            <File size={16} className={styles.rowIcon} />
                            <span className={styles.rowText}>
                                {exercise.title}
                                {exercise.isWorkspace && <span className={styles.badge}>Workspace</span>}
                            </span>
                            {active && <Check size={16} className={styles.checkIcon} />}
                        </button>
                    );
                })}

                {!showCourseChat && visibleExercises.length === 0 && (
                    <div className={styles.emptyState}>No topics found</div>
                )}
            </div>
        </div>
    );
}
