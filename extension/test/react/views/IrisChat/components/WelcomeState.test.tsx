import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WelcomeState } from '../../../../../src/webview/views/IrisChat/components/WelcomeState';

describe('WelcomeState', () => {
	let root: HTMLDivElement;

	beforeEach(() => {
		root = document.createElement('div');
		root.id = 'root';
		root.dataset.irisLogoUri = 'test-iris-logo.svg';
		document.body.appendChild(root);
	});

	afterEach(() => {
		root.remove();
	});
	it('renders no-context message when hasContext is false', () => {
		render(<WelcomeState onSendPrompt={vi.fn()} hasContext={false} />);
		expect(
			screen.getByText('Select a course or exercise to start chatting with Iris.')
		).toBeInTheDocument();
	});

	it('does not render greeting when hasContext is false', () => {
		render(<WelcomeState onSendPrompt={vi.fn()} hasContext={false} />);
		expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
	});

	it('renders Iris greeting when hasContext is true', () => {
		render(<WelcomeState onSendPrompt={vi.fn()} hasContext={true} />);
		expect(screen.getByText("Hi! I'm Iris, your AI tutor.")).toBeInTheDocument();
	});

	it('renders subtitle question when hasContext is true', () => {
		render(<WelcomeState onSendPrompt={vi.fn()} hasContext={true} />);
		expect(screen.getByText('How can I help you today?')).toBeInTheDocument();
	});

	it('renders Iris logo image when hasContext is true', () => {
		const { container } = render(<WelcomeState onSendPrompt={vi.fn()} hasContext={true} />);
		const img = container.querySelector('img');
		expect(img).toBeInTheDocument();
		expect(img?.getAttribute('src')).toBe('test-iris-logo.svg');
	});

	it('renders three suggested prompt buttons when hasContext is true', () => {
		render(<WelcomeState onSendPrompt={vi.fn()} hasContext={true} />);
		const promptButtons = screen.getAllByRole('button');
		expect(promptButtons.length).toBe(3);
	});

	it('renders correct suggested prompt texts', () => {
		render(<WelcomeState onSendPrompt={vi.fn()} hasContext={true} />);
		expect(screen.getByText('Explain the exercise requirements')).toBeInTheDocument();
		expect(screen.getByText('Help me debug my code')).toBeInTheDocument();
		expect(screen.getByText('What are the test cases checking?')).toBeInTheDocument();
	});

	it('calls onSendPrompt with prompt text when prompt button clicked', async () => {
		const onSendPrompt = vi.fn();
		render(<WelcomeState onSendPrompt={onSendPrompt} hasContext={true} />);

		const promptButton = screen.getByText('Explain the exercise requirements');
		await userEvent.click(promptButton);

		expect(onSendPrompt).toHaveBeenCalledWith('Explain the exercise requirements');
	});

	it('calls onSendPrompt with correct text for each prompt button', async () => {
		const onSendPrompt = vi.fn();
		render(<WelcomeState onSendPrompt={onSendPrompt} hasContext={true} />);

		await userEvent.click(screen.getByText('Help me debug my code'));
		expect(onSendPrompt).toHaveBeenCalledWith('Help me debug my code');

		await userEvent.click(screen.getByText('What are the test cases checking?'));
		expect(onSendPrompt).toHaveBeenCalledWith('What are the test cases checking?');
	});

	it('does not render prompt buttons when hasContext is false', () => {
		render(<WelcomeState onSendPrompt={vi.fn()} hasContext={false} />);
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
});
