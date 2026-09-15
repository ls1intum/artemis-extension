import Bug from 'lucide-react/dist/esm/icons/bug';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import GraduationCap from 'lucide-react/dist/esm/icons/graduation-cap';
import HeartPulse from 'lucide-react/dist/esm/icons/heart-pulse';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import Settings from 'lucide-react/dist/esm/icons/settings';
import SquareArrowOutUpRight from 'lucide-react/dist/esm/icons/square-arrow-out-up-right';
import { useState } from 'react';

import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { Button, Container, IconButton, ListItem, Skeleton, SkeletonList } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { useDashboardStore } from '@webview/stores/useDashboardStore';
import { getIcon } from '@webview/utils/iconMap';
import { readInjectedUri } from '@webview/utils/injectedUri';

import styles from './DashboardView.module.css';
import type { DashboardViewProps, RecentCourseNode } from './types';

export function DashboardView({ vscodeApi }: DashboardViewProps) {
    const {
        recentCourses,
        workspaceExercise,
        isLoading,
        loadDashboard,
        setDashboardData,
        setWorkspaceExercise,
        hideDeveloperTools,
        setHideDeveloperTools,
    } = useDashboardStore();

    const [expandedCourses, setExpandedCourses] = useState<Set<number>>(new Set([0]));

    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.DashboardInit) {
            setDashboardData(msg.courses ?? []);
            setHideDeveloperTools(msg.hideDeveloperTools);
            // Only update workspace state when detection has actually run
            // (field present as null or object). Absent = detection not run yet.
            if (msg.workspaceExercise !== undefined) {
                setWorkspaceExercise(
                    msg.workspaceExercise
                        ? { id: msg.workspaceExercise.id, title: msg.workspaceExercise.title }
                        : null,
                );
            }
        }
    }, [vscodeApi, setDashboardData, setWorkspaceExercise, setHideDeveloperTools]);

    const handleReloadDashboard = () => {
        loadDashboard(vscodeApi);
    };

    const handleShowAllCourses = () => {
        postCommand(vscodeApi, 'showAllCourses');
    };

    const handleViewCourseDetails = (courseData: RecentCourseNode) => {
        postCommand(vscodeApi, 'viewCourseDetails', {
            courseId: courseData.courseData.course.id,
        });
    };

    const handleOpenExercise = (exerciseId: number, courseId?: number | null) => {
        postCommand(vscodeApi, 'openExercise', { exerciseId, courseId });
    };

    const handleOpenWebsite = () => {
        postCommand(vscodeApi, 'openWebsite');
    };

    const handleOpenSettings = () => {
        postCommand(vscodeApi, 'openSettings', { setting: 'Artemis' });
    };

    const handleShowSubmissionSetup = () => {
        postCommand(vscodeApi, 'showSubmissionSetup');
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

    return (
        <div className={styles.dashboard}>
            <Container>
                <div className={styles.dashboardHeader}>
                    <button
                        type="button"
                        className={styles.artemisLogoLink}
                        onClick={handleOpenWebsite}
                    >
                        <img
                            src={readInjectedUri('logoUri')}
                            alt="Artemis"
                            className={styles.artemisHeaderLogo}
                        />
                    </button>
                    <div className={styles.dashboardHeaderText}>
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
                    </div>
                </div>
            </Container>

            <Container
                className={styles.workspaceExerciseSection}
                padding="tight"
                header={<h2 className={styles.sectionTitle}>Current Workspace Exercise</h2>}
            >
                {workspaceExercise === 'loading' ? (
                    <div className={styles.workspaceExerciseItem}>
                        <Skeleton width="60%" height="16px" />
                    </div>
                ) : workspaceExercise ? (
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
                ) : (
                    <div className={styles.workspaceNotFound}>
                        No exercise detected for this workspace
                    </div>
                )}
            </Container>

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
                            const exercises = courseNode.exercises.slice(0, 4);

                            return (
                                <div
                                    key={course.id || index}
                                    className={`${styles.courseNode} ${isExpanded ? styles.isExpanded : ''}`}
                                >
                                    {/* The row holds two separate actions, expand and open, so the
                                        outer element must not be a button itself: a control nested in
                                        another control is announced unpredictably and traps focus
                                        (axe nested-interactive). The toggle fills the row instead. */}
                                    <div className={styles.courseHeader}>
                                        <button
                                            type="button"
                                            className={styles.courseToggle}
                                            onClick={() => toggleCourseExpanded(index)}
                                            aria-expanded={isExpanded}
                                        >
                                            <ChevronRight size={12} className={styles.courseExpandIcon} />
                                            <span className={styles.courseTitle}>{course.title}</span>
                                        </button>
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

            <Container
                className={styles.quickActions}
                header={<h2 className={styles.sectionTitle}>Tools & Settings</h2>}
            >
                <div className={styles.actionMenu}>
                    <Button variant="ghost" fullWidth onClick={handleShowAllCourses} icon={<GraduationCap size={16} />}>
                        Browse Courses
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenSettings} icon={<Settings size={16} />}>
                        Open Settings
                    </Button>
                    <Button variant="ghost" fullWidth onClick={handleOpenWebsite} icon={<ExternalLink size={16} />}>
                        Open Artemis in browser
                    </Button>
                    {__IRIS_TELEMETRY__ && !hideDeveloperTools && (
                        <Button variant="ghost" fullWidth onClick={handleShowStruggleDetection} icon={<HeartPulse size={16} />}>
                            Struggle Detection
                            <span
                                style={{
                                    marginLeft: '6px',
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    letterSpacing: '0.05em',
                                    textTransform: 'uppercase',
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    background: 'var(--vscode-badge-background)',
                                    color: 'var(--vscode-badge-foreground)',
                                }}
                                title="Developer-only page (visible only with artemis.developerMode enabled)"
                            >
                                Dev
                            </span>
                        </Button>
                    )}
                    <Button variant="ghost" fullWidth onClick={handleShowSubmissionSetup} icon={<GitBranch size={16} />}>
                        Submission Setup
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
