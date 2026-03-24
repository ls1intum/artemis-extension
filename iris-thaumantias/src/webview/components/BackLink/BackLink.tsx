import { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './BackLink.module.css';

export interface BackLinkProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  actions?: ReactNode;
}

export function BackLink({
  children,
  onClick,
  className,
  actions,
}: BackLinkProps) {
  return (
    <div className={clsx(styles.backLinkRow, className)}>
      <button
        type="button"
        className={styles.backLink}
        onClick={onClick}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {children}
      </button>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
