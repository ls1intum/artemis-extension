import { useEffect, useState } from 'react';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import { useExamConductionStore } from '../../stores/useExamConductionStore';
import type { ExamConductionViewProps } from './types';
import { ExamTimer } from '../../components/ExamTimer/ExamTimer';
import { TimerExpiredOverlay } from '../../components/TimerExpiredOverlay/TimerExpiredOverlay';
import { ExerciseList } from './components/ExerciseList';
import { SkeletonList } from '../../components/Skeleton/SkeletonList';
import { ErrorMessage } from '../../components/ErrorMessage/ErrorMessage';
import { BackLink } from '../../components/BackLink/BackLink';
import { Container } from '../../components/Container/Container';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { Badge } from '../../components/Badge/Badge';
import { IconButton } from '../../components/Button/IconButton';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import { ExtensionMsg, postCommand, requestInit } from '../../../shared/messageContracts';
import styles from './ExamConductionView.module.css';

/**
 * ExamConduction React view showing exam timer, progress bar, and exercise list.
 */
export function ExamConductionView({ vscodeApi }: ExamConductionViewProps) {
    const store = useExamConductionStore();
    const { setExamData, setError } = store;
    const [overlayDismissed, setOverlayDismissed] = useState(false);

    // Message handler
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.ExamConductionInit) {
            setExamData(msg);
        }
        if (msg.type === ExtensionMsg.ViewInitError) {
            setError(msg.error);
        }
    }, [vscodeApi, setExamData, setError]);

    // Reset scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const handleBackToCourse = () => {
        postCommand(vscodeApi, 'backToCourseDetails');
    };

    // Loading state
    if (store.isLoading) {
        return (
            <div className={styles.examConduction}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Error state
    if (store.error) {
        return (
            <div className={styles.examConduction}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <ErrorMessage
                    error={store.error}
                    onRetry={() => {
                        store.setError(null);
                        store.setLoading(true);
                        requestInit(vscodeApi);
                    }}
                />
            </div>
        );
    }

    // No data state
    if (!store.studentExam || !store.courseId || !store.examId) {
        return (
            <div className={styles.examConduction}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <ErrorMessage
                    error="No exam data available"
                    onRetry={() => requestInit(vscodeApi)}
                />
            </div>
        );
    }

    const studentExam = store.studentExam;
    const exercises = studentExam.exercises || [];
    const isTestExam = (studentExam.exam as Record<string, unknown> | undefined)?.testExam === true;

    // Check if timer expired
    const timerExpired = store.endTime ? Date.now() >= store.endTime : false;
    const showOverlay = timerExpired && !overlayDismissed;

    const handleExerciseClick = (exerciseIndex: number) => {
        postCommand(vscodeApi, 'openExamExerciseDetails', {
            exercise: exercises[exerciseIndex],
            exerciseIndex,
            courseId: store.courseId!,
            examId: store.examId!,
        });
    };

    const handleOpenInBrowser = () => {
        postCommand(vscodeApi, 'openExamInBrowser', {
            courseId: store.courseId!,
            examId: store.examId!,
        });
    };

    const handleReload = () => {
        store.setLoading(true);
        postCommand(vscodeApi, 'reloadExamConduction');
    };

    return (
        <div className={styles.examConduction}>
            <BackLink onClick={handleBackToCourse} actions={
                <>
                    <IconButton
                        icon={<ExternalLink size={16} />}
                        ariaLabel="Open in Browser"
                        onClick={handleOpenInBrowser}
                    />
                    <IconButton.Reload
                        onClick={handleReload}
                        title="Refresh"
                    />
                </>
            }>
                Back to Course
            </BackLink>

            {store.endTime && store.startTime && store.totalDuration && (
                <ExamTimer
                    endTime={store.endTime}
                    startTime={store.startTime}
                    totalDuration={store.totalDuration}
                />
            )}

            <PageHeader title={studentExam.exam?.title || 'Exam'}>
                {isTestExam && (
                    <Badge variant="warning">Test Exam</Badge>
                )}
            </PageHeader>

            <Container>
                <ExerciseList
                    exercises={exercises}
                    workspaceExerciseId={store.workspaceExerciseId}
                    onExerciseClick={handleExerciseClick}
                />
            </Container>

            <TimerExpiredOverlay
                visible={showOverlay}
                onDismiss={() => setOverlayDismissed(true)}
            />
        </div>
    );
}
