import { Button, Container } from '@webview/components';

import styles from './AskIris.module.css';

/** View-model for the per-exercise proactive struggle control (spec §12.2): rendered only when the host supplies it. */
interface ProactiveControlVM {
  preference: 'on' | 'off';
  autoPaused: boolean;
  onToggle: (enabled: boolean) => void;
  onResume: () => void;
}

interface AskIrisProps {
  description: string;
  onClick: () => void;
  proactiveControl?: ProactiveControlVM;
}

export function AskIris({ description, onClick, proactiveControl }: AskIrisProps) {
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
              <button
                type="button"
                role="switch"
                aria-checked={proactiveControl.preference === 'on'}
                aria-label="Proactive struggle help"
                className={styles.proactiveSwitch}
                data-state={proactiveControl.preference}
                onClick={() => proactiveControl.onToggle(proactiveControl.preference !== 'on')}
              >
                {proactiveControl.preference === 'on' ? 'On' : 'Off'}
              </button>
              {proactiveControl.autoPaused && (
                <span className={styles.autoPaused}>
                  Auto-paused
                  <button type="button" className={styles.resume} onClick={proactiveControl.onResume}>Resume</button>
                </span>
              )}
            </div>
          )}
        </div>
        <div className={styles.buttonCol}>
          <Button variant="primary" onClick={onClick}>Ask</Button>
        </div>
      </div>
    </Container>
  );
}
