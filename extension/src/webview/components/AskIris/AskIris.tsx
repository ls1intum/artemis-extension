import type { ProactiveCardReason, ProactiveCardState } from '@shared/messageContracts';

import { Button, Container } from '@webview/components';

import styles from './AskIris.module.css';

/** View-model for the per-exercise proactive struggle control (spec §12.2 / §14): rendered only when the host supplies it. */
interface ProactiveControlVM {
  preference: 'on' | 'off';
  autoPaused: boolean;
  /** Which availability card to render (Available / Off-course / Unavailable / Degraded). */
  cardState: ProactiveCardState;
  /** Why a non-"available" card is in that state (host-derived). */
  reason?: ProactiveCardReason;
  onToggle: (enabled: boolean) => void;
  onResume: () => void;
}

interface AskIrisProps {
  description: string;
  onClick: () => void;
  proactiveControl?: ProactiveControlVM;
}

/** Per-state note shown next to the switch (the full §14 banner for `unavailable` lives in the exercise view). */
const NOTE: Partial<Record<ProactiveCardState, string>> = {
  'off-course': 'Proactive help is disabled for this course.',
  degraded: 'Proactive help is limited right now.',
};

export function AskIris({ description, onClick, proactiveControl }: AskIrisProps) {
  const state = proactiveControl?.cardState;
  // Unavailable (§14 cases 2-3) is a full shut-off: Iris is off for this repo/exercise, so disable Ask too.
  const askDisabled = state === 'unavailable';
  // The switch shows for every state where proactive CAN run (incl. degraded local-only); it is read-only for off-course.
  const showSwitch = state === 'available' || state === 'off-course' || state === 'degraded';
  const switchDisabled = state === 'off-course';

  return (
    <Container>
      <div className={styles.layout}>
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
          {proactiveControl && (
            <div className={styles.proactiveControl}>
              {showSwitch && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={proactiveControl.preference === 'on'}
                  aria-label="Proactive struggle help"
                  className={styles.proactiveSwitch}
                  data-state={proactiveControl.preference}
                  disabled={switchDisabled}
                  onClick={() => proactiveControl.onToggle(proactiveControl.preference !== 'on')}
                >
                  {proactiveControl.preference === 'on' ? 'On' : 'Off'}
                </button>
              )}
              {showSwitch && proactiveControl.autoPaused && state === 'available' && (
                <span className={styles.autoPaused}>
                  Auto-paused
                  <button type="button" className={styles.resume} onClick={proactiveControl.onResume}>Resume</button>
                </span>
              )}
              {state && NOTE[state] && <span className={styles.cardNote}>{NOTE[state]}</span>}
            </div>
          )}
        </div>
        <div className={styles.buttonCol}>
          <Button variant="primary" onClick={onClick} disabled={askDisabled}>Ask</Button>
        </div>
      </div>
    </Container>
  );
}
