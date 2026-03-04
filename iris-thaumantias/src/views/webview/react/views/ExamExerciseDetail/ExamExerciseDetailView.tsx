import { useEffect, useState } from 'react';
import { useExamExerciseDetailStore } from '../../stores/useExamExerciseDetailStore';
import { useExerciseDetailStore } from '../../stores/useExerciseDetailStore';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import { ExamTimer } from '../../components/ExamTimer/ExamTimer';
import { TimerExpiredOverlay } from '../../components/TimerExpiredOverlay/TimerExpiredOverlay';
import {
    BackLink,
    Container,
    SkeletonList,
    ErrorMessage,
} from '../../components';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import {
    SubmissionStatus,
    ParticipationActions,
    BuildProgress,
} from '../../components/exercise';
import { ProblemStatement, ScoreInfo, TestResults } from '../ExerciseDetail/components';
import type { ExamExerciseDetailViewProps } from './types';
import type { ExerciseType } from '../../components/exercise/ParticipationActions';
import type { BuildState } from '../../components/exercise/BuildProgress';
import { ExtensionMsg, postCommand, requestInit } from '../../../../../shared/messageContracts';
import { determineSubmissionStatus, determineParticipationStatus } from '../../utils/exerciseStatus';
import styles from './ExamExerciseDetailView.module.css';

export function ExamExerciseDetailView({ vscodeApi }: ExamExerciseDetailViewProps) {
    const { examContext, isLoading: examLoading, error: examError, setExamExerciseData, setError } =
        useExamExerciseDetailStore();
    const {
        exerciseData,
        hideDeveloperTools,
        isLoading: exerciseLoading,
        error: exerciseError,
        setExerciseData,
        loadExerciseDetail,
        setRepoStatus,
        setSubmissionResult,
        setClonedNotice,
        setTestResults,
        setBuildError,
        setDirtyPagesStatus,
    } = useExerciseDetailStore();

    const [showExpiredOverlay, setShowExpiredOverlay] = useState(false);
    const [autoRetried, setAutoRetried] = useState(false);

    // Initialize WebSocket updates
    useWebSocketUpdates(vscodeApi);

    // Load data on mount
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.ExamExerciseDetailInit) {
            setExerciseData(msg.exerciseData, msg.hideDeveloperTools);
            setExamExerciseData(msg as Parameters<typeof setExamExerciseData>[0]);
        }
    }, [vscodeApi, setExerciseData, setExamExerciseData]);

    // Listen for exercise-related extension messages (build progress, submissions, repo status, etc.)
    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.SubmissionResult:
                setSubmissionResult({ success: msg.success, error: msg.error });
                break;
            case ExtensionMsg.UpdateRepoStatus:
                setRepoStatus({ isConnected: msg.isConnected, hasChanges: msg.hasChanges, isGradedRepo: msg.isGradedRepo });
                break;
            case ExtensionMsg.ShowClonedRepoNotice:
                setClonedNotice(msg.exerciseTitle);
                break;
            case ExtensionMsg.TestResultsData:
                setTestResults({ testCases: msg.testCases, error: msg.error });
                break;
            case ExtensionMsg.BuildLogParsed:
                setBuildError(msg.error);
                break;
            case ExtensionMsg.UpdateDirtyPagesStatus:
                setDirtyPagesStatus({ hasDirtyPages: msg.hasDirtyPages, dirtyFileCount: msg.dirtyFileCount, autoSaveEnabled: msg.autoSaveEnabled });
                break;
        }
    }, [vscodeApi, setSubmissionResult, setRepoStatus, setClonedNotice, setTestResults, setBuildError, setDirtyPagesStatus]);

    // Auto-retry on error
    useEffect(() => {
        const exerciseId = exerciseData?.exercise?.id;
        if (exerciseError && !autoRetried && exerciseId) {
            const timer = setTimeout(() => {
                setAutoRetried(true);
                loadExerciseDetail(vscodeApi, exerciseId);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [exerciseError, autoRetried, exerciseData, loadExerciseDetail, vscodeApi]);

    // Show timer expired overlay when working time expires
    useEffect(() => {
        if (examContext?.endTime) {
            const checkExpiry = () => {
                if (Date.now() >= examContext.endTime) {
                    setShowExpiredOverlay(true);
                }
            };
            checkExpiry();
            const interval = setInterval(checkExpiry, 1000);
            return () => clearInterval(interval);
        }
    }, [examContext]);

    const handleBackToExam = () => {
        postCommand(vscodeApi, 'backToExam');
    };

    const handleReload = () => {
        if (exerciseData?.exercise?.id) {
            setAutoRetried(false);
            loadExerciseDetail(vscodeApi, exerciseData.exercise.id);
        }
    };

    const handleRetry = () => {
        setError(null);
        requestInit(vscodeApi);
    };

    const loading = examLoading || exerciseLoading;
    const error = examError || exerciseError;

    // Loading state
    if (loading) {
        return (
            <div className={styles.examExerciseDetailView}>
                <BackLink onClick={handleBackToExam}>Back to Exam</BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={styles.examExerciseDetailView}>
                <BackLink onClick={handleBackToExam}>Back to Exam</BackLink>
                <ErrorMessage error={error} onRetry={handleRetry} />
            </div>
        );
    }

    // No data state
    if (!exerciseData || !exerciseData.exercise || !examContext) {
        return (
            <div className={styles.examExerciseDetailView}>
                <BackLink onClick={handleBackToExam}>Back to Exam</BackLink>
                <Container>
                    <p>No exercise data available.</p>
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

    const maxPoints = exercise.maxPoints ?? 0;
    const problemStatementHtml = exercise.problemStatement || 'No description available';
    const downloadLinks: Array<{ name: string; url: string }> = [];

    return (
        <div className={styles.examExerciseDetailView}>
            {showExpiredOverlay && (
                <TimerExpiredOverlay visible={showExpiredOverlay} onDismiss={() => setShowExpiredOverlay(false)} />
            )}

            {/* Timer Header */}
            <div className={styles.timerHeader}>
                <BackLink onClick={handleBackToExam}>Back to Exam</BackLink>
                {examContext.endTime && (
                    <ExamTimer
                        endTime={examContext.endTime}
                        startTime={examContext.startTime}
                        totalDuration={examContext.totalDuration}
                    />
                )}
            </div>

            {/* Exercise Title */}
            <PageHeader title={exercise.title || 'Exercise'} />

            {/* Participation Section */}
            <Container id="participation-section">
                <ParticipationActions
                    exerciseType={exerciseType}
                    participationStatus={participationStatus}
                    hasRepository={!!repositoryUri}
                    canSubmit={hasParticipation && isProgramming}
                    isExamExercise={true}
                    onStart={() => {
                        if (exercise.id === undefined) return;
                        postCommand(vscodeApi, 'startExercise', { exerciseId: exercise.id });
                    }}
                    onSubmit={() => {
                        if (participationId) {
                            postCommand(vscodeApi, 'submitExercise', { participationId });
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
                    onOpenRepository={() => {
                        postCommand(vscodeApi, 'openRepository', { repositoryUri });
                    }}
                    onStartPractice={() => {
                        if (exercise.id === undefined) return;
                        postCommand(vscodeApi, 'startPractice', { exerciseId: exercise.id });
                    }}
                />

                {/* Build Progress */}
                {buildStatus !== 'idle' && (
                    <BuildProgress status={buildStatus} message="Building your submission..." />
                )}

                {/* Submission Status */}
                {hasParticipation && (
                    <SubmissionStatus
                        status={submissionStatus}
                        score={latestResult?.score ?? 0}
                        maxScore={maxPoints}
                        scorePercentage={
                            latestResult?.score && maxPoints > 0
                                ? (latestResult.score / maxPoints) * 100
                                : 0
                        }
                        exerciseType={exerciseType}
                    />
                )}
            </Container>

            {/* Problem Statement */}
            <ProblemStatement
                markdown={problemStatementHtml}
                downloadLinks={downloadLinks}
                vscodeApi={vscodeApi}
            />

            {/* Score Info (if available) */}
            {latestResult && (
                <ScoreInfo
                    score={latestResult.score ?? 0}
                    maxScore={maxPoints}
                    bonusPoints={exercise.bonusPoints ?? 0}
                />
            )}

            {/* Test Results (if available) */}
            {latestResult?.feedbacks && latestResult.feedbacks.length > 0 && (
                <TestResults
                    testCases={latestResult.feedbacks.map((feedback: {
                        text?: string;
                        positive?: boolean;
                        detailText?: string;
                    }) => ({
                        name: feedback.text || 'Test',
                        passed: feedback.positive || false,
                        message: feedback.detailText,
                    }))}
                />
            )}
        </div>
    );
}
