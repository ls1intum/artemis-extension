import { ReactNode } from 'react';
import clsx from 'clsx';
import { IconButton } from '../Button';
import styles from './SideMenu.module.css';

export interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  className?: string;
}

export function SideMenu({
  isOpen,
  onClose,
  children,
  title,
  className,
}: SideMenuProps) {
  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={clsx(styles.menuOverlay, isOpen && styles.menuOverlayOpen)}
        onClick={onClose}
      />

      {/* Side menu panel */}
      <div className={clsx(styles.sideMenu, isOpen && styles.sideMenuOpen, className)}>
        <div className={styles.sideMenuHeader}>
          {title && <h3 className={styles.sideMenuTitle}>{title}</h3>}
          <IconButton.Close
            onClick={onClose}
            title="Close Menu"
            className={styles.closeBtn}
          />
        </div>
        <div className={styles.sideMenuContent}>
          {children}
        </div>
      </div>
    </>
  );
}
