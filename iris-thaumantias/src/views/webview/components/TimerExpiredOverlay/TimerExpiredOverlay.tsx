import { Button } from '../Button/Button';
import styles from './TimerExpiredOverlay.module.css';

interface TimerExpiredOverlayProps {
    visible: boolean;
    onDismiss: () => void;
}

/**
 * Modal overlay shown when exam timer reaches zero.
 * Informs student that exam time has expired and submissions are no longer allowed.
 */
export function TimerExpiredOverlay({ visible, onDismiss }: TimerExpiredOverlayProps) {
    if (!visible) {
        return null;
    }

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <h2 className={styles.title}>Time's Up</h2>
                <p className={styles.message}>
                    The exam time has expired. You can still view your work, but no further submissions are allowed.
                </p>
                <Button onClick={onDismiss} variant="primary">
                    Close
                </Button>
            </div>
        </div>
    );
}
