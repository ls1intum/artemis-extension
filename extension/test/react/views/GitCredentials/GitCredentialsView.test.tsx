import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GitCredentialsView } from '@webview/views/GitCredentials/GitCredentialsView';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';

/** Dispatch gitIdentityInfo so the view transitions past the loading skeleton. */
function initView(overrides?: { name?: string; email?: string }) {
	dispatchExtensionMessage({
		type: 'gitIdentityInfo',
		name: overrides?.name ?? '',
		email: overrides?.email ?? '',
	});
}

describe('GitCredentialsView', () => {
	it('renders the Git Credentials Helper header', async () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);
		initView();
		await waitFor(() => {
			expect(screen.getByText('Git Credentials Helper')).toBeInTheDocument();
		});
	});

	it('renders back link to Dashboard', () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);
		expect(screen.getByText('Back to Dashboard')).toBeInTheDocument();
	});

	it('clicking back link sends backToDashboard postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);

		const backLink = screen.getByText('Back to Dashboard');
		await userEvent.click(backLink);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToDashboard',
			})
		);
	});

	it('renders name and email input fields', async () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);
		initView();
		await waitFor(() => {
			expect(screen.getByLabelText(/git user name/i)).toBeInTheDocument();
			expect(screen.getByLabelText(/git email address/i)).toBeInTheDocument();
		});
	});

	it('submitting form sends saveGitIdentity postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);
		initView();

		await waitFor(() => {
			expect(screen.getByLabelText(/git user name/i)).toBeInTheDocument();
		});

		await userEvent.type(screen.getByLabelText(/git user name/i), 'Alex Example');
		await userEvent.type(screen.getByLabelText(/git email address/i), 'alex@example.com');
		await userEvent.click(screen.getByRole('button', { name: /save identity/i }));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'saveGitIdentity',
				payload: expect.objectContaining({ name: 'Alex Example', email: 'alex@example.com' }),
			})
		);
	});

	it('shows warning when name is empty on submit', async () => {
		const mockApi = createMockVsCodeApi();
		const { container } = render(<GitCredentialsView vscodeApi={mockApi} />);
		initView();

		await waitFor(() => {
			expect(container.querySelector('form')).toBeInTheDocument();
		});

		// Use fireEvent.submit to bypass HTML5 native form validation in happy-dom
		const form = container.querySelector('form') as HTMLFormElement;
		fireEvent.submit(form);

		await waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Please provide a name.');
		});
	});

	it('shows warning when email is empty on submit', async () => {
		const mockApi = createMockVsCodeApi();
		const { container } = render(<GitCredentialsView vscodeApi={mockApi} />);
		initView();

		await waitFor(() => {
			expect(screen.getByLabelText(/git user name/i)).toBeInTheDocument();
		});

		await userEvent.type(screen.getByLabelText(/git user name/i), 'Alex Example');

		// Use fireEvent.submit to bypass HTML5 native form validation in happy-dom
		const form = container.querySelector('form') as HTMLFormElement;
		fireEvent.submit(form);

		await waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Please provide an email address.');
		});
	});

	it('populates name and email from gitIdentityInfo message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);

		initView({ name: 'John Doe', email: 'john@example.com' });

		await waitFor(() => {
			const nameInput = screen.getByLabelText(/git user name/i) as HTMLInputElement;
			const emailInput = screen.getByLabelText(/git email address/i) as HTMLInputElement;
			expect(nameInput.value).toBe('John Doe');
			expect(emailInput.value).toBe('john@example.com');
		});
	});

	it('shows success status from gitCredentialsResult message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);
		initView();

		dispatchExtensionMessage({
			type: 'gitCredentialsResult',
			message: 'Identity saved successfully.',
			status: 'success',
		});

		await waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Identity saved successfully.');
		});
	});

	it('restores persisted name and email from getState', async () => {
		const mockApi = createMockVsCodeApi({
			getState: <T = unknown>() => ({ name: 'Saved User', email: 'saved@example.com' }) as T | undefined,
		});
		render(<GitCredentialsView vscodeApi={mockApi} />);
		initView({ name: 'Saved User', email: 'saved@example.com' });

		await waitFor(() => {
			const nameInput = screen.getByLabelText(/git user name/i) as HTMLInputElement;
			const emailInput = screen.getByLabelText(/git email address/i) as HTMLInputElement;
			expect(nameInput.value).toBe('Saved User');
			expect(emailInput.value).toBe('saved@example.com');
		});
	});

	it('copy command button sends copyToClipboard postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<GitCredentialsView vscodeApi={mockApi} />);
		initView();

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /git config user.name/i })).toBeInTheDocument();
		});

		const copyButton = screen.getByRole('button', { name: /git config user.name/i });
		await userEvent.click(copyButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'copyToClipboard',
				payload: expect.objectContaining({ text: 'git config user.name' }),
			})
		);
	});
});
