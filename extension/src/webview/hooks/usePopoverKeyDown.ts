import type { KeyboardEvent, RefObject } from 'react';

/**
 * Escape-to-close plus a Tab focus trap for a popover dialog.
 *
 * Returns the `onKeyDown` handler to put on the dialog element. The trap wraps
 * focus between the first and last focusable descendant, and skips disabled
 * controls: a disabled entry cannot take focus, so including it in the cycle
 * would strand Tab on an element the browser refuses to move to.
 */
export function usePopoverKeyDown(
    dialogRef: RefObject<HTMLElement | null>,
    onClose: () => void,
): (event: KeyboardEvent<HTMLElement>) => void {
    return (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab') { return; }

        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) { return; }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };
}
