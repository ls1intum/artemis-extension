import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useOpenLiveOnSpace } from '../src/hooks/useOpenLiveOnSpace';

function Harness({ enabled, ids, onOpen }: { enabled: boolean; ids: string[]; onOpen: (id: string) => void }) {
    useOpenLiveOnSpace(enabled, new Set(ids), onOpen);
    return (
        <>
            <input data-testid="inp" />
            <button data-testid="btn">delete</button>
        </>
    );
}

describe('useOpenLiveOnSpace', () => {
    it('opens the live recording when Space is pressed', () => {
        const onOpen = vi.fn();
        render(<Harness enabled ids={['live-1']} onOpen={onOpen} />);
        fireEvent.keyDown(window, { key: ' ' });
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen).toHaveBeenCalledWith('live-1');
    });

    it('opens the first session when several are live', () => {
        const onOpen = vi.fn();
        render(<Harness enabled ids={['live-a', 'live-b']} onOpen={onOpen} />);
        fireEvent.keyDown(window, { key: ' ' });
        expect(onOpen).toHaveBeenCalledWith('live-a');
    });

    it('does nothing when disabled (e.g. a session is open)', () => {
        const onOpen = vi.fn();
        render(<Harness enabled={false} ids={['live-1']} onOpen={onOpen} />);
        fireEvent.keyDown(window, { key: ' ' });
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('does nothing when there is no live recording', () => {
        const onOpen = vi.fn();
        render(<Harness enabled ids={[]} onOpen={onOpen} />);
        fireEvent.keyDown(window, { key: ' ' });
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('does not hijack Space while typing in an input', () => {
        const onOpen = vi.fn();
        render(<Harness enabled ids={['live-1']} onOpen={onOpen} />);
        screen.getByTestId('inp').focus();
        fireEvent.keyDown(window, { key: ' ' });
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('does not hijack Space when a button is focused (Space activates the button)', () => {
        const onOpen = vi.fn();
        render(<Harness enabled ids={['live-1']} onOpen={onOpen} />);
        screen.getByTestId('btn').focus();
        fireEvent.keyDown(window, { key: ' ' });
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('ignores auto-repeat (key held down)', () => {
        const onOpen = vi.fn();
        render(<Harness enabled ids={['live-1']} onOpen={onOpen} />);
        fireEvent.keyDown(window, { key: ' ', repeat: true });
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('ignores other keys', () => {
        const onOpen = vi.fn();
        render(<Harness enabled ids={['live-1']} onOpen={onOpen} />);
        fireEvent.keyDown(window, { key: 'a' });
        expect(onOpen).not.toHaveBeenCalled();
    });
});
