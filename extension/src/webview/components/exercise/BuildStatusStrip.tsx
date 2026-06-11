import clsx from 'clsx';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';

import { useBuildProgress } from '@webview/hooks/useBuildProgress';

import styles from './BuildStatusStrip.module.css';
import type { SubmissionStatusType } from './SubmissionStatus';

interface BuildStatusStripProps {
  status: SubmissionStatusType;
  /** Whether the full build-status card is currently visible in the viewport. */
  cardInView: boolean;
  estimatedCompletionDate?: string;
  buildStartDate?: string;
  buildFailed?: boolean;
  hasTestInfo?: boolean;
  totalTests?: number;
  passedTests?: number;
  /** Scrolls the exercise view back to the full build-status card. */
  onScrollToCard: () => void;
}

function isLive(status: SubmissionStatusType): boolean {
  return status === 'building' || status === 'pending';
}

/**
 * Slim fixed strip pinned to the top of the Exercise Detail webview. Shows
 * the build countdown + progress bar while a build runs and the full
 * SubmissionStatus card is scrolled out of view (issue #280).
 */
export function BuildStatusStrip({
  status,
  cardInView,
  estimatedCompletionDate,
  buildStartDate,
  onScrollToCard,
}: BuildStatusStripProps) {
  const { etaSeconds, progressPercent } = useBuildProgress(
    status === 'building',
    buildStartDate,
    estimatedCompletionDate,
  );

  if (cardInView || !isLive(status)) {
    return null;
  }

  const hasDeterminateProgress = status === 'building' && progressPercent !== null;

  return (
    <div className={styles.strip}>
      <span className={styles.spinner} aria-hidden="true" />
      {/* Live region scoped to the static label only: the 1Hz ETA countdown
          and the progress bar are visual-only, otherwise screen readers
          would announce every tick. */}
      <span className={styles.label} role="status">
        {status === 'pending' ? 'Build queued…' : 'Building…'}
      </span>
      <div className={styles.progressTrack} aria-hidden="true">
        <div
          className={clsx(styles.progressBar, {
            [styles.progressBarIndeterminate]: !hasDeterminateProgress,
          })}
          style={hasDeterminateProgress ? { width: `${progressPercent}%` } : undefined}
        />
      </div>
      {etaSeconds !== null && (
        <span className={styles.eta} aria-hidden="true">ETA: {etaSeconds}s</span>
      )}
      <button
        type="button"
        className={styles.scrollButton}
        onClick={onScrollToCard}
        aria-label="Scroll to build status"
        title="Scroll to build status"
      >
        <ChevronUp size={14} />
      </button>
    </div>
  );
}
