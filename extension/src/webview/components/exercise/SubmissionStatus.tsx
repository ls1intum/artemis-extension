import clsx from 'clsx';
import { ReactNode } from 'react';

import { Badge } from '@webview/components/Badge';
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
  const { etaSeconds, progressPercent } = useBuildProgress(
    status === 'building',
    buildStartDate,
    estimatedCompletionDate,
  );

  if (status === 'no-submission' && exerciseType === 'programming') {
    return (
      <div className={clsx(styles.buildStatus, styles.buildStatusEmpty, className)}>
        <div className={styles.buildStatusTitle}>Latest Build Status</div>
        <div className={styles.buildStatusInfo}>
          <div className={styles.buildStatusPlaceholder}>
            No submissions yet. Submit to see build results.
          </div>
        </div>
      </div>
    );
  }

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
        <div className={styles.buildStatusTitle}>Build in Progress</div>
        <div className={styles.buildStatusInfo}>
          <div className={styles.buildStatusMessage}>{message}</div>
          <div className={styles.buildProgressTrack}>
            <div
              className={clsx(styles.buildProgressBar, {
                [styles.buildProgressBarIndeterminate]: !hasDeterminateProgress,
              })}
              style={hasDeterminateProgress ? { width: `${progressPercent}%` } : undefined}
            />
          </div>
        </div>
      </div>
    );
  }

  let statusBadge: ReactNode = null;
  if (buildFailed) {
    statusBadge = <Badge variant="error">Build Failed</Badge>;
  } else if (hasTestInfo && totalTests > 0) {
    const passPercentage = (passedTests / totalTests) * 100;
    const badgeVariant = passPercentage >= 80 ? 'success' : passPercentage >= 40 ? 'warning' : 'error';
    statusBadge = <Badge variant={badgeVariant}>{passedTests}/{totalTests} tests passed</Badge>;
  } else {
    statusBadge = status === 'success' ? (
      <Badge variant="success">Build Success</Badge>
    ) : (
      <Badge variant="error">Tests Failed</Badge>
    );
  }

  let scoreColorClass = styles.scoreError;
  if (scorePercentage >= 80) {
    scoreColorClass = styles.scoreSuccess;
  } else if (scorePercentage >= 40) {
    scoreColorClass = styles.scoreWarning;
  }

  if (exerciseType === 'programming') {
    return (
      <div className={clsx(styles.buildStatus, className)}>
        <div className={styles.buildStatusTitle}>Latest Build Status</div>
        <div className={styles.buildStatusInfo}>
          {statusBadge}
          <div className={styles.scoreInfo}>
            Score:{' '}
            <span className={clsx(styles.scorePoints, scoreColorClass)}>
              {parseFloat(score.toFixed(1))}/{maxScore} ({scorePercentage.toFixed(1)}%)
            </span>{' '}
            {maxScore === 1 ? 'point' : 'points'}
          </div>
        </div>

        {(buildFailed || hasTestInfo) && (
          <div className={styles.testResultsToggleContainer}>
            {buildFailed && (
              <>
                <Button variant="link" onClick={onViewBuildLog}>
                  View build log
                </Button>
                <Button variant="link" onClick={onGoToSource}>
                  Go to source →
                </Button>
              </>
            )}
            {hasTestInfo && (
              <Button variant="link" onClick={onOpenTestResults}>
                See test results
              </Button>
            )}
          </div>
        )}

      </div>
    );
  }

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
