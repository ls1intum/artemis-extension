import styles from './StatusMessage.module.css';
import clsx from 'clsx';

type StatusType = 'success' | 'error' | 'warning' | 'info';

interface StatusMessageProps {
    message: string;
    type: StatusType;
    'data-testid'?: string;
}

export function StatusMessage({ message, type, 'data-testid': testId }: StatusMessageProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            className={clsx(styles.statusMessage, styles[type])}
            data-testid={testId}
        >
            {message}
        </div>
    );
}
