import { Button } from '../Button';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
    title: string;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
}

export function EmptyState({
    title,
    message,
    actionLabel,
    onAction,
}: EmptyStateProps) {
    return (
        <div className={styles.emptyState}>
            <h2 className={styles.emptyStateTitle}>{title}</h2>
            <p className={styles.emptyStateMessage}>{message}</p>
            {actionLabel && onAction && (
                <Button onClick={onAction}>
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}
