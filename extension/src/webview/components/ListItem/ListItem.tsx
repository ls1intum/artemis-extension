import clsx from 'clsx';
import { ReactNode } from 'react';

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
  testId?: string;
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
  testId,
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
      /*
       * A row here navigates; it is not one choice in a set. `option` says the
       * latter and is only valid inside a `listbox`, which no caller provides, so
       * axe reports it as a critical `aria-required-parent`. `aria-current` is the
       * attribute for "this is the one you are on" and is valid on any role. The
       * rest of the codebase reaches for a real `<button>` here (see `CoursePicker`),
       * which is where this component should end up.
       */
      role="button"
      aria-current={selected ? 'true' : undefined}
      aria-disabled={disabled}
      data-testid={testId}
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
