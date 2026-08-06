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
     * once the fetch has finished. 'error' means the host could not reach the
     * server and has nothing to show: an empty list then says nothing about
     * the student's enrolment, so it must not be rendered as if it did.
     * 'stale' is the same outage with rows still on screen from an earlier
     * fetch: they stay pickable, above a notice that they are unconfirmed.
     */
    status?: 'loading' | 'ready' | 'error' | 'stale';
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
    /** Asks the host for the list again. Reachable from 'error' and 'stale'. */
    onRetry?: () => void;
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
    onRetry,
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
        // Never take focus off a CHILD the student is already on: a refresh
        // that fails under their hands changes `status`, and the notice's
        // Retry would otherwise pull focus off the row they were reading. The
        // dialog holding focus itself is the fallback, not a destination, so
        // that case still promotes to the first row when the rows arrive.
        const active = document.activeElement;
        if (active !== dialog && dialog.contains(active)) { return; }
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

            {/*
              * Two shapes of the same outage. With no rows the list cannot be
              * read at all, so the failure IS the content. With rows, they were
              * fetched earlier in this session and stay pickable, but they are
              * unconfirmed: a course removed since then would still be listed,
              * which is the defect this picker's live list exists to prevent.
              * Saying so beats both hiding the rows and presenting them as current.
              */}
            {(status === 'error' || status === 'stale') && (
                <div
                    className={status === 'error' ? styles.emptyState : styles.staleNotice}
                    role="alert"
                >
                    <p className={styles.errorText}>
                        {status === 'error'
                            ? 'Could not load your courses. This is usually temporary.'
                            : 'Could not refresh your courses, so this list may be out of date.'}
                    </p>
                    {onRetry && (
                        <button
                            type="button"
                            className={styles.retryButton}
                            aria-label="Retry loading courses"
                            onClick={onRetry}
                        >
                            Retry
                        </button>
                    )}
                </div>
            )}

            {status === 'ready' && sorted.length === 0 && (
                <div className={styles.emptyState}>No courses found</div>
            )}

            {(status === 'ready' || status === 'stale') && sorted.map((course) => {
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
