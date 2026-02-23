import { ReactNode } from 'react';
import clsx from 'clsx';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Container } from '../Container';
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
}

export interface Feedback {
  type: 'positive' | 'negative' | 'neutral';
  text: string;
}

export interface SubmissionStatusProps {
  status: SubmissionStatusType;
  score?: number;
  maxScore?: number;
  scorePercentage?: number;
  totalTests?: number;
  passedTests?: number;
  hasTestInfo?: boolean;
  buildFailed?: boolean;
  feedbacks?: Feedback[];
  testCases?: TestCase[];
  buildLogs?: string;
  onShowDetails?: () => void;
  onViewBuildLog?: () => void;
  onGoToSource?: () => void;
  onToggleTestResults?: () => void;
  showTestResults?: boolean;
  loadingTestResults?: boolean;
  className?: string;
  exerciseType?: 'programming' | 'quiz' | 'modeling' | 'text' | 'file-upload';
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
  feedbacks = [],
  testCases = [],
  buildLogs,
  onShowDetails,
  onViewBuildLog,
  onGoToSource,
  onToggleTestResults,
  showTestResults = false,
  loadingTestResults = false,
  className,
  exerciseType = 'programming',
}: SubmissionStatusProps) {
  // Empty state for programming exercises with no submissions
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

  // Building/pending state
  if (status === 'building' || status === 'pending') {
    return (
      <div className={clsx(styles.buildStatus, styles.buildStatusBuilding, className)}>
        <div className={styles.buildStatusTitle}>Build in Progress</div>
        <div className={styles.buildStatusInfo}>
          <div className={styles.buildStatusMessage}>
            {status === 'building' ? 'Building your submission...' : '⏳ Build queued, waiting for resources...'}
          </div>
          <div className={styles.buildProgressTrack}>
            <div className={clsx(styles.buildProgressBar, styles.buildProgressBarIndeterminate)} />
          </div>
        </div>
      </div>
    );
  }

  // Generate status badge for completed builds
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

  // Determine score color class
  let scoreColorClass = styles.scoreError;
  if (scorePercentage >= 80) {
    scoreColorClass = styles.scoreSuccess;
  } else if (scorePercentage >= 40) {
    scoreColorClass = styles.scoreWarning;
  }

  // Programming exercise status
  if (exerciseType === 'programming') {
    return (
      <div className={clsx(styles.buildStatus, className)}>
        <div className={styles.buildStatusTitle}>Latest Build Status</div>
        <div className={styles.buildStatusInfo}>
          {statusBadge}
          <div className={styles.scoreInfo}>
            Score:{' '}
            <span className={clsx(styles.scorePoints, scoreColorClass)}>
              {score}/{maxScore} ({scorePercentage.toFixed(2)}%)
            </span>{' '}
            {maxScore === 1 ? 'point' : 'points'}
          </div>
        </div>

        {/* Action buttons */}
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
              <Button variant="link" onClick={onToggleTestResults}>
                {showTestResults ? 'Hide test results' : 'See test results'}
              </Button>
            )}
          </div>
        )}

        {/* Test results modal */}
        {hasTestInfo && showTestResults && (
          <div
            className={clsx(styles.testResultsModal, { [styles.testResultsModalOpen]: showTestResults })}
            onClick={(e) => {
              if ((e.target as HTMLElement).classList.contains(styles.testResultsModal)) {
                onToggleTestResults?.();
              }
            }}
          >
            <div className={styles.testResultsModalContent}>
              <div className={styles.testResultsModalHeader}>
                <div className={styles.testResultsModalTitle}>Test Results</div>
                <Button variant="icon" onClick={onToggleTestResults}>
                  ✕
                </Button>
              </div>
              <div className={styles.testResultsModalBody}>
                {loadingTestResults ? (
                  <div className={styles.testResultsLoading}>Loading test results...</div>
                ) : testCases.length > 0 ? (
                  <div className={styles.testResultsList}>
                    <div className={styles.testResultsCount}>
                      {testCases.length} test{testCases.length !== 1 ? 's' : ''}
                    </div>
                    {testCases.map((testCase, index) => (
                      <div
                        key={index}
                        className={clsx(styles.testResultItem, {
                          [styles.testResultItemPassed]: testCase.passed,
                          [styles.testResultItemFailed]: !testCase.passed,
                        })}
                      >
                        <div
                          className={clsx(styles.testResultIcon, {
                            [styles.testResultIconPassed]: testCase.passed,
                            [styles.testResultIconFailed]: !testCase.passed,
                          })}
                        >
                          {testCase.passed ? '✓' : '✗'}
                        </div>
                        <div className={styles.testResultContent}>
                          <div className={styles.testResultHeader}>
                            <div className={styles.testResultName}>{testCase.name}</div>
                            {testCase.type && (
                              <span
                                className={clsx(
                                  styles.testTypeBadge,
                                  testCase.type === 'structural'
                                    ? styles.testTypeBadgeStructural
                                    : styles.testTypeBadgeBehavioral
                                )}
                              >
                                {testCase.type}
                              </span>
                            )}
                          </div>
                          {testCase.message && (
                            <div className={styles.testResultMessage}>{testCase.message}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.testResultsEmpty}>No test results available.</div>
                )}
              </div>
            </div>
          </div>
        )}
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
              {score}/{maxScore} ({scorePercentage.toFixed(2)}%)
            </span>{' '}
            {maxScore === 1 ? 'point' : 'points'}
          </div>
        )}
      </div>
    </div>
  );
}
