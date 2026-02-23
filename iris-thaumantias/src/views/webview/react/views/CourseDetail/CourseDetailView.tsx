import { useEffect } from 'react';
import { useCourseDetailStore } from '../../stores/useCourseDetailStore';
import { useNavigationStore } from '../../stores/useNavigationStore';
import type { CourseDetailViewProps, CourseDetailPersistedState } from './types';
import type { Exercise, Exam } from '../../../../../shared/messageContracts';
import {
    BackLink,
    IconButton,
    TextInput,
    Dropdown,
    Button,
    Container,
    ListItem,
    Badge,
    SkeletonList,
    ErrorMessage,
    AskIris,
    EmptyState,
} from '../../components';
import type { DropdownOption } from '../../components';
import styles from './CourseDetailView.module.css';

export function CourseDetailView({ vscodeApi }: CourseDetailViewProps) {
    const {
        courseData,
        workspaceExerciseId,
        isLoading,
        error,
        exerciseSearchTerm,
        exerciseSortBy,
        setCourseData,
        setExerciseSearchTerm,
        setExerciseSortBy,
        loadCourseDetail,
        filteredExercises,
        sortedExams,
    } = useCourseDetailStore();

    const { pushBreadcrumb, clearBreadcrumbs } = useNavigationStore();

    // Restore persisted state and load data on mount
    useEffect(() => {
        const persistedState = vscodeApi.getState<CourseDetailPersistedState>();
        if (persistedState) {
            if (persistedState.exerciseSearchTerm) setExerciseSearchTerm(persistedState.exerciseSearchTerm);
            if (persistedState.exerciseSortBy) setExerciseSortBy(persistedState.exerciseSortBy);
        }

        // Clear breadcrumbs and rebuild
        clearBreadcrumbs();
        pushBreadcrumb('Dashboard', 'dashboard', () => {
            vscodeApi.postMessage({ type: 'command', command: 'backToDashboard' });
        });

        // Listen for courseDetailInit messages
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            // Handle typed message format
            if (message.type === 'courseDetailInit') {
                setCourseData(message.payload.courseData, message.payload.workspaceExerciseId);

                // Push course breadcrumb
                const courseTitle = message.payload.courseData?.course?.title || 'Course';
                const abbreviatedTitle = courseTitle.length > 20 ? courseTitle.substring(0, 17) + '...' : courseTitle;
                pushBreadcrumb(abbreviatedTitle, 'course-detail', () => {
                    // Current page, no action
                });
            }

            // Handle legacy message format for backward compatibility
            if (message.command === 'courseDetailInit') {
                setCourseData(message.courseData, message.workspaceExerciseId);

                // Push course breadcrumb
                const courseTitle = message.courseData?.course?.title || 'Course';
                const abbreviatedTitle = courseTitle.length > 20 ? courseTitle.substring(0, 17) + '...' : courseTitle;
                pushBreadcrumb(abbreviatedTitle, 'course-detail', () => {
                    // Current page, no action
                });
            }
        };

        window.addEventListener('message', handleMessage);

        // Request initial data
        vscodeApi.postMessage({ type: 'ready' });

        return () => window.removeEventListener('message', handleMessage);
    }, [vscodeApi, setCourseData, setExerciseSearchTerm, setExerciseSortBy, pushBreadcrumb, clearBreadcrumbs]);

    // Persist search/sort state whenever it changes
    useEffect(() => {
        const state: CourseDetailPersistedState = {
            exerciseSearchTerm,
            exerciseSortBy,
        };
        vscodeApi.setState(state);
    }, [exerciseSearchTerm, exerciseSortBy, vscodeApi]);

    const handleBackToDashboard = () => {
        vscodeApi.postMessage({ type: 'command', command: 'backToDashboard' });
    };

    const handleReload = () => {
        if (courseData?.course.id) {
            loadCourseDetail(vscodeApi, courseData.course.id);
        }
    };

    const handleFullscreen = () => {
        vscodeApi.postMessage({ type: 'command', command: 'toggleCourseFullscreen' });
    };

    const handleSettings = () => {
        vscodeApi.postMessage({ type: 'command', command: 'openSettings' });
    };

    const handleOpenExercise = (exerciseId: number) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'openExerciseDetails',
            payload: { exerciseId },
        });
    };

    const handleOpenExam = (examId: number, courseId: number) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'openExam',
            payload: { examId, courseId },
        });
    };

    const handleAskIris = () => {
        if (courseData?.course) {
            vscodeApi.postMessage({
                type: 'command',
                command: 'askIrisAboutCourse',
                payload: {
                    courseId: courseData.course.id,
                    courseTitle: courseData.course.title,
                    courseShortName: courseData.course.shortName,
                },
            });
        }
    };

    const handleOpenRawJSON = () => {
        if (courseData) {
            vscodeApi.postMessage({
                type: 'command',
                command: 'openInEditor',
                payload: { data: courseData },
            });
        }
    };

    const handleCopyCourseData = () => {
        if (courseData) {
            vscodeApi.postMessage({
                type: 'command',
                command: 'copyToClipboard',
                payload: { text: JSON.stringify(courseData, null, 2) },
            });
        }
    };

    // Sort options for exercises
    const sortOptions: DropdownOption[] = [
        { value: 'id-desc', label: 'Latest Added' },
        { value: 'id-asc', label: 'Oldest Added' },
        { value: 'title-asc', label: 'Title A-Z' },
        { value: 'title-desc', label: 'Title Z-A' },
        { value: 'due-asc', label: 'Due Date Earliest' },
        { value: 'due-desc', label: 'Due Date Latest' },
        { value: 'points-asc', label: 'Points Low-High' },
        { value: 'points-desc', label: 'Points High-Low' },
    ];

    const course = courseData?.course;
    const exercises = filteredExercises();
    const exams = sortedExams();

    // Check developer mode from init message (stored in courseData metadata)
    const hideDeveloperTools = (courseData as any)?.hideDeveloperTools ?? true;
    const showDeveloperTools = !hideDeveloperTools;

    // Calculate exam status for collapsible behavior
    const hasActiveExam = exams.some((exam) => {
        const now = new Date().getTime();
        const start = exam.startDate ? new Date(exam.startDate).getTime() : 0;
        const end = exam.endDate ? new Date(exam.endDate).getTime() : 0;
        return now >= start && now <= end;
    });

    // Exercise type icon mapping (legacy IconDefinitions.getIcon)
    const getExerciseIcon = (type: string): string => {
        switch (type?.toLowerCase()) {
            case 'programming':
                return '💻';
            case 'modeling':
                return '📐';
            case 'quiz':
                return '❓';
            case 'text':
                return '📝';
            case 'file-upload':
                return '📤';
            default:
                return '📄';
        }
    };

    const formatDate = (dateString?: string): string => {
        if (!dateString) return 'No date';
        return new Date(dateString).toLocaleDateString();
    };

    const formatDateTime = (dateString?: string): string => {
        if (!dateString) return 'No date';
        return new Date(dateString).toLocaleString();
    };

    return (
        <div className={styles.courseDetailContainer}>
            <div className={styles.backLinkContainer}>
                <BackLink onClick={handleBackToDashboard}>Back to Dashboard</BackLink>
                <div className={styles.controls}>
                    <IconButton.Reload onClick={handleReload} loading={isLoading} />
                    <IconButton.Fullscreen onClick={handleFullscreen} />
                    <IconButton.Settings onClick={handleSettings} />
                </div>
            </div>

            {error && (
                <ErrorMessage
                    error={error}
                    onRetry={handleReload}
                />
            )}

            {isLoading && !courseData && (
                <SkeletonList count={5} />
            )}

            {!isLoading && !courseData && !error && (
                <EmptyState
                    title="No course selected"
                    message="Select a course to view its details"
                />
            )}

            {courseData && course && (
                <>
                    {/* Course Header */}
                    <Container className={styles.courseHeaderContainer}>
                        <div
                            className={styles.courseColorIndicator}
                            style={{ backgroundColor: course.color || '#6c757d' }}
                        />
                        <div className={styles.courseHeader}>
                            <div className={styles.courseTitleRow}>
                                <h1 className={styles.courseTitle}>{course.title}</h1>
                                {course.semester && <Badge variant="muted">{course.semester}</Badge>}
                            </div>
                            {course.description && (
                                <p className={styles.courseDescription}>{course.description}</p>
                            )}
                            <div className={styles.courseStats}>
                                <span className={styles.statItem}>
                                    {course.exercises?.length || 0} exercises
                                </span>
                                {course.numberOfStudents !== undefined && (
                                    <span className={styles.statItem}>
                                        {course.numberOfStudents} students
                                    </span>
                                )}
                                {course.instructorGroupName && (
                                    <span className={styles.statItem}>{course.instructorGroupName}</span>
                                )}
                                <span className={styles.statItem}>ID: {course.id}</span>
                            </div>
                        </div>
                    </Container>

                    {/* Ask Iris Section */}
                    <div className={styles.irisSection}>
                        <AskIris
                            label="Ask Iris about this course"
                            onClick={handleAskIris}
                        />
                    </div>

                    {/* Exams Section */}
                    {exams.length > 0 && (
                        <Container
                            header={
                                <div className={styles.sectionHeader}>
                                    <h2 className={styles.sectionTitle}>Exams</h2>
                                    <Badge variant="muted">{exams.length.toString()}</Badge>
                                </div>
                            }
                        >
                            <div className={styles.examList}>
                                {exams.map((exam: Exam) => {
                                    const now = new Date().getTime();
                                    const start = exam.startDate ? new Date(exam.startDate).getTime() : 0;
                                    const end = exam.endDate ? new Date(exam.endDate).getTime() : 0;
                                    const isActive = now >= start && now <= end;

                                    return (
                                        <ListItem
                                            key={exam.id}
                                            className={styles.examItem}
                                            onClick={() => handleOpenExam(exam.id, course.id)}
                                            selected={isActive}
                                        >
                                            <div className={styles.examHeader}>
                                                <span className={styles.examTitle}>{exam.title || 'Untitled Exam'}</span>
                                                {isActive && <Badge variant="info">Active</Badge>}
                                            </div>
                                            <div className={styles.examInfo}>
                                                <span>{formatDateTime(exam.startDate)} - {formatDateTime(exam.endDate)}</span>
                                            </div>
                                        </ListItem>
                                    );
                                })}
                            </div>
                        </Container>
                    )}

                    {/* Exercises Section */}
                    <Container
                        header={
                            <div className={styles.sectionHeader}>
                                <h2 className={styles.sectionTitle}>Exercises</h2>
                                <Badge variant="muted">{(course.exercises?.length || 0).toString()}</Badge>
                            </div>
                        }
                    >
                        <div className={styles.exerciseSearch}>
                            <div className={styles.searchInputWrapper}>
                                <TextInput
                                    type="search"
                                    placeholder="Search exercises..."
                                    value={exerciseSearchTerm}
                                    onChange={setExerciseSearchTerm}
                                />
                            </div>
                            <Dropdown
                                value={exerciseSortBy}
                                options={sortOptions}
                                onChange={setExerciseSortBy}
                            />
                        </div>

                        {exercises.length === 0 && exerciseSearchTerm && (
                            <div className={styles.noExercisesFound}>
                                No exercises found matching your search
                            </div>
                        )}

                        {exercises.length === 0 && !exerciseSearchTerm && (
                            <div className={styles.noExercises}>
                                {course.isArchived
                                    ? 'No exercises available for this archived course'
                                    : 'No exercises available'}
                            </div>
                        )}

                        {exercises.length > 0 && (
                            <div className={styles.exercisesList}>
                                {exercises.map((exercise: Exercise) => {
                                    const isWorkspaceExercise = exercise.id === workspaceExerciseId;
                                    const points = (exercise as any).maxPoints || 0;

                                    return (
                                        <ListItem
                                            key={exercise.id}
                                            className={styles.exerciseItem}
                                            onClick={() => handleOpenExercise(exercise.id!)}
                                            selected={isWorkspaceExercise}
                                        >
                                            <div className={styles.exerciseHeader}>
                                                <span className={styles.exerciseTypeIcon}>
                                                    {getExerciseIcon(exercise.type || '')}
                                                </span>
                                                <span className={styles.exerciseTitle}>
                                                    {exercise.title || 'Untitled Exercise'}
                                                </span>
                                                {isWorkspaceExercise && (
                                                    <Badge variant="info">Open</Badge>
                                                )}
                                            </div>
                                            <div className={styles.exerciseInfo}>
                                                <span>Due: {formatDate(exercise.dueDate)}</span>
                                                <span>{points} {points === 1 ? 'point' : 'points'}</span>
                                            </div>
                                        </ListItem>
                                    );
                                })}
                            </div>
                        )}
                    </Container>

                    {/* Developer Tools (conditional) */}
                    {showDeveloperTools && (
                        <Container>
                            <div className={styles.actionButtons}>
                                <Button onClick={handleOpenRawJSON} variant="secondary">
                                    Open Raw JSON
                                </Button>
                                <Button onClick={handleCopyCourseData} variant="secondary">
                                    Copy Course Data
                                </Button>
                            </div>
                        </Container>
                    )}
                </>
            )}
        </div>
    );
}
