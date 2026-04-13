import { useEffect, useRef, type RefObject } from 'react';

/**
 * Dismisses a dropdown/popover when the user clicks outside the referenced element.
 * Attaches mousedown listener only while `isOpen` is true.
 */
export function useClickOutside(
    ref: RefObject<HTMLElement | null>,
    isOpen: boolean,
    onClose: () => void,
): void {
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) { return; }

        const handleClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                onCloseRef.current();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, ref]);
}
