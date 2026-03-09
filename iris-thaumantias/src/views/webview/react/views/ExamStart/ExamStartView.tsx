import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { useExamStartStore } from '../../stores/useExamStartStore';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { useExamTimer } from '../../hooks/useExamTimer';
import { useExtensionMessage } from '../../hooks/useExtensionMessage';
import { ExamTimer } from '../../components/ExamTimer/ExamTimer';
import { TimerExpiredOverlay } from '../../components/TimerExpiredOverlay/TimerExpiredOverlay';
import { BackLink, Container, Button, SkeletonList, ErrorMessage, Badge } from '../../components';
import type { ExamStartViewProps } from './types';
import { ExtensionMsg, postCommand, requestInit } from '../../../../../shared/messageContracts';
import styles from './ExamStartView.module.css';

export function ExamStartView({ vscodeApi }: ExamStartViewProps) {
    const { studentExam, courseId, examId, isLoading, error, setExamStartData, setError } = useExamStartStore();
    const [showExpiredOverlay, setShowExpiredOverlay] = useState(false);

    // Load data on mount
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.ExamStartInit) {
            setExamStartData(msg);
        }
        if (msg.type === ExtensionMsg.ViewInitError) {
            setError(msg.error);
        }
    }, [vscodeApi, setExamStartData, setError]);

    // Calculate exam timing
    const examStartDate = studentExam?.exam?.startDate ? new Date(studentExam.exam.startDate) : null;
    const examEndDate = studentExam?.exam?.endDate ? new Date(studentExam.exam.endDate) : null;
    const hasStarted = examStartDate ? Date.now() >= examStartDate.getTime() : false;
    const hasEnded = examEndDate ? Date.now() >= examEndDate.getTime() : false;

    // Adaptive timer: countdown to start OR remaining working time
    let timerEndTime: number | null = null;
    let timerLabel = '';
    if (!hasStarted && examStartDate) {
        // Countdown to exam start
        timerEndTime = examStartDate.getTime();
        timerLabel = 'Exam starts in:';
    } else if (hasStarted && studentExam?.workingTime) {
        // Remaining working time
        const startTime = studentExam.exam?.testExam && studentExam.startedDate
            ? new Date(studentExam.startedDate).getTime()
            : examStartDate?.getTime() || Date.now();
        timerEndTime = startTime + studentExam.workingTime * 1000;
        timerLabel = 'Time remaining:';
    }

    const { remaining, expired } = useExamTimer(timerEndTime);

    // Relative time for dates
    const startRelative = useRelativeTime(examStartDate);
    const endRelative = useRelativeTime(examEndDate);

    // Format working time duration
    const formatWorkingTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
        }
        return `${minutes} minutes`;
    };

    // Sanitize exam rules
    const sanitizeRules = (html: string): string => {
        if (!html) {return 'No rules defined for this exam.';}

        let processed = html;

        // Remove HTML comments
        processed = processed.replace(/<!--[\s\S]*?-->/g, '');

        // Normalize newlines
        processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Remove newlines around block elements
        const blockTags = 'div|p|ul|ol|li|h[1-6]|blockquote';
        processed = processed.replace(new RegExp(`\\n+\\s*<(${blockTags})`, 'gi'), '<$1');
        processed = processed.replace(new RegExp(`</(${blockTags})>\\s*\\n+`, 'gi'), '</$1>');

        // Collapse multiple newlines
        processed = processed.replace(/\n{3,}/g, '\n\n');

        // Trim br tags
        processed = processed.replace(/^(\s*<br\s*\/?>\s*)+/i, '').replace(/(\s*<br\s*\/?>\s*)+$/i, '');
        processed = processed.trim();

        // Sanitize with DOMPurify
        return DOMPurify.sanitize(processed);
    };

    const handleBackToCourse = () => {
        postCommand(vscodeApi, 'backToCourseDetails');
    };

    const handleOpenInBrowser = () => {
        if (courseId && examId) {
            postCommand(vscodeApi, 'openExamInBrowser', { courseId, examId });
        }
    };

    const handleEnterOrRefresh = () => {
        if (courseId && examId && studentExam?.id) {
            postCommand(vscodeApi, 'refreshExam', {
                courseId,
                examId,
                studentExamId: studentExam.id,
            });
        }
    };

    const handleRetry = () => {
        setError(null);
        requestInit(vscodeApi);
    };

    useEffect(() => {
        if (expired && hasStarted) {
            setShowExpiredOverlay(true);
        }
    }, [expired, hasStarted]);

    // Loading state
    if (isLoading) {
        return (
            <div className={styles.examStartView}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <SkeletonList count={5} />
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={styles.examStartView}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <ErrorMessage error={error} onRetry={handleRetry} />
            </div>
        );
    }

    // No data state
    if (!studentExam || !studentExam.exam) {
        return (
            <div className={styles.examStartView}>
                <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>
                <Container>
                    <p>No exam data available.</p>
                </Container>
            </div>
        );
    }

    const exam = studentExam.exam;
    const isTestExam = exam.testExam || false;

    return (
        <div className={styles.examStartView}>
            {showExpiredOverlay && (
                <TimerExpiredOverlay visible={showExpiredOverlay} onDismiss={() => setShowExpiredOverlay(false)} />
            )}

            <BackLink onClick={handleBackToCourse}>Back to Course</BackLink>

            {/* Header Card */}
            <Container>
                <div className={styles.headerCard}>
                    <h2 className={styles.examTitle}>{exam.title || 'Exam'}</h2>
                    {isTestExam && <Badge variant="info">Test Exam</Badge>}

                    <div className={styles.datesGrid}>
                        <div className={styles.dateItem}>
                            <div className={styles.dateLabel}>{hasStarted ? 'Started' : 'Starts'}</div>
                            <div className={styles.dateValue}>{startRelative}</div>
                        </div>
                        <div className={styles.dateItem}>
                            <div className={styles.dateLabel}>{hasEnded ? 'Ended' : 'Ends'}</div>
                            <div className={styles.dateValue}>{endRelative}</div>
                        </div>
                        <div className={styles.dateItem}>
                            <div className={styles.dateLabel}>Working Time</div>
                            <div className={styles.dateValue}>
                                {studentExam.workingTime ? formatWorkingTime(studentExam.workingTime) : 'N/A'}
                            </div>
                        </div>
                    </div>

                    {/* Adaptive timer */}
                    {timerEndTime && (
                        <div className={styles.timerSection}>
                            <div className={styles.timerLabel}>{timerLabel}</div>
                            {hasStarted ? (
                                <ExamTimer
                                    endTime={timerEndTime}
                                    startTime={timerEndTime - ((studentExam.workingTime || 0) * 1000)}
                                    totalDuration={(studentExam.workingTime || 0) * 1000}
                                />
                            ) : (
                                <div className={styles.countdownTimer}>
                                    {Math.floor(remaining / 1000)}s
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Container>

            {/* Rules Section */}
            <details className={styles.rulesContainer} open>
                <summary className={styles.rulesSummary}>
                    <div className={styles.rulesHeader}>
                        <h3>Exam Rules</h3>
                        <p className={styles.rulesSubtitle}>Please review before you begin</p>
                    </div>
                    <span className={styles.toggleIcon}>▼</span>
                </summary>
                <div
                    className={styles.rulesContent}
                    dangerouslySetInnerHTML={{ __html: sanitizeRules(exam.startText || '') }}
                />
            </details>

            {/* Action Buttons */}
            <Container>
                <div className={styles.actionButtons}>
                    <Button variant="primary" onClick={handleOpenInBrowser} fullWidth>
                        Open in Browser
                    </Button>
                    <Button variant="secondary" onClick={handleEnterOrRefresh} fullWidth>
                        {hasStarted ? 'Enter Exam' : 'Refresh'}
                    </Button>
                </div>
            </Container>
        </div>
    );
}
