import { useEffect, useRef, useState } from 'react';

import type { IrisRunState } from '@shared/types/apiResponses';

import styles from './ThinkingIndicator.module.css';

const ROTATION_LABELS = [
    'Thinking hard',
    'Analyzing context',
    'Processing your request',
    'Formulating a response',
];
const ROTATION_INTERVAL_MS = 2600;

interface ThinkingIndicatorProps {
    isVisible?: boolean;
    runState?: IrisRunState | null;
    error?: { message?: string } | null;
}

export function ThinkingIndicator({
    isVisible = true,
    runState = null,
    error = null,
}: ThinkingIndicatorProps) {
    // A failed run surfaces its error regardless of the waiting flag: the run
    // is over, so `isVisible` (the "still waiting" gate) no longer applies.
    if (runState === 'FAILED') {
        return (
            <div className={styles.container}>
                <div className={styles.errorContainer} role="alert">
                    <span className={styles.errorIcon} aria-hidden="true">&#9888;</span>
                    <span className={styles.errorText}>{error?.message || 'An error occurred'}</span>
                </div>
            </div>
        );
    }

    if (!isVisible) { return null; }

    const irisLogoUri = document.getElementById('root')?.dataset.irisLogoUri;

    return (
        <div className={styles.container} data-testid="thinking-indicator">
            {irisLogoUri && (
                <img src={irisLogoUri} alt="" className={styles.logo} />
            )}
            <RotatingLabel />
        </div>
    );
}

/** Cycles through the reassurance labels while a response is pending. */
function RotatingLabel() {
    const [displayLabel, setDisplayLabel] = useState(ROTATION_LABELS[0]);
    const [animKey, setAnimKey] = useState(0);
    const rotationIndex = useRef(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            rotationIndex.current = (rotationIndex.current + 1) % ROTATION_LABELS.length;
            setDisplayLabel(ROTATION_LABELS[rotationIndex.current]);
            setAnimKey((k) => k + 1);
        }, ROTATION_INTERVAL_MS);

        return () => clearInterval(intervalRef.current);
    }, []);

    return (
        <span className={styles.statusText} aria-live="polite">
            <span key={animKey} className={styles.labelWrapper}>
                {displayLabel}
            </span>
        </span>
    );
}
