import clsx from 'clsx';

import type { ProactiveCardReason, ProactiveCardState, ProactiveLevel } from '@shared/messageContracts';

import { Button, Container } from '@webview/components';

import styles from './AskIris.module.css';

/** The three segments of the proactive-help control, in display order. */
const PROACTIVE_SEGMENTS: readonly { level: ProactiveLevel; label: string }[] = [
  { level: 'off', label: 'Off' },
  { level: 'less', label: 'Less' },
  { level: 'more', label: 'More' },
];

/** View-model for the per-exercise proactive struggle control (spec §12.2 / §14): rendered only when the host supplies it. */
interface ProactiveControlVM {
  level: ProactiveLevel;
  /** Which availability state to render (Available / Off-course / Unavailable / Degraded). */
  cardState: ProactiveCardState;
  /** Why a non-"available" card is in that state (host-derived). */
  reason?: ProactiveCardReason;
  /** False in the clean/no-engine build: the card is a chat-availability reflection with no level control. */
  controlAvailable: boolean;
  onLevelChange: (level: ProactiveLevel) => void;
  /** #342: opens the settings UI at the code-reading consent; only used for reason `consent-missing`. */
  onOpenConsentSettings?: () => void;
}

interface AskIrisProps {
  description: string;
  onClick: () => void;
  proactiveControl?: ProactiveControlVM;
}

/** Per-state note shown in the proactive section (the notice for `unavailable` lives in-card, above). */
const NOTE: Partial<Record<ProactiveCardState, string>> = {
  'off-course': 'Proactive help is disabled for this course.',
  degraded: 'Proactive help is unavailable right now.',
};

export function AskIris({ description, onClick, proactiveControl }: AskIrisProps) {
  const state = proactiveControl?.cardState;
  const unavailable = state === 'unavailable';
  const askDisabled = unavailable;
  const consentMissing = state === 'degraded' && proactiveControl?.reason === 'consent-missing';
  const showSegments = state === 'available' || state === 'off-course' || consentMissing;
  const segmentsDisabled = state === 'off-course' || consentMissing;
  const showProactive = Boolean(proactiveControl?.controlAvailable) && !unavailable;
  const noticeText = unavailable
    ? (proactiveControl?.reason === 'noai'
        ? 'A .noai file disables Iris for this repository, including the chat.'
        : 'Iris is not available for this exercise.')
    : undefined;
  const shownDescription = unavailable ? 'The Iris chat is turned off here.' : description;

  return (
    <Container padding="cozy" testId="ask-iris-card">
      {noticeText && (
        <div className={styles.notice} role="status">
          <svg className={styles.noticeIcon} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 118 2.5a5.5 5.5 0 010 11zM7.25 7h1.5v4.5h-1.5V7zm0-2.5h1.5V6h-1.5V4.5z"/>
          </svg>
          <span>{noticeText}</span>
        </div>
      )}
      <div className={clsx(styles.main, unavailable && styles.mainMuted)}>
        <div className={styles.logoCol}>
          <img
            className={styles.logo}
            src={document.getElementById('root')?.dataset.irisLogoUri}
            alt=""
          />
        </div>
        <div className={styles.textCol}>
          <h3 className={styles.title}>Ask Iris</h3>
          <p className={styles.description}>{shownDescription}</p>
        </div>
        <div className={styles.buttonCol}>
          <Button variant="primary" onClick={onClick} disabled={askDisabled} className={unavailable ? styles.unavailableAsk : undefined}>Ask</Button>
        </div>
      </div>

      {/* Proactive-help control, divided off from the chat access above (spec §12.2). Hidden when the card is
          `unavailable` (its notice above already explains) OR the engine seam is absent (clean/no-engine build). */}
      {showProactive && proactiveControl && (
        <>
          <hr className={styles.divider} />
          <div className={styles.proactive}>
            <div className={styles.proactiveRow}>
              {/* Heading + explanation so the control is self-explanatory (spec §12.2 awareness indicator: "is Iris watching?"). */}
              <div className={styles.proactiveText}>
                <h4 className={styles.proactiveTitle}>Proactive help</h4>
                <p className={styles.proactiveDescription}>
                  Let Iris follow along and offer a hint on its own when you seem stuck. Off waits until you ask; More steps in sooner and more often.
                </p>
              </div>
              {showSegments && (
                <span role="radiogroup" aria-label="Proactive help level" className={styles.segmented}>
                  {PROACTIVE_SEGMENTS.map(seg => (
                    <button
                      key={seg.level}
                      type="button"
                      role="radio"
                      aria-checked={proactiveControl.level === seg.level}
                      title="Off: Iris only helps when you click Ask. Less and More let Iris offer hints on its own; More nudges sooner and more often."
                      className={styles.segment}
                      disabled={segmentsDisabled}
                      onClick={() => proactiveControl.onLevelChange(seg.level)}
                    >
                      {seg.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
            {consentMissing ? (
              <span className={styles.cardNote}>
                Proactive help needs your consent to let Iris read your code.{' '}
                <button type="button" className={styles.consentLink} onClick={() => proactiveControl.onOpenConsentSettings?.()}>
                  Enable in Settings
                </button>
              </span>
            ) : (state && NOTE[state] && <span className={styles.cardNote}>{NOTE[state]}</span>)}
          </div>
        </>
      )}
    </Container>
  );
}
