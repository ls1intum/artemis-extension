import { useEffect, useState } from 'react';
import clsx from 'clsx';
import styles from './BuildProgress.module.css';

export type BuildState = 'idle' | 'building' | 'queued' | 'success' | 'failed';

interface LogEntry {
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp?: string;
}

interface BuildProgressProps {
  status: BuildState;
  progress?: number;
  logEntries?: LogEntry[];
  message?: string;
  estimatedCompletionDate?: string;
  buildStartDate?: string;
  className?: string;
}

export function BuildProgress({
  status,
  progress = 5,
  logEntries = [],
  message,
  estimatedCompletionDate,
  buildStartDate,
  className,
}: BuildProgressProps) {
  const [calculatedProgress, setCalculatedProgress] = useState(progress);
  const [displayMessage, setDisplayMessage] = useState(message || '');
  const [isIndeterminate, setIsIndeterminate] = useState(true);

  // Calculate progress based on ETA
  useEffect(() => {
    if (status === 'building' && estimatedCompletionDate && buildStartDate) {
      const eta = new Date(estimatedCompletionDate);
      const startDate = new Date(buildStartDate);

      const updateProgress = () => {
        const now = new Date();
        const totalTime = eta.getTime() - startDate.getTime();
        const elapsed = now.getTime() - startDate.getTime();
        const percent = Math.min(100, Math.max(5, (elapsed / totalTime) * 100));

        setCalculatedProgress(percent);
        setIsIndeterminate(false);

        const seconds = Math.max(0, Math.floor((eta.getTime() - now.getTime()) / 1000));
        if (seconds > 0) {
          setDisplayMessage(`Building your submission... (ETA: ${seconds}s)`);
        } else {
          setDisplayMessage('Building your submission...');
          setIsIndeterminate(true);
        }
      };

      updateProgress();
      const interval = setInterval(updateProgress, 500);

      return () => clearInterval(interval);
    } else if (status === 'queued') {
      setCalculatedProgress(5);
      setIsIndeterminate(true);
      setDisplayMessage('⏳ Build queued, waiting for resources...');
    } else {
      setDisplayMessage(message || 'Building your submission...');
      setIsIndeterminate(true);
    }
  }, [status, estimatedCompletionDate, buildStartDate, message]);

  // Idle state - don't render anything
  if (status === 'idle') {
    return null;
  }

  return (
    <div className={clsx(styles.buildStatus, styles.buildStatusBuilding, className)}>
      <div className={styles.buildStatusTitle}>Build in Progress</div>
      <div className={styles.buildStatusInfo}>
        <div className={styles.buildStatusMessage}>{displayMessage}</div>
        <div className={styles.buildProgressTrack}>
          <div
            className={clsx(styles.buildProgressBar, {
              [styles.buildProgressBarIndeterminate]: isIndeterminate,
            })}
            style={!isIndeterminate ? { width: `${calculatedProgress}%` } : undefined}
          />
        </div>
      </div>

      {/* Log entries */}
      {logEntries.length > 0 && (
        <div className={styles.buildLogs}>
          <div className={styles.buildLogsTitle}>Build Logs</div>
          <div className={styles.buildLogsList}>
            {logEntries.map((entry, index) => (
              <div
                key={index}
                className={clsx(styles.logEntry, {
                  [styles.logEntryInfo]: entry.level === 'info',
                  [styles.logEntryWarning]: entry.level === 'warning',
                  [styles.logEntryError]: entry.level === 'error',
                })}
              >
                <span className={styles.logEntryLevel}>[{entry.level.toUpperCase()}]</span>
                {entry.timestamp && <span className={styles.logEntryTime}>{entry.timestamp}</span>}
                <span className={styles.logEntryMessage}>{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
