import styles from './ThinkingIndicator.module.css';

interface ThinkingIndicatorProps {
    isVisible?: boolean;
}

export function ThinkingIndicator({ isVisible = true }: ThinkingIndicatorProps) {
    if (!isVisible) return null;

    return (
        <div className={styles.container}>
            <div className={styles.dotsContainer}>
                <span className={styles.dot} style={{ animationDelay: '0s' }} />
                <span className={styles.dot} style={{ animationDelay: '0.2s' }} />
                <span className={styles.dot} style={{ animationDelay: '0.4s' }} />
            </div>
        </div>
    );
}
