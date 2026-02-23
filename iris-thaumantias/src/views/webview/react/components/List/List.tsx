import { ReactNode, useState, Children, cloneElement, isValidElement, KeyboardEvent } from 'react';
import clsx from 'clsx';
import styles from './List.module.css';

export interface ListProps {
  children: ReactNode;
  onSelect?: (index: number) => void;
  className?: string;
  ariaLabel?: string;
}

export function List({ children, onSelect, className, ariaLabel }: ListProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const childrenArray = Children.toArray(children);
    const count = childrenArray.length;

    if (count === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (selectedIndex + 1) % count;
      setSelectedIndex(nextIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (selectedIndex - 1 + count) % count;
      setSelectedIndex(prevIndex);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onSelect) {
        onSelect(selectedIndex);
      }
    }
  };

  const enhancedChildren = Children.map(children, (child, index) => {
    if (isValidElement(child)) {
      const itemId = `list-item-${index}`;
      return cloneElement(child, {
        selected: index === selectedIndex,
        id: itemId,
        ...child.props,
      } as any);
    }
    return child;
  });

  const selectedItemId = `list-item-${selectedIndex}`;

  return (
    <div
      className={clsx(styles.list, className)}
      role="listbox"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
      aria-activedescendant={selectedItemId}
    >
      {enhancedChildren}
    </div>
  );
}
