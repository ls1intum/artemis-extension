import { useState } from 'react';
import { useDashboardStore } from '../../stores/useDashboardStore';
import type { DashboardViewProps, RecentCourseNode, Exercise } from './types';
import type { CourseDashboardCourse } from '../../../../../types/apiResponses';
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
import { getIcon } from '../../../../../utils/iconMap';
import SquareArrowOutUpRight from 'lucide-react/dist/esm/icons/square-arrow-out-up-right';
import { ExtensionMsg, postCommand } from '../../../../../shared/messageContracts';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
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

    // Listen for dashboard messages
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.DashboardInit) {
            setDashboardData(msg.courses ?? []);
            if (msg.workspaceExercise) {
                setWorkspaceExercise({
                    id: msg.workspaceExercise.id,
                    title: msg.workspaceExercise.title,
                });
            }
        } else if (msg.type === ExtensionMsg.WorkspaceExerciseDetected) {
            if (typeof msg.exerciseId === 'number' && typeof msg.exerciseTitle === 'string') {
                setWorkspaceExercise({
                    id: msg.exerciseId,
                    title: msg.exerciseTitle,
                });
            } else {
                setWorkspaceExercise(null);
            }
        }
    }, [vscodeApi, setDashboardData, setWorkspaceExercise]);

    const handleReloadDashboard = () => {
        loadDashboard(vscodeApi);
    };

    const handleShowAllCourses = () => {
        postCommand(vscodeApi, 'showAllCourses');
    };

    const handleViewCourseDetails = (courseData: RecentCourseNode) => {
        postCommand(vscodeApi, 'viewCourseDetails', {
            courseData: courseData.courseData.course as CourseDashboardCourse,
        });
    };

    const handleOpenExercise = (exerciseId: number, courseId?: number | null) => {
        postCommand(vscodeApi, 'openExercise', { exerciseId, courseId });
    };

    const handleOpenWebsite = () => {
        postCommand(vscodeApi, 'openWebsite');
    };

    const handleBrowseCourses = () => {
        postCommand(vscodeApi, 'browseCourses');
    };

    const handleOpenSettings = () => {
        postCommand(vscodeApi, 'openSettings');
    };

    const handleShowAiConfig = () => {
        postCommand(vscodeApi, 'showAiConfig');
    };

    const handleShowRecommendedExtensions = () => {
        postCommand(vscodeApi, 'showRecommendedExtensions');
    };

    const handleShowServiceStatus = () => {
        postCommand(vscodeApi, 'showServiceStatus');
    };

    const handleShowGitCredentials = () => {
        postCommand(vscodeApi, 'showGitCredentials');
    };

    const handleShowStruggleDetection = () => {
        postCommand(vscodeApi, 'showStruggleDetection');
    };

    const handleOpenBugReport = () => {
        postCommand(vscodeApi, 'openBugReport');
    };

    const handleLogout = () => {
        postCommand(vscodeApi, 'logout');
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
                                    <div
                                        className={styles.courseHeader}
                                        onClick={() => toggleCourseExpanded(index)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                toggleCourseExpanded(index);
                                            }
                                        }}
                                    >
                                        <ChevronRight size={12} className={styles.courseExpandIcon} />
                                        <span className={styles.courseTitle}>{course.title}</span>
                                        <button
                                            type="button"
                                            className={styles.courseArrow}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleViewCourseDetails(courseNode);
                                            }}
                                            aria-label="View course details"
                                        >
                                            <SquareArrowOutUpRight size={14} />
                                        </button>
                                    </div>

                                    {isExpanded && exercises.length > 0 && (
                                        <div className={styles.courseExercises}>
                                            {exercises.map((exercise) => {
                                                const ExerciseIcon = getIcon(exercise.type);
                                                return (
                                                    <button
                                                        key={exercise.id}
                                                        type="button"
                                                        className={styles.exerciseItem}
                                                        onClick={() =>
                                                            handleOpenExercise(exercise.id!, course.id || null)
                                                        }
                                                    >
                                                        <ExerciseIcon size={14} className={styles.exerciseIcon} />
                                                        <span className={styles.exerciseTitle}>
                                                            {exercise.title}
                                                        </span>
                                                    </button>
                                                );
                                            })}
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
