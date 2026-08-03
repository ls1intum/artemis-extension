import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { usePopoverKeyDown } from '@webview/hooks/usePopoverKeyDown';

/**
 * The shared popover key handler had no coverage of its own: every popover
 * suite tested Escape through its own component, and the Tab focus trap was
 * asserted nowhere at all, so it could be deleted outright with 117 tests
 * still green.
 */
function Dialog({ onClose, disabledMiddle = false }: { onClose: () => void; disabledMiddle?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const handleKeyDown = usePopoverKeyDown(ref, onClose);
    return (
        <div ref={ref} role="dialog" aria-label="Test" onKeyDown={handleKeyDown}>
            <button type="button">first</button>
            <button type="button" disabled={disabledMiddle}>middle</button>
            <button type="button">last</button>
        </div>
    );
}

describe('usePopoverKeyDown', () => {
    it('closes on Escape and stops the key from travelling further', () => {
        const onClose = vi.fn();
        const outerKeyDown = vi.fn();
        render(
            <div onKeyDown={outerKeyDown}>
                <Dialog onClose={onClose} />
            </div>,
        );

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

        expect(onClose).toHaveBeenCalledOnce();
        // The chat view listens for keys too; a popover Escape must not also
        // be read as an Escape for whatever is behind it.
        expect(outerKeyDown).not.toHaveBeenCalled();
    });

    it('wraps Tab from the last focusable back to the first', () => {
        render(<Dialog onClose={vi.fn()} />);
        const last = screen.getByRole('button', { name: 'last' });
        last.focus();

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
    });

    it('wraps Shift+Tab from the first focusable back to the last', () => {
        render(<Dialog onClose={vi.fn()} />);
        screen.getByRole('button', { name: 'first' }).focus();

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
    });

    it('leaves Tab alone in the middle of the cycle, so the browser moves focus', () => {
        render(<Dialog onClose={vi.fn()} />);
        screen.getByRole('button', { name: 'middle' }).focus();

        const handled = fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });

        // `fireEvent` returns false when the handler called preventDefault.
        expect(handled).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'middle' }));
    });

    it('skips disabled controls, which cannot take focus', () => {
        render(<Dialog onClose={vi.fn()} disabledMiddle />);
        screen.getByRole('button', { name: 'first' }).focus();

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
    });

    it('ignores every other key', () => {
        const onClose = vi.fn();
        render(<Dialog onClose={onClose} />);

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });

        expect(onClose).not.toHaveBeenCalled();
    });
});
