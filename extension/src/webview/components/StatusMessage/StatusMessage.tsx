import clsx from 'clsx';

import styles from './StatusMessage.module.css';

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
