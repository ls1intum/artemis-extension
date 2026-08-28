import clsx from 'clsx';
import { ReactNode } from 'react';

import styles from './Button.module.css';

interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'icon' | 'link' | 'ghost';
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
  icon?: ReactNode;
  alignText?: 'left' | 'center' | 'right';
  type?: 'button' | 'submit' | 'reset';
  testId?: string;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className,
  fullWidth = false,
  icon,
  alignText,
  type = 'button',
  testId,
}: ButtonProps) {
  const hasIconAndLabel = Boolean(icon && children);
  const isIconOnly = Boolean(icon && !children);

  const buttonClasses = clsx(
    styles.btn,
    styles[`btn${variant.charAt(0).toUpperCase()}${variant.slice(1)}`],
    {
      [styles.btnFullWidth]: fullWidth,
      [styles.btnDisabled]: disabled,
      [styles.btnWithIcon]: hasIconAndLabel,
      [styles[`btnAlign${alignText?.charAt(0).toUpperCase()}${alignText?.slice(1)}`]]: alignText,
    },
    className
  );

  let content: ReactNode = children;
  if (isIconOnly) {
    content = icon;
  } else if (hasIconAndLabel) {
    content = (
      <>
        <span className={styles.btnIconSlot}>{icon}</span>
        <span className={styles.btnLabel}>{children}</span>
      </>
    );
  }

  return (
    <button
      type={type}
      className={buttonClasses}
      disabled={disabled}
      onClick={onClick}
      aria-label={isIconOnly ? 'button' : undefined}
      data-testid={testId}
    >
      {content}
    </button>
  );
}
