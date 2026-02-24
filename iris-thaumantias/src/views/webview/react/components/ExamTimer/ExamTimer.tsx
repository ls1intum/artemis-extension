import { useExamTimer } from '../../hooks/useExamTimer';
import { formatExamTimer } from '../../utils/formatExamTimer';
import clsx from 'clsx';
import styles from './ExamTimer.module.css';

interface ExamTimerProps {
    endTime: number;
    startTime: number;
    totalDuration: number;
}

/**
 * Exam countdown timer component with progress bar.
 * Uses Web Worker-based timer to maintain accuracy in background tabs.
 */
export function ExamTimer({ endTime, startTime, totalDuration }: ExamTimerProps) {
    const { remaining, expired } = useExamTimer(endTime);

    const displayTime = formatExamTimer(remaining);
    const isWarning = remaining < 5 * 60 * 1000 && !expired;

    // Calculate progress percentage
    const elapsed = Date.now() - startTime;
    const percentage = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

    return (
        <div className={styles.timerContainer}>
            <div
                className={clsx(
                    styles.timer,
                    isWarning && styles.warning,
                    expired && styles.expired
                )}
            >
                {displayTime}
            </div>
            <div className={styles.progressBarContainer}>
                <div
                    className={styles.progressBar}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}
