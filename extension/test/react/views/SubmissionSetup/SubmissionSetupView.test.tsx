import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SubmissionSetupSnapshot } from '@shared/types/submissionSetup';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { createSubmissionSetupPayload } from '@test/react/fixtures';
import { SubmissionSetupView } from '@webview/views/SubmissionSetup/SubmissionSetupView';

/** Render the page and hand it a snapshot, which is the only way it ever gets content. */
async function renderWithSnapshot(overrides?: Partial<SubmissionSetupSnapshot>) {
    const mockApi = createMockVsCodeApi();
    render(<SubmissionSetupView vscodeApi={mockApi} />);
    await act(async () => {
        dispatchExtensionMessage(createSubmissionSetupPayload(overrides));
    });
    return mockApi;
}

/** The rows in the order they are painted, which is the order the page decided on. */
function renderedRowOrder(): string[] {
    return screen.getAllByTestId(/^setup-row-/)
        .map(el => el.getAttribute('data-testid')!.replace('setup-row-', ''));
}

describe('SubmissionSetupView', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('shows a skeleton until the first snapshot arrives', () => {
        const mockApi = createMockVsCodeApi();
        render(<SubmissionSetupView vscodeApi={mockApi} />);

        expect(screen.queryByTestId('setup-row-git')).not.toBeInTheDocument();
        expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument();
    });

    it('reports readiness when every check passes', async () => {
        await renderWithSnapshot();

        expect(screen.getByTestId('setup-banner')).toHaveTextContent('You are ready to submit.');
        expect(renderedRowOrder()).toEqual(['git', 'identity', 'repository', 'access']);
    });

    it('sorts the broken rows to the top and counts them in the banner', async () => {
        await renderWithSnapshot({
            identity: { state: 'problem', name: '', email: '' },
            access: { state: 'problem', reason: 'refused' },
        });

        expect(renderedRowOrder().slice(0, 2)).toEqual(['identity', 'access']);
        expect(screen.getByTestId('setup-banner')).toHaveTextContent('2 things need fixing');
    });

    it('counts one problem in the singular', async () => {
        await renderWithSnapshot({ identity: { state: 'problem', name: '', email: '' } });

        expect(screen.getByTestId('setup-banner')).toHaveTextContent('One thing needs fixing');
    });

    it('says the machine is set up when only the exercise is missing', async () => {
        await renderWithSnapshot({
            repository: { state: 'unknown', blocker: 'not-a-repo' },
            access: { state: 'unknown', reason: 'not-checked' },
        });

        expect(screen.getByTestId('setup-banner')).toHaveTextContent('Open an exercise');
        expect(screen.getByTestId('setup-row-repository'))
            .toHaveTextContent('This folder is not a Git repository');
    });

    it('names the reason it refuses to touch a hand-built push setup', async () => {
        await renderWithSnapshot({
            repository: { state: 'problem', blocker: 'foreign-push-url' },
        });

        expect(screen.getByTestId('setup-row-repository'))
            .toHaveTextContent('Your pushes go to a different repository');
    });

    it('opens the identity form by itself when there is no identity', async () => {
        await renderWithSnapshot({ identity: { state: 'problem', name: '', email: '' } });

        expect(screen.getByTestId('setup-identity-name')).toBeInTheDocument();
        expect(screen.getByTestId('setup-identity-email')).toBeInTheDocument();
    });

    it('keeps the identity form closed until asked when the identity is fine', async () => {
        await renderWithSnapshot();

        expect(screen.queryByTestId('setup-identity-name')).not.toBeInTheDocument();
        await userEvent.click(screen.getByTestId('setup-identity-change'));
        expect(screen.getByTestId('setup-identity-name')).toBeInTheDocument();
    });

    it('sends saveGitIdentity with trimmed values', async () => {
        const mockApi = await renderWithSnapshot({ identity: { state: 'problem', name: '', email: '' } });

        await userEvent.type(screen.getByTestId('setup-identity-name'), '  Alex Example  ');
        await userEvent.type(screen.getByTestId('setup-identity-email'), ' alex@tum.de ');
        await userEvent.click(screen.getByTestId('setup-identity-save'));

        await waitFor(() => {
            expect(mockApi.postMessage).toHaveBeenCalledWith({
                type: 'command',
                command: 'saveGitIdentity',
                payload: { name: 'Alex Example', email: 'alex@tum.de' },
            });
        });
    });

    it('refuses a name that is only whitespace, which the required attribute lets through', async () => {
        const mockApi = await renderWithSnapshot({ identity: { state: 'problem', name: '', email: '' } });

        await userEvent.type(screen.getByTestId('setup-identity-name'), '   ');
        await userEvent.type(screen.getByTestId('setup-identity-email'), 'alex@tum.de');
        await userEvent.click(screen.getByTestId('setup-identity-save'));

        expect(mockApi.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'saveGitIdentity' }),
        );
        expect(screen.getByTestId('setup-status')).toHaveTextContent('Enter both a name and an email address.');
    });

    it('offers Renew on a refused access row and sends the payload-free command', async () => {
        const mockApi = await renderWithSnapshot({ access: { state: 'problem', reason: 'refused' } });

        await userEvent.click(screen.getByTestId('setup-access-renew'));

        await waitFor(() => {
            expect(mockApi.postMessage).toHaveBeenCalledWith({
                type: 'command',
                command: 'renewArtemisAccess',
            });
        });
    });

    it('does not offer Renew without a participation to renew for', async () => {
        await renderWithSnapshot({
            repository: { state: 'unknown', blocker: 'unmatched' },
            access: { state: 'problem', reason: 'refused' },
        });

        expect(screen.queryByTestId('setup-access-renew')).not.toBeInTheDocument();
    });

    it('offers Recheck while access is fine, and while it could not be reached', async () => {
        await renderWithSnapshot();
        expect(screen.getByTestId('setup-access-recheck')).toBeInTheDocument();

        await act(async () => {
            dispatchExtensionMessage(createSubmissionSetupPayload({
                access: { state: 'unknown', reason: 'unreachable' },
            }));
        });
        expect(screen.getByTestId('setup-access-recheck')).toBeInTheDocument();
    });

    it('shows a success line and clears it once the delay is up', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderWithSnapshot();

        await act(async () => {
            dispatchExtensionMessage({
                type: 'submissionSetupResult',
                status: 'success',
                message: 'Access renewed. You can submit again.',
            });
        });
        expect(screen.getByTestId('setup-status')).toHaveTextContent('Access renewed.');

        await act(async () => { vi.advanceTimersByTime(5000); });

        expect(screen.queryByTestId('setup-status')).not.toBeInTheDocument();
    });

    it('a later warning survives the timer that an earlier success started', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await renderWithSnapshot({ identity: { state: 'problem', name: '', email: '' } });

        await act(async () => {
            dispatchExtensionMessage({
                type: 'submissionSetupResult', status: 'success', message: 'Saved.',
            });
        });
        await act(async () => { vi.advanceTimersByTime(3000); });

        // The student's own validation warning must not be swept away two
        // seconds later by a timer that belongs to a message already gone.
        await userEvent.type(screen.getByTestId('setup-identity-name'), '   ');
        await userEvent.type(screen.getByTestId('setup-identity-email'), 'alex@tum.de');
        await userEvent.click(screen.getByTestId('setup-identity-save'));
        await act(async () => { vi.advanceTimersByTime(3000); });

        expect(screen.getByTestId('setup-status')).toHaveTextContent('Enter both a name and an email address.');
    });

    it('keeps a draft when a snapshot arrives while the identity is being edited', async () => {
        await renderWithSnapshot();

        await userEvent.click(screen.getByTestId('setup-identity-change'));
        await userEvent.clear(screen.getByTestId('setup-identity-name'));
        await userEvent.type(screen.getByTestId('setup-identity-name'), 'Half typed');

        await act(async () => {
            dispatchExtensionMessage(createSubmissionSetupPayload());
        });

        expect(screen.getByTestId('setup-identity-name')).toHaveValue('Half typed');
    });

    it('gives the buttons back when an action fails', async () => {
        await renderWithSnapshot({ access: { state: 'problem', reason: 'refused' } });

        await userEvent.click(screen.getByTestId('setup-access-renew'));
        expect(screen.getByTestId('setup-access-renew')).toBeDisabled();

        await act(async () => {
            dispatchExtensionMessage({
                type: 'submissionSetupResult',
                status: 'error',
                message: 'Could not reach Artemis, so nothing was changed.',
            });
        });

        expect(screen.getByTestId('setup-access-renew')).toBeEnabled();
    });

    it('announces the verdict, because a recheck repaints rows without moving focus', async () => {
        await renderWithSnapshot();

        expect(screen.getByTestId('setup-banner')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByTestId('setup-banner')).toHaveAttribute('role', 'status');
    });

    it('keeps an error line on screen', async () => {
        await renderWithSnapshot();

        await act(async () => {
            dispatchExtensionMessage({
                type: 'submissionSetupResult',
                status: 'error',
                message: 'Artemis refused the new access token, so nothing was changed.',
            });
        });

        expect(screen.getByTestId('setup-status')).toHaveTextContent('nothing was changed');
    });

    it('renders no repository URL, because a URL the extension installs carries a token', async () => {
        const { container } = render(<SubmissionSetupView vscodeApi={createMockVsCodeApi()} />);
        await act(async () => {
            dispatchExtensionMessage(createSubmissionSetupPayload());
        });

        expect(container.textContent).not.toMatch(/https?:\/\//);
    });
});
