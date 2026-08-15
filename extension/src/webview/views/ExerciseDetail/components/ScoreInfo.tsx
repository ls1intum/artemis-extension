import clsx from 'clsx';

import { formatDateTime } from '@webview/utils/formatDate';
import type { ScoreInfoProps } from '@webview/views/ExerciseDetail/types';

import styles from './ScoreInfo.module.css';

export function ScoreInfo({
    score,
    maxScore,
    bonusPoints = 0,
    assessmentType,
    completionDate,
}: ScoreInfoProps) {
    const scoreValue = score ?? 0;
    const scorePercentage = maxScore > 0 ? (scoreValue / maxScore) * 100 : 0;

    let scoreColorClass = styles.scoreError;
    if (scorePercentage >= 80) {
        scoreColorClass = styles.scoreSuccess;
    } else if (scorePercentage >= 40) {
        scoreColorClass = styles.scoreWarning;
    }

    return (
        <div className={styles.scoreInfo}>
            <div className={styles.scoreDisplay}>
                <span className={clsx(styles.scoreValue, scoreColorClass)}>
                    {parseFloat(scoreValue.toFixed(1))}
                </span>
                <span className={styles.scoreSeparator}>/</span>
                <span className={styles.scoreMax}>{maxScore}</span>
                {bonusPoints > 0 && (
                    <span className={styles.bonusPoints}>
                        (+{bonusPoints} bonus)
                    </span>
                )}
            </div>
            <div className={styles.scorePercentage}>
                ({scorePercentage.toFixed(1)}%)
            </div>
            {assessmentType && (
                <div className={styles.assessmentType}>
                    Assessment: {assessmentType}
                </div>
            )}
            {completionDate && (
                <div className={styles.completionDate}>
                    Completed: {formatDateTime(completionDate)}
                </div>
            )}
        </div>
    );
}
