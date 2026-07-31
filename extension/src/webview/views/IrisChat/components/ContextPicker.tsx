import clsx from 'clsx';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Check from 'lucide-react/dist/esm/icons/check';
import File from 'lucide-react/dist/esm/icons/file';
import Search from 'lucide-react/dist/esm/icons/search';
import { useMemo, useRef, useState } from 'react';

import type { ChatContextType } from '@shared/types/context';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { usePopoverKeyDown } from '@webview/hooks/usePopoverKeyDown';
import { compareCoursesForPicker, compareExercisesForPicker } from '@webview/views/IrisChat/pickerSort';
import type {
    ChatContext,
    ContentState,
    ContextItem,
    ConversationSummary,
    ConversationTopic,
} from '@webview/views/IrisChat/types';

import styles from './ContextPicker.module.css';

/** Stated once at the top of the topic picker while the conversation has content. */
const TOPIC_CHANGE_HINT = 'Selecting may open a different conversation.';

interface ContextPickerProps {
    // ---- Pre-conversation-first props. Task 15 deletes them together with
    // the branch that reads them.
    context?: ChatContext | null;
    courses?: ContextItem[];
    onSelectContext?: (type: ChatContextType, id: number, title: string, shortName?: string) => void;
    onClose?: () => void;

    /** Read by both branches. */
    exercises: ContextItem[];

    // ---- Conversation-first props (Task 12). Supplying BOTH `courseId` and
    // `onSelect` switches this popover to the topic picker.
    /** The course the picker is scoped to. There are no cross-course entries. */
    courseId?: number;
    committedContext?: ConversationTopic;
    pendingContext?: ConversationTopic;
    contentState?: ContentState;
    sendInFlight?: boolean;
    /**
     * Accepted so a caller can hand the picker and the history the same prop
     * bag. Deliberately unread: the per-entry outcome labels that would have
     * needed it were cut in favour of one static hint, because computing them
     * here would mean duplicating the host's `resolveTopic` into the webview
     * (which `eslint.config.mjs` forbids importing) and a second
     * implementation can drift, at which point the UI predicts an outcome the
     * host does not produce.
     */
    conversations?: ConversationSummary[];
    /** Pinned and badged in the list when it belongs to this course. */
    workspaceExerciseId?: number | null;
    onSelect?: (topic: ConversationTopic) => void;
}

/**
 * Dispatcher. The two variants are separate components so each keeps its own
 * hooks: flipping between them unmounts one and mounts the other instead of
 * changing hook order inside a single instance.
 */
export function ContextPicker(props: ContextPickerProps) {
    if (props.onSelect && props.courseId !== undefined) {
        return (
            <TopicPicker
                courseId={props.courseId}
                exercises={props.exercises}
                committedContext={props.committedContext}
                pendingContext={props.pendingContext}
                contentState={props.contentState ?? 'unknown'}
                sendInFlight={props.sendInFlight ?? false}
                workspaceExerciseId={props.workspaceExerciseId ?? null}
                onSelect={props.onSelect}
                onClose={props.onClose}
            />
        );
    }
    return (
        <LegacyContextPicker
            context={props.context ?? null}
            exercises={props.exercises}
            courses={props.courses ?? []}
            onSelectContext={props.onSelectContext}
            onClose={props.onClose}
        />
    );
}

interface TopicPickerInnerProps {
    courseId: number;
    exercises: ContextItem[];
    committedContext: ConversationTopic | undefined;
    pendingContext: ConversationTopic | undefined;
    contentState: ContentState;
    sendInFlight: boolean;
    workspaceExerciseId: number | null;
    onSelect: (topic: ConversationTopic) => void;
    onClose: (() => void) | undefined;
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
function TopicPicker({
    courseId,
    exercises,
    committedContext,
    pendingContext,
    contentState,
    sendInFlight,
    workspaceExerciseId,
    onSelect,
    onClose,
}: TopicPickerInnerProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);

    useClickOutside(dialogRef, true, () => onClose?.());
    const handleKeyDown = usePopoverKeyDown(dialogRef, () => onClose?.());

    // The chip shows `pending ?? committed`, and so does the checkmark: the
    // two must never disagree about what the topic currently is.
    const selected = pendingContext ?? committedContext;
    // 'unknown' means we do not know whether the pick would stage in place or
    // navigate, and a picker that cannot state its own consequence must not
    // be usable. An in-flight send owns the conversation until it resolves.
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
            {contentState === 'content' && (
                <div className={styles.hint}>{TOPIC_CHANGE_HINT}</div>
            )}

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

/** True if `context` is the "course chat" for the given course id. */
function isActiveCourseChat(context: ChatContext | null, courseId: number): boolean {
    return context?.type === 'course' && context.id === courseId;
}

/** True if `context` is the given exercise. */
function isActiveExercise(context: ChatContext | null, exerciseId: number): boolean {
    return context?.type === 'exercise' && context.id === exerciseId;
}

interface LegacyContextPickerProps {
    context: ChatContext | null;
    exercises: ContextItem[];
    courses: ContextItem[];
    onSelectContext: ((type: ChatContextType, id: number, title: string, shortName?: string) => void) | undefined;
    onClose: (() => void) | undefined;
}

function LegacyContextPicker({ context, exercises, courses, onSelectContext, onClose }: LegacyContextPickerProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showOtherCourses, setShowOtherCourses] = useState(false);

    useClickOutside(dialogRef, true, () => onClose?.());
    const handleKeyDown = usePopoverKeyDown(dialogRef, () => onClose?.());

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
        onSelectContext?.('exercise', exercise.id, exercise.title, exercise.shortName);
    };

    const handleSelectCourseChat = (course: ContextItem) => {
        onSelectContext?.('course', course.id, course.title, course.shortName);
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
            aria-label="Select course or exercise"
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
