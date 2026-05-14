import { ReactNode } from 'react';
import clsx from 'clsx';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import styles from './BackLink.module.css';

interface BackLinkProps {
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
        <ChevronLeft size={16} />
        {children}
      </button>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
