import clsx from 'clsx';
import { ReactNode } from 'react';

import { Button } from '@webview/components/Button';
import { useBuildProgress } from '@webview/hooks/useBuildProgress';

import styles from './SubmissionStatus.module.css';

export type SubmissionStatusType =
  | 'pending'
  | 'building'
  | 'success'
  | 'partial'
  | 'failed'
  | 'error'
  | 'no-submission';

export interface TestCase {
  name: string;
  passed: boolean;
  message?: string;
  type?: 'structural' | 'behavioral';
  id?: number;
}

interface SubmissionStatusProps {
  status: SubmissionStatusType;
  score?: number;
  maxScore?: number;
  scorePercentage?: number;
  totalTests?: number;
  passedTests?: number;
  hasTestInfo?: boolean;
  buildFailed?: boolean;
  onViewBuildLog?: () => void;
  onGoToSource?: () => void;
  onOpenTestResults?: () => void;
  className?: string;
  exerciseType?: 'programming' | 'quiz' | 'modeling' | 'text' | 'file-upload';
  estimatedCompletionDate?: string;
  buildStartDate?: string;
}

export function SubmissionStatus({
  status,
  score = 0,
  maxScore = 0,
  scorePercentage = 0,
  totalTests = 0,
  passedTests = 0,
  hasTestInfo = false,
  buildFailed = false,
  onViewBuildLog,
  onGoToSource,
  onOpenTestResults,
  className,
  exerciseType = 'programming',
  estimatedCompletionDate,
  buildStartDate,
}: SubmissionStatusProps) {
  // ETA countdown for building state
  const { etaSeconds, progressPercent } = useBuildProgress(
    status === 'building',
    buildStartDate,
    estimatedCompletionDate,
  );

  // Empty state for programming exercises with no submissions
  if (status === 'no-submission' && exerciseType === 'programming') {
    return (
      <div className={clsx(styles.buildStatus, styles.buildStatusEmpty, className)}>
        <div className={styles.buildStatusPlaceholder}>No builds yet — submit to see results</div>
      </div>
    );
  }

  // Building/pending state
  if (status === 'building' || status === 'pending') {
    const hasDeterminateProgress = status === 'building' && progressPercent !== null;

    let message: string;
    if (status === 'pending') {
      message = 'Build queued, waiting for resources...';
    } else if (etaSeconds !== null) {
      message = `Building your submission... (ETA: ${etaSeconds}s)`;
    } else {
      message = 'Building your submission...';
    }

    return (
      <div className={clsx(styles.buildStatus, styles.buildStatusBuilding, className)}>
        <div className={styles.buildProgressTrack}>
          <div
            data-testid="build-progress-bar"
            className={clsx(styles.buildProgressBar, {
              [styles.buildProgressBarIndeterminate]: !hasDeterminateProgress,
            })}
            style={hasDeterminateProgress ? { width: `${progressPercent}%` } : undefined}
          />
        </div>
        <div className={styles.buildStatusMessage}>{message}</div>
      </div>
    );
  }

  // Score colour tier (shared by the programming build rows).
  let scoreColorClass = styles.scoreError;
  if (scorePercentage >= 80) {
    scoreColorClass = styles.scoreSuccess;
  } else if (scorePercentage >= 40) {
    scoreColorClass = styles.scoreWarning;
  }

  // "23.1/101 p (22.9%)" when the exercise has points, else just "22.9%".
  const scoreExpr = maxScore > 0 ? (
    <>
      {parseFloat(score.toFixed(1))}/{maxScore} p{' '}
      <span className={styles.scorePercentDim}>({scorePercentage.toFixed(1)}%)</span>
    </>
  ) : (
    <>{scorePercentage.toFixed(1)}%</>
  );

  if (exerciseType === 'programming') {
    // Build failed takes precedence (a compile failure usually ran no tests).
    if (buildFailed) {
      return (
        <div className={clsx(styles.buildStatus, className)}>
          <div className={styles.buildFailedRow}>
            <span className={styles.buildFailedIcon} aria-hidden="true">✕</span>
            <span className={styles.buildFailedText}>Build failed</span>
          </div>
          <div className={styles.buildFailedActions}>
            <Button variant="primary" onClick={onGoToSource}>Go to source</Button>
            <Button variant="link" onClick={onViewBuildLog}>Open log</Button>
            {hasTestInfo && (
              <Button variant="link" onClick={onOpenTestResults}>Results</Button>
            )}
          </div>
        </div>
      );
    }

    // Finished with test-case info: outlined test badge + points + Results link.
    if (hasTestInfo && totalTests > 0) {
      const passPercentage = (passedTests / totalTests) * 100;
      const badgeColorClass = passPercentage >= 80 ? styles.testBadgeSuccess
        : passPercentage >= 40 ? styles.testBadgeWarning
        : styles.testBadgeError;
      return (
        <div className={clsx(styles.buildStatus, className)}>
          <div className={styles.buildRow}>
            <span className={clsx(styles.testBadge, badgeColorClass)}>
              {passedTests}/{totalTests} tests
            </span>
            <span className={clsx(styles.scoreExpr, scoreColorClass)}>{scoreExpr}</span>
            <Button variant="link" onClick={onOpenTestResults}>Results</Button>
          </div>
        </div>
      );
    }

    // Finished, no test-case info: status badge (Build Success / Tests Failed) + points, no Results.
    const statusLabel = status === 'success' ? 'Build Success' : 'Tests Failed';
    const statusBadgeClass = status === 'success' ? styles.testBadgeSuccess : styles.testBadgeError;
    return (
      <div className={clsx(styles.buildStatus, className)}>
        <div className={styles.buildRow}>
          <span className={clsx(styles.testBadge, statusBadgeClass)}>{statusLabel}</span>
          <span className={clsx(styles.scoreExpr, scoreColorClass)}>{scoreExpr}</span>
        </div>
      </div>
    );
  }

  // Non-programming exercise status
  let statusText = 'Submission Status';
  let statusBadgeForNonProgramming: ReactNode = null;

  if (status === 'success') {
    statusText = 'Latest Submission Status';
    statusBadgeForNonProgramming = <span className={clsx(styles.statusBadge, styles.statusBadgeSuccess)}>Submitted</span>;
  } else if (status === 'partial') {
    statusText = 'Current Status';
    statusBadgeForNonProgramming = <span className={clsx(styles.statusBadge, styles.statusBadgeBuilding)}>Draft Saved</span>;
  } else {
    statusBadgeForNonProgramming = <span className={clsx(styles.statusBadge, styles.statusBadgeFailed)}>No Submission</span>;
  }

  return (
    <div className={clsx(styles.buildStatus, className)}>
      <div className={styles.buildStatusTitle}>{statusText}</div>
      <div className={styles.buildStatusInfo}>
        {statusBadgeForNonProgramming}
        {maxScore > 0 && (
          <div className={styles.scoreInfo}>
            Score:{' '}
            <span className={clsx(styles.scorePoints, scoreColorClass)}>
              {parseFloat(score.toFixed(1))}/{maxScore} ({scorePercentage.toFixed(1)}%)
            </span>{' '}
            {maxScore === 1 ? 'point' : 'points'}
          </div>
        )}
      </div>
    </div>
  );
}
