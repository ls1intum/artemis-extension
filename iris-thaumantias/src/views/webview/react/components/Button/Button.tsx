import { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Button.module.css';

export interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'icon' | 'link' | 'ghost';
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
  icon?: ReactNode;
  width?: string;
  height?: string;
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
  width,
  height,
  alignText,
  type = 'button',
  testId,
}: ButtonProps) {
  const hasIconAndLabel = Boolean(icon && children);
  const isIconOnly = Boolean(icon && !children);
  const hasFixedSize = Boolean(width || height);

  const buttonClasses = clsx(
    styles.btn,
    styles[`btn${variant.charAt(0).toUpperCase()}${variant.slice(1)}`],
    {
      [styles.btnFullWidth]: fullWidth,
      [styles.btnDisabled]: disabled,
      [styles.btnWithIcon]: hasIconAndLabel,
      [styles.btnFixedSize]: hasFixedSize,
      [styles[`btnAlign${alignText?.charAt(0).toUpperCase()}${alignText?.slice(1)}`]]: alignText,
    },
    className
  );

  const inlineStyles: React.CSSProperties = {};
  if (width) inlineStyles.width = width;
  if (height) inlineStyles.height = height;

  // Icon-only button
  if (isIconOnly) {
    return (
      <button
        type={type}
        className={buttonClasses}
        disabled={disabled}
        onClick={onClick}
        style={Object.keys(inlineStyles).length > 0 ? inlineStyles : undefined}
        aria-label="button"
        data-testid={testId}
      >
        {icon}
      </button>
    );
  }

  // Button with icon and label
  if (hasIconAndLabel) {
    return (
      <button
        type={type}
        className={buttonClasses}
        disabled={disabled}
        onClick={onClick}
        style={Object.keys(inlineStyles).length > 0 ? inlineStyles : undefined}
        data-testid={testId}
      >
        <span className={styles.btnIconSlot}>{icon}</span>
        <span className={styles.btnLabel}>{children}</span>
      </button>
    );
  }

  // Button with label only
  return (
    <button
      type={type}
      className={buttonClasses}
      disabled={disabled}
      onClick={onClick}
      style={Object.keys(inlineStyles).length > 0 ? inlineStyles : undefined}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
