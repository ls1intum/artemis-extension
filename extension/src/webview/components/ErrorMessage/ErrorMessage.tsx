import styles from './ErrorMessage.module.css';

export interface ErrorMessageProps {
    error: string;
    onRetry: () => void;
}

export function ErrorMessage({ error, onRetry }: ErrorMessageProps) {
    return (
        <div className={styles.errorContainer}>
            <p className={styles.errorMessage}>{error}</p>
            <button
                type="button"
                className={styles.retryLink}
                onClick={onRetry}
            >
                Retry
            </button>
        </div>
    );
}
