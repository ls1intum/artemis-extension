import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestResultsOverlay } from '@webview/components/exercise/TestResultsOverlay';
import type { TestCase } from '@webview/components/exercise/SubmissionStatus';

describe('TestResultsOverlay', () => {
    const testCases: TestCase[] = [
        { name: 'testA', passed: true },
        { name: 'testB', passed: false, message: 'fail msg' },
    ];

    it('renders default title when taskName is absent', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={testCases} />);
        expect(screen.getByText('Test Results')).toBeInTheDocument();
    });

    it('renders task-mode title when taskName is provided', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={testCases} taskName="doOverlap" />);
        expect(screen.getByText('Feedback for task: doOverlap')).toBeInTheDocument();
    });

    it('shows task-specific empty message when taskName given and testCases empty', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={[]} taskName="emptyTask" />);
        expect(screen.getByText('No tests in this task.')).toBeInTheDocument();
    });

    it('shows default empty message when taskName not given and testCases empty', () => {
        render(<TestResultsOverlay open onClose={() => undefined} testCases={[]} />);
        expect(screen.getByText('No test results available.')).toBeInTheDocument();
    });

    it('calls onClose with "button" when X is clicked', async () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} testCases={testCases} />);
        const closeBtn = screen.getByRole('button', { name: /close/i });
        await userEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledWith('button');
    });

    it('calls onClose with "escape" when Escape is pressed', () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} testCases={testCases} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledWith('escape');
    });

    it('does not fire onClose when clicking inside the modal content', async () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} testCases={testCases} />);
        await userEvent.click(screen.getByText('testA'));
        expect(onClose).not.toHaveBeenCalled();
    });
});
