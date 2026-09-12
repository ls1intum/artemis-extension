import clsx from 'clsx';
import { CSSProperties, ReactNode, useState } from 'react';

import styles from './Container.module.css';

interface ContainerProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  toolbar?: ReactNode;
  variant?: 'default' | 'muted' | 'highlight' | 'warning';
  className?: string;
  accentColor?: string;
  outline?: string;
  padding?: 'default' | 'tight' | 'cozy' | 'spacious' | 'none';
  listMode?: boolean;
  id?: string;
  testId?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export function Container({
  children,
  header,
  footer,
  toolbar,
  variant = 'default',
  className,
  accentColor,
  outline,
  padding = 'default',
  listMode = false,
  id,
  testId,
  collapsible,
  defaultCollapsed,
}: ContainerProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  const containerClasses = clsx(
    styles.container,
    styles[`container${variant.charAt(0).toUpperCase()}${variant.slice(1)}`],
    {
      [styles.containerTight]: padding === 'tight',
      [styles.containerCozy]: padding === 'cozy',
      [styles.containerSpaciou]: padding === 'spacious',
      [styles.containerNoPadding]: padding === 'none',
      [styles.containerList]: listMode,
    },
    className
  );

  const inlineStyles: CSSProperties & Record<string, string> = {};
  if (accentColor) {
    inlineStyles['--container-accent-color'] = accentColor;
  }
  if (outline) {
    inlineStyles.outline = outline;
    inlineStyles.outlineOffset = '2px';
  }

  return (
    <div
      id={id}
      className={containerClasses}
      style={Object.keys(inlineStyles).length > 0 ? inlineStyles : undefined}
      data-testid={testId}
    >
      {header && (
        <div className={styles.containerHeader}>
          {collapsible ? (
            <button
              type="button"
              className={styles.containerHeaderButton}
              onClick={() => setCollapsed(c => !c)}
              aria-expanded={!collapsed}
            >
              <span className={styles.containerChevron} aria-hidden>{collapsed ? '▸' : '▾'}</span>
              {header}
            </button>
          ) : header}
        </div>
      )}
      {toolbar && <div className={styles.containerToolbar}>{toolbar}</div>}
      <div
        className={clsx(styles.containerBody, collapsible && collapsed && styles.containerBodyCollapsed)}
        data-collapsed={collapsible ? collapsed : undefined}
      >{children}</div>
      {footer && <div className={styles.containerFooter}>{footer}</div>}
    </div>
  );
}
