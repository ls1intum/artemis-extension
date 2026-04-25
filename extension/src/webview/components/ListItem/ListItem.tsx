import { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './ListItem.module.css';

interface ListItemProps {
  children?: ReactNode;
  icon?: ReactNode;
  title?: string;
  subtitle?: string;
  badge?: ReactNode;
  action?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function ListItem({
  children,
  icon,
  title,
  subtitle,
  badge,
  action,
  onClick,
  selected = false,
  disabled = false,
  className,
  id,
}: ListItemProps) {
  const listItemClasses = clsx(
    styles.listItem,
    {
      [styles.listItemClickable]: Boolean(onClick),
      [styles.listItemSelected]: selected,
      [styles.listItemDisabled]: disabled,
    },
    className
  );

  const handleClick = () => {
    if (onClick && !disabled) {
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && onClick && !disabled) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      id={id}
      className={listItemClasses}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled}
      tabIndex={onClick && !disabled ? 0 : undefined}
    >
      {icon && <div className={styles.listItemIcon}>{icon}</div>}
      <div className={styles.listItemContent}>
        {title && <div className={styles.listItemTitle}>{title}</div>}
        {subtitle && <div className={styles.listItemSubtitle}>{subtitle}</div>}
        {children}
      </div>
      {badge && <div className={styles.listItemBadge}>{badge}</div>}
      {action && <div className={styles.listItemAction}>{action}</div>}
    </div>
  );
}
