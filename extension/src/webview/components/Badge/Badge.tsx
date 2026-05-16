import clsx from 'clsx';
import { ReactNode } from 'react';

import styles from './Badge.module.css';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted';
  className?: string;
}

export function Badge({
  children,
  variant = 'default',
  className,
}: BadgeProps) {
  const badgeClasses = clsx(
    styles.badge,
    styles[`badge${variant.charAt(0).toUpperCase()}${variant.slice(1)}`],
    className
  );

  return (
    <span className={badgeClasses}>
      {children}
    </span>
  );
}
