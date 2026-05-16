import { useEffect, useState } from 'react';

import { ExtensionMsg, postCommand, requestInit } from '@shared/messageContracts';

import {
    BackLink,
    Container,
    ErrorMessage,
    SkeletonList,
} from '@webview/components';
import { ExamTimer } from '@webview/components/ExamTimer/ExamTimer';
import {
    BuildProgress,
    ParticipationActions,
    SubmissionStatus,
} from '@webview/components/exercise';
import type { BuildState } from '@webview/components/exercise/BuildProgress';
import type { ExerciseType } from '@webview/components/exercise/ParticipationActions';
import { TestResultsOverlay } from '@webview/components/exercise/TestResultsOverlay';
import { PageHeader } from '@webview/components/PageHeader/PageHeader';
import { TimerExpiredOverlay } from '@webview/components/TimerExpiredOverlay/TimerExpiredOverlay';
import { useExerciseStatusMessages } from '@webview/hooks/useExerciseStatusMessages';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { useWebSocketUpdates } from '@webview/hooks/useWebSocketUpdates';
import { useExamExerciseDetailStore } from '@webview/stores/useExamExerciseDetailStore';
import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';
import { determineParticipationStatus, determineSubmissionStatus, getLatestById, transformFeedbacksToTestCases } from '@webview/utils/exerciseStatus';

import { ScoreInfo, TestResults } from '../ExerciseDetail/components';
import styles from './ExamExerciseDetailView.module.css';
import type { ExamExerciseDetailViewProps } from './types';

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
    const latestSubmission = getLatestById(participation?.submissions);
    const latestResult = getLatestById(latestSubmission?.results);

    // Use Artemis-provided test case counts when available, fall back to feedbacks
    const buildFailed = latestSubmission?.buildFailed ?? false;
    const totalTests = latestResult?.testCaseCount ?? 0;
    const passedTests = latestResult?.passedTestCaseCount ?? 0;
    const hasTestInfo = totalTests > 0;

    // Build test cases from feedbacks for detailed display
    // The result details API returns feedbacks with testCase objects containing testName
    const feedbacks = latestResult?.feedbacks ?? [];
    const testCases = transformFeedbacksToTestCases(feedbacks);

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
                        onOpenTestResults={() => setShowTestResults(true)}
                    />
                )}
            </Container>

            {/* Problem Statement (plaintext: exam mode does not use SSR) */}
            <Container header={<h3>Exercise Description</h3>}>
                <p className={styles.problemStatementNotice}>
                    Use the Artemis web client for the formatted exercise description.
                </p>
                {exercise.problemStatement && (
                    <pre className={styles.problemStatementPlaintext}>{exercise.problemStatement}</pre>
                )}
            </Container>

            {/* Score Info (if available) */}
            {latestResult && (
                <ScoreInfo
                    score={scorePercentage * maxPoints / 100}
                    maxScore={maxPoints}
                    bonusPoints={exercise.bonusPoints ?? 0}
                />
            )}

            {/* Test Results (if available) */}
            {testCases.length > 0 && (
                <TestResults testCases={testCases} />
            )}

            <TestResultsOverlay
                open={showTestResults}
                onClose={() => setShowTestResults(false)}
                testCases={testCases}
            />
        </div>
    );
}
