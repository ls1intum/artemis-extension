import { useEffect, useState } from 'react';
import { useExamExerciseDetailStore } from '../../stores/useExamExerciseDetailStore';
import { useExerciseDetailStore } from '../../stores/useExerciseDetailStore';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import { useExerciseStatusMessages } from '../../hooks/useExerciseStatusMessages';
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
import { ExtensionMsg, postCommand, requestInit } from '../../../shared/messageContracts';
import { determineSubmissionStatus, determineParticipationStatus } from '../../utils/exerciseStatus';
import styles from './ExamExerciseDetailView.module.css';

export function ExamExerciseDetailView({ vscodeApi }: ExamExerciseDetailViewProps) {
    const { examContext, isLoading: examLoading, error: examError, setExamExerciseData, setError } =
        useExamExerciseDetailStore();
    const {
        exerciseData,
        isLoading: exerciseLoading,
        pendingSubmission,
        setExerciseData,
    } = useExerciseDetailStore();

    const [showExpiredOverlay, setShowExpiredOverlay] = useState(false);
    const [showTestResults, setShowTestResults] = useState(false);

    // Initialize WebSocket updates
    useWebSocketUpdates();

    // Load data on mount
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.ExamExerciseDetailInit) {
            setExerciseData(msg.exerciseData, msg.hideDeveloperTools);
            const { type: _type, ...payload } = msg;
            setExamExerciseData(payload);
        }
        if (msg.type === ExtensionMsg.ViewInitError) {
            setError(msg.error);
        }
    }, [vscodeApi, setExerciseData, setExamExerciseData, setError]);

    // Listen for exercise-related extension messages (build progress, submissions, repo status, etc.)
    useExerciseStatusMessages(vscodeApi);

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

    const handleRetry = () => {
        setError(null);
        requestInit(vscodeApi);
    };

    const loading = examLoading || exerciseLoading;
    const error = examError;

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
    // In Artemis, "latest" = highest ID; results live on submission.results
    const latestSubmission = [...(participation?.submissions ?? [])]
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
    const latestResult = [...(latestSubmission?.results ?? [])]
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];

    // Use Artemis-provided test case counts when available, fall back to feedbacks
    const buildFailed = latestSubmission?.buildFailed ?? false;
    const totalTests = latestResult?.testCaseCount ?? 0;
    const passedTests = latestResult?.passedTestCaseCount ?? 0;
    const hasTestInfo = totalTests > 0;

    // Build test cases from feedbacks for detailed display
    // The result details API returns feedbacks with testCase objects containing testName
    const feedbacks = latestResult?.feedbacks ?? [];
    const testFeedbacks = feedbacks.filter((f: { type?: string; text?: string; testCase?: { testName?: string } }) =>
        f.testCase?.testName || ((!f.type || f.type === 'AUTOMATIC') && f.text && !f.text.startsWith('SCAFeedbackIdentifier:'))
    );
    const testCases = testFeedbacks.map((f: { text?: string; positive?: boolean; detailText?: string; testCase?: { testName?: string } }) => ({
        name: f.testCase?.testName ?? f.text ?? 'Test',
        passed: f.positive ?? false,
        message: f.detailText,
    }));

    // result.score is already a percentage (0-100) in Artemis
    const scorePercentage = latestResult?.score ?? 0;

    // Determine submission status
    const submissionStatus = determineSubmissionStatus(pendingSubmission, latestResult, latestSubmission);

    // Determine participation status
    const participationStatus = determineParticipationStatus(hasParticipation, latestResult, latestSubmission);

    // Build progress status
    let buildStatus: BuildState = 'idle';
    if (pendingSubmission) {
        buildStatus = 'building';
    }

    const maxPoints = exercise.maxPoints ?? 0;
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
                        if (exercise.id === undefined) {return;}
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
                        if (exercise.id === undefined) {return;}
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
                        score={scorePercentage * maxPoints / 100}
                        maxScore={maxPoints}
                        scorePercentage={scorePercentage}
                        exerciseType={exerciseType}
                        buildFailed={buildFailed}
                        hasTestInfo={hasTestInfo}
                        totalTests={totalTests}
                        passedTests={passedTests}
                        testCases={testCases}
                        onToggleTestResults={() => setShowTestResults(prev => !prev)}
                        showTestResults={showTestResults}
                    />
                )}
            </Container>

            {/* Problem Statement */}
            <ProblemStatement
                downloadLinks={downloadLinks}
            />

            {/* Score Info (if available) */}
            {latestResult && (
                <ScoreInfo
                    score={scorePercentage * maxPoints / 100}
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
