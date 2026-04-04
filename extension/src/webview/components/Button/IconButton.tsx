import { ReactNode } from 'react';
import clsx from 'clsx';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Menu from 'lucide-react/dist/esm/icons/menu';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Settings from 'lucide-react/dist/esm/icons/settings';
import styles from './IconButton.module.css';

export interface IconButtonProps {
  icon: ReactNode;
  onClick?: () => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function IconButton({
  icon,
  onClick,
  ariaLabel,
  disabled = false,
  className,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(styles.iconBtn, disabled && styles.iconBtnDisabled, className)}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {icon}
    </button>
  );
}

// Named preset exports
export interface CloseIconButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}

IconButton.Close = function CloseIconButton({
  onClick,
  disabled = false,
  className,
  title = 'Close',
}: CloseIconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(styles.iconBtn, styles.iconBtnClose, disabled && styles.iconBtnDisabled, className)}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <X size={16} />
    </button>
  );
};

export interface CheckmarkIconButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}

IconButton.Checkmark = function CheckmarkIconButton({
  onClick,
  disabled = false,
  className,
  title = 'Confirm',
}: CheckmarkIconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(styles.iconBtn, styles.iconBtnCheckmark, disabled && styles.iconBtnDisabled, className)}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <Check size={16} />
    </button>
  );
};

export interface BurgerMenuIconButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  isOpen?: boolean;
}

IconButton.BurgerMenu = function BurgerMenuIconButton({
  onClick,
  disabled = false,
  className,
  title = 'Menu',
  isOpen = false,
}: BurgerMenuIconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        styles.iconBtn,
        styles.iconBtnBurgerMenu,
        isOpen && styles.iconBtnBurgerMenuOpen,
        disabled && styles.iconBtnDisabled,
        className
      )}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      aria-expanded={isOpen}
      title={title}
    >
      <Menu size={16} />
    </button>
  );
};

export interface CollapseIconButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  collapsed?: boolean;
  direction?: 'down' | 'up' | 'left' | 'right';
  targetId?: string;
}

IconButton.Collapse = function CollapseIconButton({
  onClick,
  disabled = false,
  className,
  title = 'Toggle',
  collapsed = false,
  direction = 'down',
  targetId,
}: CollapseIconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        styles.iconBtn,
        styles.iconBtnCollapse,
        collapsed && styles.isCollapsed,
        styles[`iconBtnCollapse${direction.charAt(0).toUpperCase()}${direction.slice(1)}`],
        disabled && styles.iconBtnDisabled,
        className
      )}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      aria-expanded={collapsed ? 'false' : 'true'}
      aria-controls={targetId}
      title={title}
    >
      <ChevronDown size={16} className={styles.collapseChevron} />
    </button>
  );
};

export interface FullscreenIconButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}

IconButton.Fullscreen = function FullscreenIconButton({
  onClick,
  disabled = false,
  className,
  title = 'Fullscreen',
}: FullscreenIconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(styles.iconBtn, styles.iconBtnFullscreen, disabled && styles.iconBtnDisabled, className)}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <Maximize2 size={16} />
    </button>
  );
};

export interface ReloadIconButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  loading?: boolean;
}

IconButton.Reload = function ReloadIconButton({
  onClick,
  disabled = false,
  className,
  title = 'Reload',
  loading = false,
}: ReloadIconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        styles.iconBtn,
        styles.iconBtnReload,
        loading && styles.iconBtnLoading,
        disabled && styles.iconBtnDisabled,
        className
      )}
      disabled={disabled || loading}
      onClick={onClick}
      aria-label={loading ? 'Loading...' : title}
      title={loading ? 'Loading...' : title}
    >
      <RefreshCw size={16} />
    </button>
  );
};

export interface SettingsIconButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}

IconButton.Settings = function SettingsIconButton({
  onClick,
  disabled = false,
  className,
  title = 'Settings',
}: SettingsIconButtonProps) {
  return (
    <button
      type="button"
      className={clsx(styles.iconBtn, styles.iconBtnSettings, disabled && styles.iconBtnDisabled, className)}
      disabled={disabled}
      onClick={onClick}
      aria-label={title}
      title={title}
    >
      <Settings size={16} />
    </button>
  );
};
