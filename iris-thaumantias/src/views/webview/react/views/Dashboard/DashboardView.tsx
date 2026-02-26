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
import GraduationCap from 'lucide-react/dist/esm/icons/graduation-cap';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Puzzle from 'lucide-react/dist/esm/icons/puzzle';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import HeartPulse from 'lucide-react/dist/esm/icons/heart-pulse';
import Activity from 'lucide-react/dist/esm/icons/activity';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import Bug from 'lucide-react/dist/esm/icons/bug';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
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
        const handleMessage = (event: MessageEvent<unknown>) => {
            const message = event.data;

            if (typeof message !== 'object' || message === null || !('type' in message)) {
                return;
            }

            const typedMessage = message as Record<string, unknown> & { type: string };

            // Handle typed message format
            if (typedMessage.type === 'dashboardInit') {
                const payload = typedMessage.payload as { courses?: RecentCourseNode[]; workspaceExercise?: { id: number; title: string } } | undefined;
                setDashboardData(payload?.courses ?? []);
                if (payload?.workspaceExercise) {
                    setWorkspaceExercise({
                        id: payload.workspaceExercise.id,
                        title: payload.workspaceExercise.title,
                    });
                }
            } else if (typedMessage.type === 'workspaceExerciseDetected') {
                const payload = typedMessage.payload as { exerciseId?: number; exerciseTitle?: string } | null;
                if (payload && typeof payload.exerciseId === 'number' && typeof payload.exerciseTitle === 'string') {
                    setWorkspaceExercise({
                        id: payload.exerciseId,
                        title: payload.exerciseTitle,
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
            payload: { courseData: courseData as any },
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
                                            <ChevronRight size={12} className={styles.courseExpandIcon} />
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
                    <Button variant="ghost" fullWidth onClick={handleBrowseCourses} icon={<GraduationCap size={16} />}>
                        Browse Courses
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenSettings} icon={<Settings size={16} />}>
                        Open Settings
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowAiConfig} icon={<Sparkles size={16} />}>
                        AI Checker
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowRecommendedExtensions} icon={<Puzzle size={16} />}>
                        Recommended Extensions
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenWebsite} icon={<ExternalLink size={16} />}>
                        Open Artemis in browser
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowStruggleDetection} icon={<HeartPulse size={16} />}>
                        Struggle Detection
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowServiceStatus} icon={<Activity size={16} />}>
                        Service Status
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleShowGitCredentials} icon={<GitBranch size={16} />}>
                        Git Credentials
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenBugReport} icon={<Bug size={16} />}>
                        Bug Report
                    </Button>

                    <div className={styles.actionMenuDivider} />

                    <Button variant="ghost" fullWidth onClick={handleLogout} className={styles.btnDangerGhost} icon={<LogOut size={16} />}>
                        Logout from Artemis
                    </Button>
                </div>
            </Container>
        </div>
    );
}
