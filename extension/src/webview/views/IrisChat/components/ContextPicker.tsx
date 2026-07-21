import clsx from 'clsx';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Check from 'lucide-react/dist/esm/icons/check';
import File from 'lucide-react/dist/esm/icons/file';
import Search from 'lucide-react/dist/esm/icons/search';
import type { KeyboardEvent } from 'react';
import { useMemo, useRef, useState } from 'react';

import type { ChatContextType } from '@shared/types/context';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { compareCoursesForPicker, compareExercisesForPicker } from '@webview/views/IrisChat/pickerSort';
import type { ChatContext, ContextItem } from '@webview/views/IrisChat/types';

import styles from './ContextPicker.module.css';

interface ContextPickerProps {
    context: ChatContext | null;
    exercises: ContextItem[];
    courses: ContextItem[];
    onSelectContext: (type: ChatContextType, id: number, title: string, shortName?: string) => void;
    onClose: () => void;
}

/** True if `context` is the "course chat" for the given course id. */
function isActiveCourseChat(context: ChatContext | null, courseId: number): boolean {
    return context?.type === 'course' && context.id === courseId;
}

/** True if `context` is the given exercise. */
function isActiveExercise(context: ChatContext | null, exerciseId: number): boolean {
    return context?.type === 'exercise' && context.id === exerciseId;
}

export function ContextPicker({ context, exercises, courses, onSelectContext, onClose }: ContextPickerProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showOtherCourses, setShowOtherCourses] = useState(false);

    useClickOutside(dialogRef, true, onClose);

    const workspaceExercise = useMemo(() => exercises.find(ex => ex.isWorkspace), [exercises]);

    const currentCourseId = useMemo(() => {
        if (context?.type === 'exercise' && context.courseId !== undefined) { return context.courseId; }
        if (context?.type === 'course') { return context.id; }
        if (workspaceExercise?.courseId !== undefined) { return workspaceExercise.courseId; }
        return courses[0]?.id;
    }, [context, workspaceExercise, courses]);

    const currentCourse = useMemo(
        () => courses.find(c => c.id === currentCourseId),
        [courses, currentCourseId]
    );

    const otherCourses = useMemo(
        () => courses.filter(c => c.id !== currentCourseId).sort(compareCoursesForPicker),
        [courses, currentCourseId]
    );

    const currentCourseExercises = useMemo(
        () => exercises.filter(ex => ex.courseId === currentCourseId).sort(compareExercisesForPicker),
        [exercises, currentCourseId]
    );

    const q = searchQuery.trim().toLowerCase();
    const isSearching = q.length > 0;

    // Cross-course search: group matching exercises + matching courses (as
    // course-chat rows) by course, ordered like the retired context dropdown.
    const searchGroups = useMemo(() => {
        if (!isSearching) { return []; }

        const matchingCourseIds = new Set(
            courses.filter(c => c.title.toLowerCase().includes(q) || (c.shortName ?? '').toLowerCase().includes(q))
                .map(c => c.id)
        );

        const exercisesByCourse = new Map<number, ContextItem[]>();
        for (const ex of exercises) {
            const matches = ex.title.toLowerCase().includes(q) || (ex.shortName ?? '').toLowerCase().includes(q);
            if (!matches || ex.courseId === undefined) { continue; }
            const list = exercisesByCourse.get(ex.courseId) ?? [];
            list.push(ex);
            exercisesByCourse.set(ex.courseId, list);
        }

        const involvedCourseIds = new Set<number>([...matchingCourseIds, ...exercisesByCourse.keys()]);

        return courses
            .filter(c => involvedCourseIds.has(c.id))
            .sort(compareCoursesForPicker)
            .map(course => ({
                course,
                showCourseChat: matchingCourseIds.has(course.id),
                courseExercises: (exercisesByCourse.get(course.id) ?? []).sort(compareExercisesForPicker),
            }));
    }, [isSearching, q, courses, exercises]);

    const handleSelectExercise = (exercise: ContextItem) => {
        onSelectContext('exercise', exercise.id, exercise.title, exercise.shortName);
    };

    const handleSelectCourseChat = (course: ContextItem) => {
        onSelectContext('course', course.id, course.title, course.shortName);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab') { return; }

        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button, input, [tabindex]:not([tabindex="-1"])'
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

    const renderExerciseRow = (exercise: ContextItem) => {
        const active = isActiveExercise(context, exercise.id);
        return (
            <button
                key={exercise.id}
                type="button"
                className={clsx(styles.row, { [styles.rowActive]: active })}
                data-testid={active ? 'picker-active' : undefined}
                onClick={() => handleSelectExercise(exercise)}
            >
                <File size={16} className={styles.rowIcon} />
                <span className={styles.rowText} data-testid="picker-exercise">
                    {exercise.title}
                    {exercise.isWorkspace && <span className={styles.badge}>Workspace</span>}
                </span>
                {active && <Check size={16} className={styles.checkIcon} />}
            </button>
        );
    };

    // The "Course chat" row for the currently shown course (default view,
    // and again per-course-header when a search matches a course by name).
    const renderCourseChatRow = (course: ContextItem) => {
        const active = isActiveCourseChat(context, course.id);
        return (
            <button
                key={`course-chat-${course.id}`}
                type="button"
                className={clsx(styles.row, { [styles.rowActive]: active })}
                data-testid={active ? 'picker-active' : undefined}
                onClick={() => handleSelectCourseChat(course)}
            >
                <BookOpen size={16} className={styles.rowIcon} />
                <span className={styles.rowTextColumn}>
                    <span className={styles.rowText}>Course chat</span>
                    <span className={styles.rowSubtitle}>General questions about the course</span>
                </span>
                {active && <Check size={16} className={styles.checkIcon} />}
            </button>
        );
    };

    // A plain course-title row for the "Choose another course…" footer list.
    const renderOtherCourseRow = (course: ContextItem) => {
        const active = isActiveCourseChat(context, course.id);
        return (
            <button
                key={course.id}
                type="button"
                className={clsx(styles.row, { [styles.rowActive]: active })}
                data-testid={active ? 'picker-active' : undefined}
                onClick={() => handleSelectCourseChat(course)}
            >
                <BookOpen size={16} className={styles.rowIcon} />
                <span className={styles.rowText}>{course.title}</span>
                {active && <Check size={16} className={styles.checkIcon} />}
            </button>
        );
    };

    return (
        <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            onKeyDown={handleKeyDown}
        >
            <div className={styles.searchWrapper}>
                <Search size={14} className={styles.searchIcon} />
                <input
                    ref={searchInputRef}
                    type="text"
                    className={styles.searchInput}
                    placeholder="Search course or exercise…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                />
            </div>

            {!isSearching && (
                <div className={styles.list}>
                    {currentCourse && renderCourseChatRow(currentCourse)}

                    {currentCourseExercises.map(renderExerciseRow)}

                    {otherCourses.length > 0 && (
                        <div className={styles.footer}>
                            <button
                                type="button"
                                className={styles.footerButton}
                                onClick={() => setShowOtherCourses(v => !v)}
                            >
                                Choose another course…
                            </button>
                            {showOtherCourses && (
                                <div className={styles.otherCourses}>
                                    {otherCourses.map(renderOtherCourseRow)}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {isSearching && (
                <div className={styles.list}>
                    {searchGroups.length === 0 && (
                        <div className={styles.emptyState}>No exercises or courses found</div>
                    )}
                    {searchGroups.map(({ course, showCourseChat, courseExercises }) => (
                        <div key={course.id} className={styles.group}>
                            <div className={styles.groupHeader}>{course.title}</div>
                            {showCourseChat && renderCourseChatRow(course)}
                            {courseExercises.map(renderExerciseRow)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
