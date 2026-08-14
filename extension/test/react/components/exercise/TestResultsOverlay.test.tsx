import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TestCase } from '@webview/components/exercise/SubmissionStatus';
import { TestResultsOverlay } from '@webview/components/exercise/TestResultsOverlay';

describe('TestResultsOverlay', () => {
    const testCases: TestCase[] = [
        { id: 1, name: 'testA', passed: true },
        { id: 2, name: 'testB', passed: false, message: 'fail msg' },
    ];

    it('renders default title in overview mode', () => {
        render(<TestResultsOverlay open onClose={() => undefined} state={{ kind: 'all', testCases }} />);
        expect(screen.getByText('Test Results')).toBeInTheDocument();
    });

    it('shows overview empty message when testCases is empty', () => {
        render(<TestResultsOverlay open onClose={() => undefined} state={{ kind: 'all', testCases: [] }} />);
        expect(screen.getByText('No test results available.')).toBeInTheDocument();
    });

    it('renders task-mode title from taskName', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="doOverlap"
                state={{ kind: 'no-result', notExecutedIds: [1, 2, 3] }}
            />,
        );
        expect(screen.getByText('Feedback for task: doOverlap')).toBeInTheDocument();
    });

    it('no-result renders the "submit your code" empty state', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{ kind: 'no-result', notExecutedIds: [1] }}
            />,
        );
        expect(screen.getByText(/no build results yet/i)).toBeInTheDocument();
    });

    it('no-feedbacks renders the build-without-feedback empty state', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{ kind: 'no-feedbacks', notExecutedIds: [1] }}
            />,
        );
        expect(screen.getByText(/produced no test feedback/i)).toBeInTheDocument();
    });

    it('no-tests-in-task renders the no-associated-tests empty state', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{ kind: 'no-tests-in-task' }}
            />,
        );
        expect(screen.getByText(/no associated tests/i)).toBeInTheDocument();
    });

    it('legacy-success renders "All N tests passed" without details', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{ kind: 'legacy-success', testIds: [10, 11, 12] }}
            />,
        );
        // Summary line
        expect(screen.getByText(/3 of 3 tests passed/i)).toBeInTheDocument();
        // Body note
        expect(screen.getByText(/All 3 tests passed/i)).toBeInTheDocument();
    });

    it('success renders only the Passed section', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{
                    kind: 'success',
                    passed: [{ id: 1, name: 'tA', passed: true }, { id: 2, name: 'tB', passed: true }],
                }}
            />,
        );
        expect(screen.getByText('Passed (2)')).toBeInTheDocument();
        expect(screen.queryByText(/^Failed/)).not.toBeInTheDocument();
    });

    it('fail renders Failed + Passed sections and a Not-executed note when applicable', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{
                    kind: 'fail',
                    failed: [{ id: 3, name: 'tF', passed: false, message: 'fail msg' }],
                    passed: [{ id: 1, name: 'tA', passed: true }],
                    notExecutedIds: [99, 100],
                }}
            />,
        );
        expect(screen.getByText('Failed (1)')).toBeInTheDocument();
        expect(screen.getByText('Passed (1)')).toBeInTheDocument();
        expect(screen.getByText(/2 tests in this task did not run/i)).toBeInTheDocument();
    });

    it('not-executed with no passed renders the count-only empty state', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{ kind: 'not-executed', passed: [], notExecutedIds: [1, 2, 3] }}
            />,
        );
        expect(screen.getByText(/3 tests in this task did not run/i)).toBeInTheDocument();
    });

    it('not-executed singular: "1 test ... did not run"', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{ kind: 'not-executed', passed: [], notExecutedIds: [1] }}
            />,
        );
        expect(screen.getByText(/1 test in this task did not run/i)).toBeInTheDocument();
    });

    it('not-executed with some passed shows the Passed section plus the Not-executed note', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="t"
                state={{
                    kind: 'not-executed',
                    passed: [{ id: 1, name: 'tA', passed: true }],
                    notExecutedIds: [2],
                }}
            />,
        );
        expect(screen.getByText('Passed (1)')).toBeInTheDocument();
        expect(screen.getByText(/1 test in this task did not run/i)).toBeInTheDocument();
    });

    it('calls onClose with "button" when X is clicked', async () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} state={{ kind: 'all', testCases }} />);
        const closeBtn = screen.getByRole('button', { name: /close/i });
        await userEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledWith('button');
    });

    it('calls onClose with "escape" when Escape is pressed', () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} state={{ kind: 'all', testCases }} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledWith('escape');
    });

    it('does not fire onClose when clicking inside the modal content', async () => {
        const onClose = vi.fn();
        render(<TestResultsOverlay open onClose={onClose} state={{ kind: 'all', testCases }} />);
        await userEvent.click(screen.getByText('testA'));
        expect(onClose).not.toHaveBeenCalled();
    });

    const BANNER_RE = /a new build is running/i;

    it('shows the rebuild banner when buildRunning is true (task mode)', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                taskName="doOverlap"
                buildRunning
                state={{ kind: 'fail', failed: [{ id: 1, name: 'tA', passed: false }], passed: [], notExecutedIds: [] }}
            />,
        );
        expect(screen.getByText(BANNER_RE)).toBeInTheDocument();
    });

    it('shows the rebuild banner when buildRunning is true (overview mode)', () => {
        render(
            <TestResultsOverlay
                open
                onClose={() => undefined}
                buildRunning
                state={{ kind: 'all', testCases }}
            />,
        );
        expect(screen.getByText(BANNER_RE)).toBeInTheDocument();
    });

    it('does not show the rebuild banner when buildRunning is absent/false', () => {
        render(<TestResultsOverlay open onClose={() => undefined} state={{ kind: 'all', testCases }} />);
        expect(screen.queryByText(BANNER_RE)).not.toBeInTheDocument();
    });
});
