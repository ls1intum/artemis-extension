import { ReactNode, useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { IconButton } from '../Button';
import styles from './HelpPopup.module.css';

export interface HelpPopupProps {
  children: ReactNode;
  trigger?: ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function HelpPopup({
  children,
  trigger,
  isOpen: controlledIsOpen,
  onToggle,
  position = 'bottom',
  className,
}: HelpPopupProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Use controlled or uncontrolled state
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  // Close popup when clicking outside
  useEffect(() => {
    if (!isOpen) {return;}

    function handleClickOutside(event: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        if (onToggle) {
          onToggle();
        } else {
          setInternalIsOpen(false);
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onToggle]);

  const handleTriggerClick = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalIsOpen(!internalIsOpen);
    }
  };

  // Default trigger: help icon button
  const defaultTrigger = (
    <IconButton
      icon={
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2"/>
          <path d="M8 12V12.01M8 9C8 8.44772 8.44772 8 9 8C9.55228 8 10 7.55228 10 7C10 6.44772 9.55228 6 9 6C8.44772 6 8 6.44772 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      }
      onClick={handleTriggerClick}
      ariaLabel="Help"
    />
  );

  return (
    <div className={clsx(styles.helpPopupContainer, className)}>
      {trigger ? (
        <div onClick={handleTriggerClick}>{trigger}</div>
      ) : (
        defaultTrigger
      )}

      {isOpen && (
        <>
          <div
            className={styles.helpOverlay}
            onClick={handleTriggerClick}
          />
          <div
            ref={popupRef}
            className={clsx(
              styles.helpPopup,
              styles[`helpPopup${position.charAt(0).toUpperCase()}${position.slice(1)}`],
              isOpen && styles.helpPopupOpen
            )}
          >
            <div className={styles.helpPopupHeader}>
              <IconButton.Close
                onClick={handleTriggerClick}
                title="Close Help"
                className={styles.closeBtn}
              />
            </div>
            <div className={styles.helpPopupContent}>
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
