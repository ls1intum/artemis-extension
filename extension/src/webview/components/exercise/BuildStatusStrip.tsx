import clsx from 'clsx';
import Check from 'lucide-react/dist/esm/icons/check';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import TriangleAlert from 'lucide-react/dist/esm/icons/triangle-alert';
import X from 'lucide-react/dist/esm/icons/x';
import { useEffect, useRef, useState } from 'react';

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

const RESULT_FLASH_MS = 5000;

type FlashStatus = 'success' | 'partial' | 'failed';

function isFlashable(status: SubmissionStatusType): status is FlashStatus {
  return status === 'success' || status === 'partial' || status === 'failed';
}

interface FlashContent {
  variant: FlashStatus;
  text: string;
}

/**
 * Text mirrors the SubmissionStatus card's badge. The icon/color variant
 * follows the score-derived status (per spec), which can differ from the
 * card's pass-ratio badge color when tests are weighted.
 */
function flashContent(
  flash: FlashStatus,
  buildFailed: boolean,
  hasTestInfo: boolean,
  totalTests: number,
  passedTests: number,
): FlashContent {
  if (buildFailed) {
    return { variant: 'failed', text: 'Build failed' };
  }
  if (hasTestInfo && totalTests > 0) {
    return { variant: flash, text: `${passedTests}/${totalTests} tests passed` };
  }
  return flash === 'success'
    ? { variant: 'success', text: 'Build succeeded' }
    : { variant: 'failed', text: 'Tests failed' };
}

const FLASH_ICONS: Record<FlashStatus, typeof Check> = {
  success: Check,
  partial: TriangleAlert,
  failed: X,
};

// Static lookup instead of a dynamic `styles[...]` key: the production
// esbuild CSS-modules plugin exports camelCase-only class names, so a
// computed kebab-case key would silently resolve to undefined.
const FLASH_ICON_CLASS: Record<FlashStatus, string> = {
  success: styles.flashIconSuccess,
  partial: styles.flashIconPartial,
  failed: styles.flashIconFailed,
};

/**
 * Slim fixed strip pinned to the top of the Exercise Detail webview. Shows
 * the build countdown + progress bar while a build runs and the full
 * SubmissionStatus card is scrolled out of view.
 *
 * Also flashes the build result for 5 s when the build finishes out of view,
 * then disappears automatically.
 */
export function BuildStatusStrip({
  status,
  cardInView,
  estimatedCompletionDate,
  buildStartDate,
  buildFailed = false,
  hasTestInfo = false,
  totalTests = 0,
  passedTests = 0,
  onScrollToCard,
}: BuildStatusStripProps) {
  const [flashStatus, setFlashStatus] = useState<FlashStatus | null>(null);
  const prevStatusRef = useRef(status);
  const prevCardInViewRef = useRef(cardInView);

  // Detect the build-finished transition (live → completed) out of view.
  useEffect(() => {
    const prev = prevStatusRef.current;
    const prevCardInView = prevCardInViewRef.current;
    prevStatusRef.current = status;
    prevCardInViewRef.current = cardInView;

    if (isLive(status)) {
      // A new build started, so any lingering flash is stale.
      setFlashStatus(null);
      return;
    }
    // Flash only when the card was out of view in the render before the
    // completion as well. If the user was just watching the card, they
    // already saw the build status, so no notification is needed.
    if (isLive(prev) && isFlashable(status) && !cardInView && !prevCardInView) {
      setFlashStatus(status);
    }
  }, [status, cardInView]);

  // Auto-fade the flash; cancel it when the card scrolls into view.
  useEffect(() => {
    if (flashStatus === null) {
      return;
    }
    if (cardInView) {
      setFlashStatus(null);
      return;
    }
    const timer = setTimeout(() => setFlashStatus(null), RESULT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashStatus, cardInView]);

  const { etaSeconds, progressPercent } = useBuildProgress(
    status === 'building',
    buildStartDate,
    estimatedCompletionDate,
  );

  if (cardInView) {
    return null;
  }

  const scrollButton = (
    <button
      type="button"
      className={styles.scrollButton}
      onClick={onScrollToCard}
      aria-label="Scroll to build status"
      title="Scroll to build status"
    >
      <ChevronUp size={14} />
    </button>
  );

  if (isLive(status)) {
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
        {scrollButton}
      </div>
    );
  }

  if (flashStatus !== null) {
    const content = flashContent(flashStatus, buildFailed, hasTestInfo, totalTests, passedTests);
    const Icon = FLASH_ICONS[content.variant];

    return (
      <div className={styles.strip}>
        <Icon size={14} className={FLASH_ICON_CLASS[content.variant]} aria-hidden="true" />
        <span className={styles.label} role="status">{content.text}</span>
        <span className={styles.flashSpacer} />
        {scrollButton}
      </div>
    );
  }

  return null;
}
