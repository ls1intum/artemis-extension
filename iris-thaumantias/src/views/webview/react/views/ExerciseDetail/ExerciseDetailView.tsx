import { useEffect, useState } from 'react';
import { useExerciseDetailStore } from '../../stores/useExerciseDetailStore';
import { useNavigationStore } from '../../stores/useNavigationStore';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import type { ExerciseDetailViewProps } from './types';
import type { ExerciseDetailsResponse } from '../../../../../types/apiResponses';
import { getIcon } from '../../../../../utils/iconMap';
import {
    BackLink,
    IconButton,
    Button,
    Container,
    Badge,
    SkeletonList,
    ErrorMessage,
    AskIris,
    ReconnectBanner,
} from '../../components';
import {
    SubmissionStatus,
    ParticipationActions,
    BuildProgress,
} from '../../components/exercise';
import { ProblemStatement, ScoreInfo, TestResults } from './components';
import type { ExerciseType } from '../../components/exercise/ParticipationActions';
import type { BuildState } from '../../components/exercise/BuildProgress';
import { isTypedMessage } from '../../utils/messageValidation';
import { determineSubmissionStatus, determineParticipationStatus } from '../../utils/exerciseStatus';
import { formatDate } from '../../utils/formatDate';
import styles from './ExerciseDetailView.module.css';

export function ExerciseDetailView({ vscodeApi }: ExerciseDetailViewProps) {
    const {
        exerciseData,
        hideDeveloperTools,
        isLoading,
        error,
        setExerciseData,
        setLoading,
        setError,
        loadExerciseDetail,
    } = useExerciseDetailStore();

    const { pushBreadcrumb, clearBreadcrumbs } = useNavigationStore();
    const [autoRetried, setAutoRetried] = useState(false);

    // Initialize WebSocket updates hook
    useWebSocketUpdates(vscodeApi);

    // Load data on mount
    useEffect(() => {
        // Clear breadcrumbs and rebuild
        clearBreadcrumbs();
        pushBreadcrumb('Dashboard', 'dashboard', () => {
            vscodeApi.postMessage({ type: 'command', command: 'backToDashboard' });
        });

        // Listen for exerciseDetailInit messages
        const handleMessage = (event: MessageEvent<unknown>) => {
            if (!isTypedMessage(event.data)) {
                return;
            }

            const typedMessage = event.data;

            // Handle typed message format
            if (typedMessage.type === 'exerciseDetailInit') {
                const payload = typedMessage.payload as { exerciseData?: unknown; hideDeveloperTools?: unknown } | undefined;
                if (!payload) return;

                const exerciseData = payload.exerciseData as ExerciseDetailsResponse;
                const hideDeveloperTools = typeof payload.hideDeveloperTools === 'boolean' ? payload.hideDeveloperTools : false;

                setExerciseData(exerciseData, hideDeveloperTools);

                // Push breadcrumbs: Dashboard > CourseName > ExerciseName
                const exercise = exerciseData?.exercise;
                const courseName = exercise?.course?.title ?? 'Course';
                const exerciseTitle = exercise?.title ?? 'Exercise';
                const abbreviatedCourse = courseName.length > 20 ? courseName.substring(0, 17) + '...' : courseName;
                const abbreviatedExercise = exerciseTitle.length > 20 ? exerciseTitle.substring(0, 17) + '...' : exerciseTitle;

                pushBreadcrumb(abbreviatedCourse, 'course-detail', () => {
                    vscodeApi.postMessage({ type: 'command', command: 'backToCourseDetails' });
                });

                pushBreadcrumb(abbreviatedExercise, 'exercise-detail', () => {
                    // Current page, no action
                });
            }
        };

        window.addEventListener('message', handleMessage);

        // Request initial data
        vscodeApi.postMessage({ type: 'ready' });

        return () => window.removeEventListener('message', handleMessage);
    }, [vscodeApi, setExerciseData, pushBreadcrumb, clearBreadcrumbs]);

    // Auto-retry once on error
    useEffect(() => {
        const exerciseId = exerciseData?.exercise?.id;
        if (error && !autoRetried && exerciseId) {
            const timer = setTimeout(() => {
                setAutoRetried(true);
                loadExerciseDetail(vscodeApi, exerciseId);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [error, autoRetried, exerciseData, loadExerciseDetail, vscodeApi]);

    const handleBackToCourse = () => {
        vscodeApi.postMessage({ type: 'command', command: 'backToCourseDetails' });
    };

    const handleReload = () => {
        if (exerciseData?.exercise?.id) {
            setAutoRetried(false);
            loadExerciseDetail(vscodeApi, exerciseData.exercise.id);
        }
    };

    const handleFullscreen = () => {
        vscodeApi.postMessage({ type: 'command', command: 'toggleFullscreen' });
    };

    const handleSettings = () => {
        vscodeApi.postMessage({ type: 'command', command: 'openSettings' });
    };

    const handleCheckRepositoryStatus = () => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'checkRepositoryStatus',
            payload: { showNotification: true },
        });
    };

    const handleAskIris = () => {
        const exercise = exerciseData?.exercise;
        if (exercise && exercise.id !== undefined && exercise.title !== undefined) {
            vscodeApi.postMessage({
                type: 'command',
                command: 'askIrisAboutExercise',
                payload: {
                    exerciseId: exercise.id,
                    exerciseTitle: exercise.title,
                    exerciseShortName: exercise.shortName,
                    courseId: exercise.course?.id,
                    courseTitle: exercise.course?.title,
                    courseShortName: exercise.course?.shortName,
                },
            });
        }
    };

    const handleDownloadFile = (url: string, filename: string) => {
        vscodeApi.postMessage({
            type: 'command',
            command: 'downloadFile',
            payload: { url, filename },
        });
    };

    const handleOpenRawJSON = () => {
        if (exerciseData) {
            vscodeApi.postMessage({
                type: 'command',
                command: 'openInEditor',
                payload: { data: exerciseData },
            });
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className={styles.exerciseDetailView}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={styles.exerciseDetailView}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <ErrorMessage
                    error={error}
                    onRetry={handleReload}
                />
            </div>
        );
    }

    // No data state
    if (!exerciseData || !exerciseData.exercise) {
        return (
            <div className={styles.exerciseDetailView}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <Container>
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                        <p>No exercise data available.</p>
                        <Button variant="secondary" onClick={handleReload}>
                            Reload
                        </Button>
                    </div>
                </Container>
            </div>
        );
    }

    const exercise = exerciseData.exercise;
    const exerciseType = (exercise.type || 'programming') as ExerciseType;
    const isProgramming = exerciseType === 'programming';

    // Extract participation data
    const participation = exercise.studentParticipations?.[0];
    const hasParticipation = !!participation;
    const participationId = participation?.id;
    const repositoryUri = participation?.repositoryUri;

    // Extract submission and result data
    const latestSubmission = participation?.submissions?.[0];
    const latestResult = participation?.results?.[0];
    const pendingSubmission = exerciseData.pendingSubmission;

    // Determine submission status
    const submissionStatus = determineSubmissionStatus(pendingSubmission, latestResult, exercise.maxPoints ?? 0);

    // Determine participation status
    const participationStatus = determineParticipationStatus(hasParticipation, latestResult, latestSubmission);

    // Build progress status
    let buildStatus: BuildState = 'idle';
    if (pendingSubmission) {
        buildStatus = 'building';
    }

    // Exercise card data
    const maxPoints = exercise.maxPoints ?? 0;
    const bonusPoints = exercise.bonusPoints ?? 0;
    const dueDate = exercise.dueDate;
    const releaseDate = exercise.releaseDate || exercise.startDate;
    // Additional fields not in core type (using index signature)
    const exerciseWithExtra = exercise as typeof exercise & { mode?: string; includedInScore?: boolean; filePattern?: string };
    const mode = exerciseWithExtra.mode ?? 'individual';
    const includedInScore = exerciseWithExtra.includedInScore !== false ? 'Graded' : 'Not graded';
    const courseName = exercise.course?.title || 'Unknown Course';
    const semester = exercise.course?.semester;
    const filePattern = exerciseWithExtra.filePattern;

    // Time remaining calculation
    let timeRemaining = '';
    let isDueSoon = false;
    if (dueDate) {
        const now = new Date().getTime();
        const due = new Date(dueDate).getTime();
        const diff = due - now;
        if (diff > 0) {
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            if (days > 1) {
                timeRemaining = `${days} days remaining`;
            } else if (days === 1) {
                timeRemaining = `1 day remaining`;
                isDueSoon = true;
            } else if (hours > 0) {
                timeRemaining = `${hours} hours remaining`;
                isDueSoon = true;
            } else {
                timeRemaining = 'Due soon';
                isDueSoon = true;
            }
        } else {
            timeRemaining = 'Overdue';
            isDueSoon = true;
        }
    }

    // Problem statement (markdown is already processed to HTML by extension)
    const problemStatementHtml = exercise.problemStatement || 'No description available';

    // Download links extraction (simplified - in real implementation would parse from markdown)
    const downloadLinks: Array<{ name: string; url: string }> = [];

    return (
        <div className={styles.exerciseDetailView}>
            <ReconnectBanner />

            <BackLink onClick={handleBackToCourse} actions={
                <>
                    <IconButton.Reload onClick={handleReload} title="Reload Exercise" />
                    <IconButton.Fullscreen onClick={handleFullscreen} title="Open in new tab" />
                    <IconButton.Settings onClick={handleSettings} title="Settings" />
                </>
            }>Back to Course</BackLink>

            {/* Exercise Card */}
            <details className={styles.exerciseCard} open>
                <summary className={styles.exerciseSummary}>
                    <div className={styles.summaryContent}>
                        <div className={styles.summaryText}>
                            <div className={styles.exerciseTitle}>{exercise.title}</div>
                            <div className={styles.exerciseMeta}>
                                <div className={styles.exerciseIconBadge}>
                                    {(() => {
                                        const ExerciseTypeIcon = getIcon(exercise.type);
                                        return <ExerciseTypeIcon size={16} />;
                                    })()}
                                </div>
                                <Badge variant="default">
                                    {maxPoints} {maxPoints === 1 ? 'point' : 'points'}
                                    {bonusPoints > 0 && ` + ${bonusPoints} bonus`}
                                </Badge>
                                {timeRemaining && (
                                    <Badge variant={isDueSoon ? 'warning' : 'default'}>
                                        {timeRemaining}
                                    </Badge>
                                )}
                                <button
                                    className={styles.repoStatusIcon}
                                    onClick={handleCheckRepositoryStatus}
                                    title="Check repository status"
                                >
                                    ?
                                </button>
                            </div>
                        </div>
                        <span className={styles.toggleIcon}>▼</span>
                    </div>
                </summary>
                <div className={styles.expandedContent}>
                    <div className={styles.infoGrid}>
                        <div className={styles.infoItem}>
                            <div className={styles.infoLabel}>Release Date</div>
                            <div className={styles.infoValue}>
                                {releaseDate ? formatDate(releaseDate) : 'N/A'}
                            </div>
                        </div>
                        <div className={styles.infoItem}>
                            <div className={styles.infoLabel}>Mode</div>
                            <div className={styles.infoValue}>{mode}</div>
                        </div>
                        <div className={styles.infoItem}>
                            <div className={styles.infoLabel}>Grading</div>
                            <div className={styles.infoValue}>{includedInScore}</div>
                        </div>
                        <div className={styles.infoItem}>
                            <div className={styles.infoLabel}>Course</div>
                            <div className={styles.infoValue}>
                                <span>{courseName}</span>
                                {semester && (
                                    <Badge variant="muted">{semester}</Badge>
                                )}
                            </div>
                        </div>
                        {filePattern && (
                            <div className={styles.infoItem}>
                                <div className={styles.infoLabel}>File Formats</div>
                                <div className={styles.infoValue}>{filePattern}</div>
                            </div>
                        )}
                    </div>
                </div>
            </details>

            {/* Participation Section (covers ExerciseStarted state) */}
            <Container id="participation-section">
                <ParticipationActions
                    exerciseType={exerciseType}
                    participationStatus={participationStatus}
                    hasRepository={!!repositoryUri}
                    canSubmit={hasParticipation && isProgramming}
                    onStart={() => {
                        if (exercise.id === undefined) return;
                        vscodeApi.postMessage({
                            type: 'command',
                            command: 'startExercise',
                            payload: { exerciseId: exercise.id },
                        });
                    }}
                    onSubmit={() => {
                        if (participationId) {
                            vscodeApi.postMessage({
                                type: 'command',
                                command: 'submitExercise',
                                payload: { participationId },
                            });
                        }
                    }}
                    onClone={() => {
                        if (participationId && repositoryUri) {
                            vscodeApi.postMessage({
                                type: 'command',
                                command: 'cloneRepository',
                                payload: {
                                    participationId,
                                    repositoryUri,
                                    exerciseTitle: exercise.title || 'Exercise',
                                },
                            });
                        }
                    }}
                    onOpenRepository={() => {
                        vscodeApi.postMessage({
                            type: 'command',
                            command: 'openRepository',
                            payload: { repositoryUri },
                        });
                    }}
                    onStartPractice={() => {
                        if (exercise.id === undefined) return;
                        vscodeApi.postMessage({
                            type: 'command',
                            command: 'startPractice',
                            payload: { exerciseId: exercise.id },
                        });
                    }}
                    onOpenInBrowser={() => {
                        // Open in browser command
                        vscodeApi.postMessage({
                            type: 'command',
                            command: 'openWebsite',
                        });
                    }}
                />

                {/* Build Progress (when building) */}
                {buildStatus !== 'idle' && (
                    <BuildProgress
                        status={buildStatus}
                        message="Building your submission..."
                    />
                )}

                {/* Submission Status */}
                {hasParticipation && (
                    <SubmissionStatus
                        status={submissionStatus}
                        score={latestResult?.score ?? 0}
                        maxScore={maxPoints}
                        scorePercentage={latestResult?.score && maxPoints > 0 ? (latestResult.score / maxPoints) * 100 : 0}
                        exerciseType={exerciseType}
                    />
                )}
            </Container>

            {/* Ask Iris Section */}
            <Container header={<h3>Ask Iris</h3>}>
                <p>Open the Iris chat to discuss this exercise or get guidance.</p>
                <AskIris
                    onClick={handleAskIris}
                    label="Ask Iris about this exercise"
                />
            </Container>

            {/* Problem Statement */}
            <ProblemStatement
                markdown={problemStatementHtml}
                downloadLinks={downloadLinks}
                onDownload={handleDownloadFile}
                vscodeApi={vscodeApi}
            />

            {/* Developer Tools */}
            {!hideDeveloperTools && (
                <Container header={<h3>Developer Tools</h3>} variant="muted">
                    <div className={styles.devTools}>
                        <Button variant="secondary" onClick={handleOpenRawJSON}>
                            Open Raw JSON
                        </Button>
                    </div>
                </Container>
            )}
        </div>
    );
}
