import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import { useState } from 'react';

import { WebviewCmd } from '@shared/messageContracts';
import { ExtensionMsg, postCommand, requestInit } from '@shared/messageContracts';

import {
    AskIris,
    BackLink,
    Badge,
    Button,
    Container,
    ErrorMessage,
    IconButton,
    SkeletonList,
} from '@webview/components';
import { BuildStatusStrip, ParticipationActions, SubmissionStatus } from '@webview/components/exercise';
import { type ExerciseType, isExerciseType } from '@webview/components/exercise/ParticipationActions';
import { TestResultsOverlay } from '@webview/components/exercise/TestResultsOverlay';
import { useExerciseStatusMessages } from '@webview/hooks/useExerciseStatusMessages';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { useInViewport } from '@webview/hooks/useInViewport';
import { useWebSocketUpdates } from '@webview/hooks/useWebSocketUpdates';
import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';
import {
    classifyTaskTests,
    countsForTelemetry,
    determineParticipationStatus,
    determineSubmissionStatus,
    getLatestById,
    getLatestResultAcrossSubmissions,
    isTestCaseFeedback,
    transformFeedbacksToTestCases,
} from '@webview/utils/exerciseStatus';
import { formatDate } from '@webview/utils/formatDate';
import { getIcon } from '@webview/utils/iconMap';
import { makeViewId } from '@webview/utils/viewId';

import { ProblemStatement } from './components';
import styles from './ExerciseDetailView.module.css';
import type { ExerciseDetailViewProps } from './types';

interface OpenViewState {
    viewId: string;
    openedAt: number;
    closeIdentity: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName?: string;
    };
}

interface OpenTaskViewState extends OpenViewState {
    taskName: string;
    testIds: number[];
}

export function ExerciseDetailView({ vscodeApi }: ExerciseDetailViewProps) {
    const {
        exerciseData,
        hideDeveloperTools,
        isLoading,
        error,
        repoStatus,
        dirtyPagesStatus,
        clonedNotice,
        pendingSubmissionsByParticipationId,
        setExerciseData,
        setError,
        loadExerciseDetail,
        clearClonedNotice,
    } = useExerciseDetailStore();

    const [showCommitMessage, setShowCommitMessage] = useState(false);
    const [commitMessage, setCommitMessage] = useState('');

    const [openOverviewView, setOpenOverviewView] = useState<OpenViewState | null>(null);
    const [openTaskView, setOpenTaskView] = useState<OpenTaskViewState | null>(null);

    // Sticky build-status strip (#280): track whether the SubmissionStatus
    // card is visible; the strip only shows while it is scrolled out of view.
    // Callback-ref state (not useRef): the card mounts only after the loading
    // early-returns below resolve, so the observer must attach when the
    // element appears, not on first render.
    const [submissionStatusEl, setSubmissionStatusEl] = useState<HTMLDivElement | null>(null);
    const submissionStatusInView = useInViewport(submissionStatusEl);

    // Initialize WebSocket updates hook
    useWebSocketUpdates();

    // Server-side rendered problem statement (progressive enhancement)
    const [serverRenderedPS, setServerRenderedPS] = useState<{
        html: string;
    } | null>(null);
    // Listen for exerciseDetailInit messages
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.ExerciseDetailInit) {
            if (!msg.exerciseData) { return; }

            setExerciseData(msg.exerciseData, msg.hideDeveloperTools, msg.repoStatus);
            // Use cached server render if available on init
            if (msg.serverRenderedProblemStatement) {
                setServerRenderedPS(msg.serverRenderedProblemStatement);
            } else {
                setServerRenderedPS(null);
            }
        }
        if (msg.type === ExtensionMsg.ViewInitError) {
            setError(msg.error);
        }
        // Progressive upgrade: server-rendered problem statement arrived
        if (msg.type === ExtensionMsg.ProblemStatementRendered) {
            setServerRenderedPS({ html: msg.html });
        }
    }, [vscodeApi, setExerciseData, setError]);

    // Listen for exercise-related extension messages
    useExerciseStatusMessages(vscodeApi);

    const handleBackToCourse = () => {
        postCommand(vscodeApi, 'backToCourseDetails');
    };

    const handleReload = () => {
        if (exerciseData?.exercise?.id) {
            loadExerciseDetail(vscodeApi, exerciseData.exercise.id);
        } else {
            requestInit(vscodeApi);
        }
    };

    const handleRetry = () => {
        setError(null);
        requestInit(vscodeApi);
    };

    const handleFullscreen = () => {
        postCommand(vscodeApi, 'toggleFullscreen');
    };

    const handleSettings = () => {
        postCommand(vscodeApi, 'openSettings', { setting: 'Artemis' });
    };

    const handleAskIris = () => {
        const exercise = exerciseData?.exercise;
        if (exercise && exercise.id !== undefined && exercise.title !== undefined) {
            postCommand(vscodeApi, 'askIrisAboutExercise', {
                exerciseId: exercise.id,
                exerciseTitle: exercise.title,
                exerciseShortName: exercise.shortName,
                courseId: exercise.course?.id,
                courseTitle: exercise.course?.title,
                courseShortName: exercise.course?.shortName,
            });
        }
    };

    const handleOpenRawJSON = () => {
        if (exerciseData) {
            postCommand(vscodeApi, 'openInEditor', { data: exerciseData });
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
                <ErrorMessage error={error} onRetry={handleRetry} />
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
    const exerciseType: ExerciseType = isExerciseType(exercise.type) ? exercise.type : 'programming';
    const isProgramming = exerciseType === 'programming';

    // Extract participation data
    // Select participation matching the current workspace mode (practice vs graded)
    const isPractice = repoStatus?.isPracticeRepo ?? false;
    const allParticipations = exercise.studentParticipations ?? [];
    const participation = allParticipations.find(p => p.testRun === isPractice)
        ?? allParticipations[0];
    const hasParticipation = !!participation;
    const participationId = participation?.id;
    const repositoryUri = participation?.repositoryUri;

    // Pick the pending build entry that belongs to the participation we
    // actually surface in this view. The map can carry concurrent pending
    // builds for other participations (graded + practice) without their
    // status leaking into the selected view (#168).
    const pendingSubmission = participationId !== undefined
        ? pendingSubmissionsByParticipationId[participationId] ?? null
        : null;

    // Extract submission and result data
    // In Artemis, "latest" = highest ID (not date-sorted)
    const latestSubmission = getLatestById(participation?.submissions);
    // Results live on submission.results (not on participation directly)
    const latestResult = getLatestById(latestSubmission?.results);

    // Feedback modals show the previous result while a build is running, so a
    // fresh resultless submission does not blank the feedback. The fallback to
    // an earlier submission is gated on an ACTIVE pending build: without one, a
    // resultless newest submission (e.g. a completed build-failed submission)
    // must keep the existing `latestResult` behaviour and NOT resurface stale
    // feedback from an older submission. Card/status/score stay on latestResult.
    const displayResult = pendingSubmission !== null
        ? getLatestResultAcrossSubmissions(participation?.submissions)
        : latestResult;

    // Build test cases from feedbacks for detailed display. Test-case feedback
    // is identified by isTestCaseFeedback (Artemis parity); the test name may be
    // hidden (showTestNamesToStudents=false) and is not required.
    const buildFailed = latestSubmission?.buildFailed ?? false;
    const feedbacks = latestResult?.feedbacks ?? [];
    const testFeedbacks = feedbacks.filter(isTestCaseFeedback);
    const displayTestCases = transformFeedbacksToTestCases(displayResult?.feedbacks ?? []);

    // Use Artemis-provided test case counts when available, fall back to feedbacks
    const totalTests = latestResult?.testCaseCount || testFeedbacks.length;
    const passedTests = latestResult?.passedTestCaseCount ?? testFeedbacks.filter(f => f.positive).length;
    const hasTestInfo = totalTests > 0;

    const handleOverviewClose = (reason: 'button' | 'escape') => {
        if (!openOverviewView) { return; }
        postCommand(vscodeApi, WebviewCmd.TestResultsOverviewClosed, {
            viewId: openOverviewView.closeIdentity.viewId,
            exerciseId: openOverviewView.closeIdentity.exerciseId,
            participationId: openOverviewView.closeIdentity.participationId,
            resultId: openOverviewView.closeIdentity.resultId,
            durationMs: Date.now() - openOverviewView.openedAt,
            closeReason: reason,
        });
        setOpenOverviewView(null);
    };

    const handleTaskClose = (reason: 'button' | 'escape') => {
        if (!openTaskView) { return; }
        postCommand(vscodeApi, WebviewCmd.TaskFeedbackClosed, {
            viewId: openTaskView.closeIdentity.viewId,
            exerciseId: openTaskView.closeIdentity.exerciseId,
            participationId: openTaskView.closeIdentity.participationId,
            resultId: openTaskView.closeIdentity.resultId,
            taskName: openTaskView.taskName,
            durationMs: Date.now() - openTaskView.openedAt,
            closeReason: reason,
        });
        setOpenTaskView(null);
    };

    const handleOverviewOpen = () => {
        if (!exerciseData?.exercise?.id) { return; }
        const viewId = makeViewId();
        const openedAt = Date.now();
        const exerciseId = exerciseData.exercise.id;
        const resultId = displayResult?.id;
        const totalTestCount = displayTestCases.length;
        const passedTestCount = displayTestCases.filter(t => t.passed).length;
        const failedTests = totalTestCount - passedTestCount;
        postCommand(vscodeApi, WebviewCmd.TestResultsOverviewOpened, {
            viewId, exerciseId, participationId, resultId,
            totalTests: totalTestCount, passedTests: passedTestCount, failedTests,
        });
        setOpenOverviewView({
            viewId,
            openedAt,
            closeIdentity: { viewId, exerciseId, participationId, resultId },
        });
    };

    const handleTaskOpen = ({ taskName, testIds }: { taskName: string; testIds: number[] }) => {
        if (!exerciseData?.exercise?.id) { return; }
        const classification = classifyTaskTests(testIds, displayResult);
        // Telemetry: keep existing totalTests/passedTests/failedTests semantics
        // (matched tests for this task). Add notExecutedTests as additive field.
        const { passedCount, failedCount, notExecutedCount } = countsForTelemetry(classification);
        const totalTestCount = passedCount + failedCount;
        const viewId = makeViewId();
        const openedAt = Date.now();
        const exerciseId = exerciseData.exercise.id;
        const resultId = displayResult?.id;
        postCommand(vscodeApi, WebviewCmd.TaskFeedbackOpened, {
            viewId, exerciseId, participationId, resultId,
            taskName, testIds,
            totalTests: totalTestCount, passedTests: passedCount, failedTests: failedCount,
            notExecutedTests: notExecutedCount,
        });
        setOpenTaskView({
            viewId,
            openedAt,
            taskName,
            testIds,
            closeIdentity: { viewId, exerciseId, participationId, resultId, taskName },
        });
    };

    // result.score is already a percentage (0-100) in Artemis
    const scorePercentage = latestResult?.score ?? 0;

    // Banner only when we are actually substituting a previous result for the
    // running build. No previous result -> no banner (first-build stays as-is).
    const buildRunning = pendingSubmission !== null && displayResult !== undefined;

    // Determine submission status
    const submissionStatus = determineSubmissionStatus(pendingSubmission, latestResult, latestSubmission);

    // Determine participation status
    const participationStatus = determineParticipationStatus(hasParticipation, latestResult, latestSubmission);

    // Exercise card data
    const maxPoints = exercise.maxPoints ?? 0;
    const bonusPoints = exercise.bonusPoints ?? 0;
    const dueDate = exercise.dueDate;
    const releaseDate = exercise.releaseDate || exercise.startDate;
    const mode = exercise.mode ?? 'individual';
    const includedInScore = exercise.includedInScore !== false ? 'Graded' : 'Not graded';
    const courseName = exercise.course?.title || 'Unknown Course';
    const semester = exercise.course?.semester;
    const filePattern = exercise.filePattern;

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

    // Practice availability: exercise is overdue, programming, and user has no (graded) participation
    const isOverdue = dueDate ? new Date(dueDate).getTime() < Date.now() : false;
    const isPracticeAvailable = isProgramming && isOverdue && !hasParticipation;

    // Workspace status derived from repoStatus
    const workspaceStatus = !repoStatus ? 'checking'
        : !repoStatus.isConnected ? 'disconnected'
        : repoStatus.hasChanges ? 'dirty' : 'clean';

    return (
        <div className={styles.exerciseDetailView}>
            {/* Cloned repo notice */}
            {clonedNotice && (
                <div className={styles.banner} data-variant="info">
                    <span>Repository cloned for "{clonedNotice.exerciseTitle}"</span>
                    <button className={styles.bannerDismiss} onClick={clearClonedNotice}>×</button>
                </div>
            )}

            <BackLink onClick={handleBackToCourse} actions={
                <>
                    <IconButton.Reload onClick={handleReload} title="Reload Exercise" />
                    <IconButton.Fullscreen onClick={handleFullscreen} title="Open in new tab" />
                    <IconButton.Settings onClick={handleSettings} title="Settings" />
                </>
            }>Back to Course</BackLink>

            {/* Exercise Card */}
            <details className={styles.exerciseCard}>
                <summary className={styles.exerciseSummary}>
                    <div className={styles.summaryContent}>
                        <div className={styles.summaryText}>
                            <div className={styles.exerciseTitleRow}>
                                {(() => {
                                    const ExerciseTypeIcon = getIcon(exercise.type);
                                    return <ExerciseTypeIcon size={18} />;
                                })()}
                                <div className={styles.exerciseTitle}>{exercise.title}</div>
                            </div>
                            <div className={styles.exerciseMeta}>
                                <Badge variant="default">
                                    {maxPoints} {maxPoints === 1 ? 'point' : 'points'}
                                    {bonusPoints > 0 && ` + ${bonusPoints} bonus`}
                                </Badge>
                                {timeRemaining && (
                                    <Badge variant={isDueSoon ? 'warning' : 'default'}>
                                        {timeRemaining}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <ChevronDown size={14} className={styles.toggleIcon} />
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
                            <div className={styles.infoValue}>{mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase()}</div>
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
                    canSubmit={hasParticipation && isProgramming}
                    workspaceStatus={workspaceStatus}
                    isPracticeMode={repoStatus?.isPracticeRepo ?? false}
                    isPracticeAvailable={isPracticeAvailable}
                    hasUnsavedChanges={dirtyPagesStatus?.hasDirtyPages === true && !dirtyPagesStatus?.autoSaveEnabled}
                    showClonedNotice={!!clonedNotice}
                    onConfigureAutoSave={() => postCommand(vscodeApi, 'openSettings', { setting: 'files.autoSave' })}
                    onStart={() => {
                        if (exercise.id === undefined) { return; }
                        postCommand(vscodeApi, 'startExercise', { exerciseId: exercise.id });
                    }}
                    showCommitMessageInput={showCommitMessage}
                    commitMessage={commitMessage}
                    onToggleCommitMessage={() => setShowCommitMessage(prev => !prev)}
                    onCommitMessageChange={setCommitMessage}
                    onSubmit={() => {
                        if (participationId) {
                            postCommand(vscodeApi, 'submitExercise', {
                                participationId,
                                ...(commitMessage ? { commitMessage } : {}),
                            });
                            setCommitMessage('');
                            setShowCommitMessage(false);
                        }
                    }}
                    onClone={() => {
                        if (participationId && repositoryUri) {
                            postCommand(vscodeApi, 'cloneRepository', {
                                participationId,
                                repositoryUri,
                                exerciseTitle: exercise.title || 'Exercise',
                            });
                        }
                    }}
                    onOpenRepository={repositoryUri
                        ? () => postCommand(vscodeApi, 'openRepository', { repositoryUri })
                        : undefined}
                    onOpenClonedRepository={() => {
                        if (clonedNotice) {
                            postCommand(vscodeApi, 'openClonedRepository', { participationId: clonedNotice.participationId });
                            clearClonedNotice();
                        }
                    }}
                    onCheckWorkspace={() => {
                        postCommand(vscodeApi, 'checkRepositoryStatus');
                    }}
                    onCopyCloneUrl={() => {
                        if (repositoryUri) {
                            postCommand(vscodeApi, 'copyToClipboard', { text: repositoryUri });
                        }
                    }}
                    onCopyAuthenticatedCloneUrl={() => {
                        if (participationId && repositoryUri) {
                            postCommand(vscodeApi, 'copyAuthenticatedCloneUrl', {
                                participationId,
                                repositoryUri,
                            });
                        }
                    }}
                    onStartPractice={() => {
                        if (exercise.id === undefined) {return;}
                        postCommand(vscodeApi, 'startPractice', { exerciseId: exercise.id, exerciseTitle: exercise.title });
                    }}
                    onOpenInBrowser={() => {
                        postCommand(vscodeApi, 'openWebsite', {
                            path: `/courses/${exercise.course?.id}/exercises/${exercise.id}`,
                        });
                    }}
                />

                {/* Submission Status */}
                {hasParticipation && (
                    <div ref={setSubmissionStatusEl}>
                        <SubmissionStatus
                            status={submissionStatus}
                            score={scorePercentage * maxPoints / 100}
                            maxScore={maxPoints}
                            scorePercentage={scorePercentage}
                            exerciseType={exerciseType}
                            buildFailed={buildFailed}
                            hasTestInfo={hasTestInfo}
                            totalTests={totalTests}
                            passedTests={passedTests}
                            estimatedCompletionDate={pendingSubmission?.buildTimingInfo?.estimatedCompletionDate}
                            buildStartDate={pendingSubmission?.buildTimingInfo?.buildStartDate}
                            onOpenTestResults={handleOverviewOpen}
                            onViewBuildLog={() => {
                                if (participationId) {
                                    postCommand(vscodeApi, 'viewBuildLog', {
                                        participationId,
                                        resultId: latestResult?.id,
                                    });
                                }
                            }}
                            onGoToSource={() => {
                                if (participationId) {
                                    postCommand(vscodeApi, 'goToSource', {
                                        participationId,
                                        resultId: latestResult?.id,
                                    });
                                }
                            }}
                        />
                    </div>
                )}

            </Container>

            {/* Sticky build status strip (#280) — fixed to the top of the
                webview while a build runs and the card is out of view */}
            {hasParticipation && isProgramming && (
                <BuildStatusStrip
                    status={submissionStatus}
                    cardInView={submissionStatusInView}
                    estimatedCompletionDate={pendingSubmission?.buildTimingInfo?.estimatedCompletionDate}
                    buildStartDate={pendingSubmission?.buildTimingInfo?.buildStartDate}
                    buildFailed={buildFailed}
                    hasTestInfo={hasTestInfo}
                    totalTests={totalTests}
                    passedTests={passedTests}
                    onScrollToCard={() => submissionStatusEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                />
            )}

            {/* Ask Iris Section */}
            <AskIris
                description="Open the Iris chat to discuss this exercise or get guidance."
                onClick={handleAskIris}
            />

            {/* Problem Statement */}
            <ProblemStatement
                serverRenderedHtml={serverRenderedPS?.html}
                onTaskClick={handleTaskOpen}
                vscodeApi={vscodeApi}
            />

            {/* Developer Tools */}
            {!hideDeveloperTools && (
                <Container header={<h3>Developer Tools</h3>} variant="muted">
                    <div className={styles.devTools}>
                        <Button variant="secondary" onClick={handleOpenRawJSON}>
                            Open Raw JSON
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setServerRenderedPS(null)}
                        >
                            Simulate SSR Loading
                        </Button>
                        {serverRenderedPS && (
                            <>
                                <Button
                                    variant="secondary"
                                    onClick={() => postCommand(vscodeApi, 'openInEditor', { data: serverRenderedPS.html, language: 'html' })}
                                >
                                    View SSR HTML
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => postCommand(vscodeApi, 'freshSsrPreview', { darkMode: false })}
                                >
                                    Preview Light
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => postCommand(vscodeApi, 'freshSsrPreview', { darkMode: true })}
                                >
                                    Preview Dark
                                </Button>
                            </>
                        )}
                    </div>
                </Container>
            )}

            <TestResultsOverlay
                open={openOverviewView !== null}
                onClose={handleOverviewClose}
                buildRunning={buildRunning}
                state={{ kind: 'all', testCases: displayTestCases }}
            />

            {openTaskView !== null && (
                <TestResultsOverlay
                    open
                    onClose={handleTaskClose}
                    buildRunning={buildRunning}
                    state={classifyTaskTests(openTaskView.testIds, displayResult)}
                    taskName={openTaskView.taskName}
                />
            )}
        </div>
    );
}
