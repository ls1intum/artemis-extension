import { useState, useEffect, useRef } from 'react';
import type { IrisStageDTO } from '../types';
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
    activeStage?: IrisStageDTO | null;
}

export function ThinkingIndicator({
    isVisible = true,
    activeStage = null,
}: ThinkingIndicatorProps) {
    if (!isVisible) { return null; }

    if (activeStage?.state === 'ERROR') {
        return (
            <div className={styles.container}>
                <div className={styles.errorContainer} role="alert">
                    <span className={styles.errorIcon} aria-hidden="true">&#9888;</span>
                    <span className={styles.errorText}>{activeStage.message || 'An error occurred'}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.dotsContainer}>
                {activeStage?.state === 'IN_PROGRESS' ? (
                    <StageLabel activeStage={activeStage} />
                ) : null}
                <span className={styles.dot} style={{ animationDelay: '0s' }} />
                <span className={styles.dot} style={{ animationDelay: '0.2s' }} />
                <span className={styles.dot} style={{ animationDelay: '0.4s' }} />
            </div>
        </div>
    );
}

/** Internal component managing label rotation, keyed on stageKey for stable identity */
function StageLabel({ activeStage }: { activeStage: IrisStageDTO }) {
    const stageKey = `${activeStage.name}:${activeStage.state}`;
    const initialLabel = (activeStage.message && activeStage.message.length > 0)
        ? activeStage.message
        : ROTATION_LABELS[0];

    const [displayLabel, setDisplayLabel] = useState(initialLabel);
    const [animKey, setAnimKey] = useState(0);
    const rotationIndex = useRef(0);

    // Effect 1: Reset rotation when stage identity changes
    useEffect(() => {
        const startLabel = (activeStage.message && activeStage.message.length > 0)
            ? activeStage.message
            : ROTATION_LABELS[0];
        rotationIndex.current = 0;
        setDisplayLabel(startLabel);
        setAnimKey((k) => k + 1);

        const interval = setInterval(() => {
            rotationIndex.current = (rotationIndex.current + 1) % ROTATION_LABELS.length;
            setDisplayLabel(ROTATION_LABELS[rotationIndex.current]);
            setAnimKey((k) => k + 1);
        }, ROTATION_INTERVAL_MS);

        return () => clearInterval(interval);
        // Intentionally keyed on stageKey only — restarts rotation when stage identity changes
    }, [stageKey]);

    // Effect 2: Update label when server message changes without restarting timer
    useEffect(() => {
        if (activeStage.message && activeStage.message.length > 0) {
            setDisplayLabel(activeStage.message);
            setAnimKey((k) => k + 1);
        }
        // Intentionally only reacts to message text changes, not full stageKey re-keying
    }, [activeStage.message]);

    return (
        <span className={styles.statusText} aria-live="polite">
            <span key={animKey} className={styles.labelWrapper}>
                {displayLabel}
            </span>
        </span>
    );
}
