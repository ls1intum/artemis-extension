import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StaleAskButtons } from '@webview/views/IrisChat/components/StaleAskButtons';

describe('StaleAskButtons', () => {
    const defaultProps = {
        askId: 'ask-test-123',
        question: 'Are you still stuck?',
        onButton: vi.fn(),
    };

    beforeEach(() => {
        defaultProps.onButton = vi.fn();
    });

    it('renders all three quick-reply buttons', () => {
        render(<StaleAskButtons {...defaultProps} />);
        expect(screen.getByRole('button', { name: 'Got it, solved!' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Still working on it' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Something else' })).toBeInTheDocument();
    });

    it('renders the question text above the buttons', () => {
        render(<StaleAskButtons {...defaultProps} />);
        expect(screen.getByText('Are you still stuck?')).toBeInTheDocument();
    });

    it('buttons are enabled initially', () => {
        render(<StaleAskButtons {...defaultProps} />);
        for (const name of ['Got it, solved!', 'Still working on it', 'Something else']) {
            expect(screen.getByRole('button', { name })).not.toBeDisabled();
        }
    });

    it('calls onButton with "solved" when the first button is clicked', async () => {
        render(<StaleAskButtons {...defaultProps} />);
        await userEvent.click(screen.getByRole('button', { name: 'Got it, solved!' }));
        expect(defaultProps.onButton).toHaveBeenCalledWith('solved');
    });

    it('calls onButton with "still-on-it" when the second button is clicked', async () => {
        render(<StaleAskButtons {...defaultProps} />);
        await userEvent.click(screen.getByRole('button', { name: 'Still working on it' }));
        expect(defaultProps.onButton).toHaveBeenCalledWith('still-on-it');
    });

    it('calls onButton with "something-else" when the third button is clicked', async () => {
        render(<StaleAskButtons {...defaultProps} />);
        await userEvent.click(screen.getByRole('button', { name: 'Something else' }));
        expect(defaultProps.onButton).toHaveBeenCalledWith('something-else');
    });

    it('disables all three buttons after the first click', async () => {
        render(<StaleAskButtons {...defaultProps} />);
        await userEvent.click(screen.getByRole('button', { name: 'Got it, solved!' }));
        for (const name of ['Got it, solved!', 'Still working on it', 'Something else']) {
            expect(screen.getByRole('button', { name })).toBeDisabled();
        }
    });

    it('does not call onButton a second time if the same button is clicked twice', async () => {
        render(<StaleAskButtons {...defaultProps} />);
        await userEvent.click(screen.getByRole('button', { name: 'Still working on it' }));
        await userEvent.click(screen.getByRole('button', { name: 'Still working on it' }));
        expect(defaultProps.onButton).toHaveBeenCalledTimes(1);
    });

    it('does not call onButton on a second button once another has been clicked', async () => {
        render(<StaleAskButtons {...defaultProps} />);
        await userEvent.click(screen.getByRole('button', { name: 'Got it, solved!' }));
        await userEvent.click(screen.getByRole('button', { name: 'Something else' }));
        expect(defaultProps.onButton).toHaveBeenCalledTimes(1);
        expect(defaultProps.onButton).toHaveBeenCalledWith('solved');
    });
});
