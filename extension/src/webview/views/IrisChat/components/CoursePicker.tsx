import clsx from 'clsx';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Check from 'lucide-react/dist/esm/icons/check';
import Info from 'lucide-react/dist/esm/icons/info';
import { useEffect, useMemo, useRef } from 'react';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { usePopoverKeyDown } from '@webview/hooks/usePopoverKeyDown';
import { compareCoursesForPicker } from '@webview/views/IrisChat/pickerSort';
import type { ContextItem } from '@webview/views/IrisChat/types';

import styles from './CoursePicker.module.css';

interface CoursePickerProps {
    courses: ContextItem[];
    /** Marked with a checkmark; null before the first course is opened. */
    currentCourseId: number | null;
    /**
     * 'loading' while the dashboard course list is being fetched. On a fresh
     * installation nothing is tracked yet, so an empty list is only meaningful
     * once the fetch has finished.
     */
    status?: 'loading' | 'ready';
    /**
     * 'popover' hangs the list off the header line it belongs to; 'inline'
     * renders it in flow, which is what the cold start needs (there is no
     * header to hang it off, so the list IS the empty transcript).
     */
    variant?: 'popover' | 'inline';
    /** A course switch the host could not carry out. See ConversationHistory. */
    openError?: string | null;
    onSelect: (courseId: number) => void;
    onClose: () => void;
}

/**
 * The student's courses, most-recently-viewed then alphabetical.
 *
 * No per-course conversation counts: the conversation overview is per course,
 * so a count beside every row would cost one request per course on every open,
 * for a number nobody navigates by.
 */
export function CoursePicker({
    courses,
    currentCourseId,
    status = 'ready',
    variant = 'popover',
    openError = null,
    onSelect,
    onClose,
}: CoursePickerProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

    // An inline list is not dismissible: there is nothing behind it to
    // return to, so a click outside must not close it.
    useClickOutside(dialogRef, variant === 'popover', onClose);

    const sorted = useMemo(() => [...courses].sort(compareCoursesForPicker), [courses]);

    // The dialog itself is the fallback focus target, and the effect re-runs
    // when the rows arrive. On a fresh installation the picker opens EMPTY
    // (status 'loading'), so there is no focusable child to take focus; with a
    // one-shot `[]` effect focus stayed outside the dialog entirely, and since
    // the handler below is on the dialog, neither Escape nor the Tab trap ever
    // saw a key. That is exactly the state a first-time student opens it in.
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) { return; }
        (dialog.querySelector<HTMLElement>('button:not(:disabled)') ?? dialog).focus();
    }, [status, sorted.length]);

    const handleKeyDown = usePopoverKeyDown(dialogRef, onClose);

    return (
        <div
            ref={dialogRef}
            // Static lookups only: a dynamic `styles[variant]` survives vitest
            // but resolves to undefined in the camelCaseOnly production bundle.
            className={variant === 'inline' ? styles.dialogInline : styles.dialog}
            role="dialog"
            // Focusable so the dialog can hold focus while it is still loading
            // and has no rows yet. Not reachable by Tab (-1), so it does not
            // join the trap's cycle once the rows arrive.
            tabIndex={-1}
            aria-label="Select course"
            aria-modal={variant === 'popover' ? true : undefined}
            aria-busy={status === 'loading'}
            onKeyDown={handleKeyDown}
        >
            {openError && (
                <div className={styles.errorBanner} role="alert">
                    <Info size={14} />
                    <span>{openError}</span>
                </div>
            )}

            {status === 'loading' && (
                <div className={styles.skeleton}>
                    <div className={styles.skeletonRow} />
                    <div className={styles.skeletonRow} />
                    <div className={styles.skeletonRow} />
                </div>
            )}

            {status === 'ready' && sorted.length === 0 && (
                <div className={styles.emptyState}>No courses found</div>
            )}

            {status === 'ready' && sorted.map((course) => {
                const active = course.id === currentCourseId;
                return (
                    <button
                        key={course.id}
                        type="button"
                        className={clsx(styles.row, { [styles.rowActive]: active })}
                        data-testid={`course-entry-${course.id}`}
                        onClick={() => (active ? onClose() : onSelect(course.id))}
                    >
                        <BookOpen size={16} className={styles.rowIcon} />
                        <span className={styles.rowText}>{course.title}</span>
                        {active && <Check size={16} className={styles.checkIcon} />}
                    </button>
                );
            })}
        </div>
    );
}
