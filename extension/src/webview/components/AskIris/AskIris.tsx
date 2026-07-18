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
  onLevelChange: (level: ProactiveLevel) => void;
  /** #342: opens the settings UI at the code-reading consent; only used for reason `consent-missing`. */
  onOpenConsentSettings?: () => void;
}

interface AskIrisProps {
  description: string;
  onClick: () => void;
  proactiveControl?: ProactiveControlVM;
}

/** Per-state note shown in the proactive section (the full §14 banner for `unavailable` lives in the exercise view). */
const NOTE: Partial<Record<ProactiveCardState, string>> = {
  'off-course': 'Proactive help is disabled for this course.',
  degraded: 'Proactive help is unavailable right now.',
};

export function AskIris({ description, onClick, proactiveControl }: AskIrisProps) {
  const state = proactiveControl?.cardState;
  // Unavailable (§14 cases 2-3) is a full shut-off: Iris is off for this repo/exercise, so disable Ask too.
  const askDisabled = state === 'unavailable';
  // #342: missing code-reading consent renders as a forced Off — segments visible but disabled, with an
  // enable path below. The other degraded cause (404-latched server) keeps its segment-free note.
  const consentMissing = state === 'degraded' && proactiveControl?.reason === 'consent-missing';
  // The segments show where proactive can run (available) or where the OFF state itself is the message
  // (off-course, consent-missing); read-only in the latter two.
  const showSegments = state === 'available' || state === 'off-course' || consentMissing;
  const segmentsDisabled = state === 'off-course' || consentMissing;

  return (
    <Container padding="cozy">
      <div className={styles.main}>
        <div className={styles.logoCol}>
          <img
            className={styles.logo}
            src={document.getElementById('root')?.dataset.irisLogoUri}
            alt=""
          />
        </div>
        <div className={styles.textCol}>
          <h3 className={styles.title}>Ask Iris</h3>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.buttonCol}>
          <Button variant="primary" onClick={onClick} disabled={askDisabled}>Ask</Button>
        </div>
      </div>

      {/* Proactive-help control, divided off from the chat access above (spec §12.2). Hidden on the full
          shut-off (unavailable), which the exercise view's §14 banner already explains. */}
      {proactiveControl && state !== 'unavailable' && (
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
