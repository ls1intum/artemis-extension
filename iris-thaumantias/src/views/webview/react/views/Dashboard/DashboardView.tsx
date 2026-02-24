import { useEffect, useState } from 'react';
import { useDashboardStore } from '../../stores/useDashboardStore';
import type { DashboardViewProps, RecentCourseNode, Exercise } from './types';
import {
    Container,
    Button,
    IconButton,
    ListItem,
    SkeletonList,
    ErrorMessage,
} from '../../components';
import styles from './DashboardView.module.css';

export function DashboardView({ vscodeApi }: DashboardViewProps) {
    const {
        recentCourses,
        workspaceExercise,
        isLoading,
        error,
        loadDashboard,
        setDashboardData,
        setWorkspaceExercise,
        setError,
    } = useDashboardStore();

    const [expandedCourses, setExpandedCourses] = useState<Set<number>>(new Set([0]));

    // Load dashboard data on mount
    useEffect(() => {
        // Listen for dashboard messages
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            // Handle typed message format
            if (message.type === 'dashboardInit') {
                setDashboardData(message.payload.courses || []);
                if (message.payload.workspaceExercise) {
                    setWorkspaceExercise({
                        id: message.payload.workspaceExercise.id,
                        title: message.payload.workspaceExercise.title,
                    });
                }
            } else if (message.type === 'workspaceExerciseDetected') {
                if (message.payload) {
                    setWorkspaceExercise({
                        id: message.payload.exerciseId,
                        title: message.payload.exerciseTitle,
                    });
                } else {
                    setWorkspaceExercise(null);
                }
            }

            // Handle legacy message format for backward compatibility
            if (message.command === 'workspaceExerciseDetected') {
                if (message.exerciseId && message.exerciseTitle) {
                    setWorkspaceExercise({
                        id: message.exerciseId,
                        title: message.exerciseTitle,
                    });
                } else {
                    setWorkspaceExercise(null);
                }
            }
        };

        window.addEventListener('message', handleMessage);

        // Send ready signal to trigger init data from provider
        vscodeApi.postMessage({ type: 'ready' });

        return () => window.removeEventListener('message', handleMessage);
    }, [vscodeApi, setDashboardData, setWorkspaceExercise]);

    const handleReloadDashboard = () => {
        loadDashboard(vscodeApi);
    };

    const handleShowAllCourses = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'showAllCourses',
        });
    };

    const handleViewCourseDetails = (courseData: RecentCourseNode) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseData },
        });
    };

    const handleOpenExercise = (exerciseId: number, courseId?: number | null) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'openExercise',
            payload: { exerciseId, courseId },
        });
    };

    const handleOpenWebsite = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'openWebsite',
        });
    };

    const handleBrowseCourses = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'browseCourses',
        });
    };

    const handleOpenSettings = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'openSettings',
        });
    };

    const handleShowAiConfig = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'showAiConfig',
        });
    };

    const handleShowRecommendedExtensions = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'showRecommendedExtensions',
        });
    };

    const handleShowServiceStatus = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'showServiceStatus',
        });
    };

    const handleShowGitCredentials = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'showGitCredentials',
        });
    };

    const handleShowStruggleDetection = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'showStruggleDetection',
        });
    };

    const handleOpenBugReport = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'openBugReport',
        });
    };

    const handleLogout = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'logout',
        });
    };

    const toggleCourseExpanded = (index: number) => {
        setExpandedCourses((prev) => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    if (error) {
        return (
            <div className={styles.dashboard}>
                <ErrorMessage error={error} onRetry={handleReloadDashboard} />
            </div>
        );
    }

    return (
        <div className={styles.dashboard}>
            {/* Welcome Header */}
            <Container className={styles.dashboardHeader}>
                <h1 className={styles.dashboardTitle}>
                    <span>
                        Welcome to{' '}
                        <button
                            type="button"
                            className={styles.artemisTitleLink}
                            onClick={handleOpenWebsite}
                        >
                            Artemis
                        </button>
                    </span>
                </h1>
                <p className={styles.dashboardSubtitle}>Your programming learning companion</p>
            </Container>

            {/* Workspace Exercise Section */}
            {workspaceExercise && (
                <Container
                    className={styles.workspaceExerciseSection}
                    padding="tight"
                    header={<h2 className={styles.sectionTitle}>Current Workspace Exercise</h2>}
                >
                    <ListItem
                        onClick={() => handleOpenExercise(workspaceExercise.id)}
                        className={styles.workspaceExerciseItem}
                    >
                        <div className={styles.workspaceExerciseContent}>
                            <div className={styles.workspaceExerciseName}>
                                {workspaceExercise.title}
                            </div>
                            <div className={styles.workspaceExerciseArrow}>→</div>
                        </div>
                    </ListItem>
                </Container>
            )}

            {/* Recent Courses Section */}
            <Container
                className={styles.recentCourses}
                header={
                    <div className={styles.recentCoursesHeader}>
                        <h2 className={styles.sectionTitle}>Recent Courses</h2>
                        <div className={styles.recentCoursesControls}>
                            <button
                                type="button"
                                className={styles.showAllLink}
                                onClick={handleShowAllCourses}
                            >
                                Show All
                            </button>
                            <IconButton.Reload
                                onClick={handleReloadDashboard}
                                title="Reload Courses"
                            />
                        </div>
                    </div>
                }
            >
                {isLoading ? (
                    <SkeletonList count={3} />
                ) : (
                    <div className={styles.recentCoursesTree}>
                        {recentCourses.map((courseNode, index) => {
                            const isExpanded = expandedCourses.has(index);
                            const course = courseNode.courseData.course;
                            const exercises = courseNode.exercises.slice(0, 4); // Show up to 4 exercises

                            return (
                                <div
                                    key={course.id || index}
                                    className={`${styles.courseNode} ${isExpanded ? styles.isExpanded : ''}`}
                                >
                                    <div className={styles.courseHeader}>
                                        <button
                                            type="button"
                                            className={styles.courseExpandButton}
                                            onClick={() => toggleCourseExpanded(index)}
                                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                        >
                                            <svg
                                                className={styles.courseExpandIcon}
                                                width="12"
                                                height="12"
                                                viewBox="0 0 12 12"
                                            >
                                                <path
                                                    d="M4 2 L8 6 L4 10"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                />
                                            </svg>
                                        </button>
                                        <span className={styles.courseTitle}>{course.title}</span>
                                        <span className={styles.courseExerciseCount}>
                                            {course.exercises?.length || 0} exercises
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.courseArrow}
                                            onClick={() => handleViewCourseDetails(courseNode)}
                                            aria-label="View course details"
                                        >
                                            →
                                        </button>
                                    </div>

                                    {isExpanded && exercises.length > 0 && (
                                        <div className={styles.courseExercises}>
                                            {exercises.map((exercise) => (
                                                <button
                                                    key={exercise.id}
                                                    type="button"
                                                    className={styles.exerciseItem}
                                                    onClick={() =>
                                                        handleOpenExercise(exercise.id!, course.id || null)
                                                    }
                                                >
                                                    <span className={styles.exerciseTitle}>
                                                        {exercise.title}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Container>

            {/* Quick Actions Section */}
            <Container
                className={styles.quickActions}
                header={<h2 className={styles.sectionTitle}>Tools & Settings</h2>}
            >
                <div className={styles.actionMenu}>
                    <Button variant="ghost" fullWidth onClick={handleBrowseCourses}>
                        Browse Courses
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenSettings}>
                        Open Settings
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowAiConfig}>
                        AI Checker
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowRecommendedExtensions}>
                        Recommended Extensions
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenWebsite}>
                        Open Artemis in browser
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowStruggleDetection}>
                        Struggle Detection
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowServiceStatus}>
                        Service Status
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowGitCredentials}>
                        Git Credentials
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenBugReport}>
                        Bug Report
                    </Button>

                    <div className={styles.actionMenuDivider} />

                    <Button variant="ghost" fullWidth onClick={handleLogout} className={styles.btnDangerGhost}>
                        Logout from Artemis
                    </Button>
                </div>
            </Container>
        </div>
    );
}
