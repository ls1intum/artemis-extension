import { useEffect } from 'react';
import { useCourseDetailStore } from '../../stores/useCourseDetailStore';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import type { CourseDetailViewProps, CourseDetailPersistedState } from './types';
import { ExtensionMsg, postCommand, requestInit } from '../../../../../shared/messageContracts';
import type { Exercise, Exam } from '../../../../../shared/messageContracts';
import { getIcon } from '../../../../../utils/iconMap';
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
    AskIris,
    EmptyState,
    PageHeader,
} from '../../components';
import type { DropdownOption } from '../../components';
import { formatDate, formatDateTime } from '../../utils/formatDate';
import styles from './CourseDetailView.module.css';

export function CourseDetailView({ vscodeApi }: CourseDetailViewProps) {
    const {
        courseData,
        workspaceExerciseId,
        hideDeveloperTools,
        isLoading,
        exerciseSearchTerm,
        exerciseSortBy,
        setCourseData,
        setExerciseSearchTerm,
        setExerciseSortBy,
        loadCourseDetail,
        filteredExercises,
        sortedExams,
    } = useCourseDetailStore();

    // Restore persisted state on mount
    useEffect(() => {
        const persistedState = vscodeApi.getState<CourseDetailPersistedState>();
        if (persistedState) {
            if (persistedState.exerciseSearchTerm) {setExerciseSearchTerm(persistedState.exerciseSearchTerm);}
            if (persistedState.exerciseSortBy) {setExerciseSortBy(persistedState.exerciseSortBy);}
        }
    }, [vscodeApi, setExerciseSearchTerm, setExerciseSortBy]);

    // Listen for courseDetailInit messages
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.CourseDetailInit) {
            setCourseData(msg.courseData, msg.workspaceExerciseId, msg.hideDeveloperTools);
        }
    }, [vscodeApi, setCourseData]);

    // Persist search/sort state whenever it changes
    useEffect(() => {
        const state: CourseDetailPersistedState = {
            exerciseSearchTerm,
            exerciseSortBy,
        };
        vscodeApi.setState(state);
    }, [exerciseSearchTerm, exerciseSortBy, vscodeApi]);

    const handleBackToDashboard = () => {
        postCommand(vscodeApi, 'backToDashboard');
    };

    const handleReload = () => {
        if (courseData?.course.id) {
            loadCourseDetail(vscodeApi, courseData.course.id);
        } else {
            requestInit(vscodeApi);
        }
    };

    const handleFullscreen = () => {
        postCommand(vscodeApi, 'toggleCourseFullscreen');
    };

    const handleSettings = () => {
        postCommand(vscodeApi, 'openSettings', { setting: 'Artemis' });
    };

    const handleOpenExercise = (exerciseId: number) => {
        postCommand(vscodeApi, 'openExerciseDetails', { exerciseId });
    };

    const handleOpenExam = (examId: number, courseId: number) => {
        postCommand(vscodeApi, 'openExam', { examId, courseId });
    };

    const handleAskIris = () => {
        if (courseData?.course) {
            postCommand(vscodeApi, 'askIrisAboutCourse', {
                courseId: courseData.course.id,
                courseTitle: courseData.course.title,
                courseShortName: courseData.course.shortName,
            });
        }
    };

    const handleOpenRawJSON = () => {
        if (courseData) {
            postCommand(vscodeApi, 'openInEditor', { data: JSON.parse(JSON.stringify(courseData)) as Record<string, unknown> });
        }
    };

    const handleCopyCourseData = () => {
        if (courseData) {
            postCommand(vscodeApi, 'copyToClipboard', { text: JSON.stringify(courseData, null, 2) });
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

    const backLinkActions = (
        <>
            <IconButton.Reload onClick={handleReload} loading={isLoading} />
            <IconButton.Fullscreen onClick={handleFullscreen} />
            <IconButton.Settings onClick={handleSettings} />
        </>
    );

    // Loading state (no data yet)
    if (isLoading && !courseData) {
        return (
            <div className={styles.courseDetailContainer}>
                <BackLink onClick={handleBackToDashboard} actions={backLinkActions}>Back to Dashboard</BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Empty state
    if (!courseData || !courseData.course) {
        return (
            <div className={styles.courseDetailContainer}>
                <BackLink onClick={handleBackToDashboard} actions={backLinkActions}>Back to Dashboard</BackLink>
                <EmptyState
                    title="No course selected"
                    message="Select a course to view its details"
                />
            </div>
        );
    }

    const course = courseData.course;
    const exercises = filteredExercises();
    const exams = sortedExams();

    const showDeveloperTools = !hideDeveloperTools;

    // Calculate exam status for collapsible behavior
    const hasActiveExam = exams.some((exam) => {
        const now = new Date().getTime();
        const start = exam.startDate ? new Date(exam.startDate).getTime() : 0;
        const end = exam.endDate ? new Date(exam.endDate).getTime() : 0;
        return now >= start && now <= end;
    });


    return (
        <div className={styles.courseDetailContainer}>
            <BackLink onClick={handleBackToDashboard} actions={backLinkActions}>Back to Dashboard</BackLink>

            {/* Course Header */}
            <PageHeader
                title={course.title}
                subtitle={course.description}
            >
                <div className={styles.courseStats}>
                    {course.semester && <Badge variant="muted">{course.semester}</Badge>}
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
            </PageHeader>

            {/* Ask Iris Section */}
            <AskIris
                description="Open the Iris chat to discuss this course or get guidance."
                onClick={handleAskIris}
            />

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
                            interface ExerciseWithPoints {
                                maxPoints?: number;
                            }
                            const points = (exercise as ExerciseWithPoints).maxPoints || 0;

                            return (
                                <ListItem
                                    key={exercise.id}
                                    className={styles.exerciseItem}
                                    onClick={() => handleOpenExercise(exercise.id!)}
                                    selected={isWorkspaceExercise}
                                >
                                    <div className={styles.exerciseHeader}>
                                        <span className={styles.exerciseTypeIcon}>
                                            {(() => {
                                                const ExerciseIcon = getIcon(exercise.type);
                                                return <ExerciseIcon size={16} />;
                                            })()}
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
        </div>
    );
}
