import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@webview/views/IrisChat/types';

// Mock streamdown since it's an ESM package
vi.mock('streamdown', () => ({
	Streamdown: ({ children, mode }: { children?: string; mode?: string }) => (
		<div data-testid="streamdown" data-mode={mode}>{children}</div>
	),
}));

// Mock CodeBlock to avoid Shiki complexity in MessageBubble tests
vi.mock(
	'@webview/views/IrisChat/components/CodeBlock',
	() => ({
		CodeBlock: ({ language, children }: { language?: string; children?: string }) => (
			<pre data-testid="code-block" data-language={language}><code>{children}</code></pre>
		),
	})
);

import { MessageBubble } from '@webview/views/IrisChat/components/MessageBubble';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		localId: 'msg-1',
		role: 'assistant',
		content: 'Hello, I can help!',
		timestamp: Date.now(),
		...overrides,
	};
}

describe('MessageBubble', () => {
	it('renders assistant message content', () => {
		const message = makeMessage({ role: 'assistant', content: 'Hello, I can help!' });
		render(<MessageBubble message={message} onFeedback={vi.fn()} />);
		expect(screen.getByText('Hello, I can help!')).toBeInTheDocument();
	});

	it('renders user message content', () => {
		const message = makeMessage({ role: 'user', content: 'What is polymorphism?' });
		render(<MessageBubble message={message} onFeedback={vi.fn()} />);
		expect(screen.getByText('What is polymorphism?')).toBeInTheDocument();
	});

	it('does not render avatar for assistant messages', () => {
		const message = makeMessage({ role: 'assistant' });
		const { container } = render(
			<MessageBubble message={message} onFeedback={vi.fn()} />
		);
		expect(container.querySelector('img')).not.toBeInTheDocument();
	});

	it('renders failed user message with original content and inline error footer', () => {
		const message = makeMessage({
			role: 'user',
			content: 'How do I solve task 2?',
			status: 'error',
			errorMessage: 'Please select a course or exercise context first.',
			errorReason: 'no-context',
		});
		render(<MessageBubble message={message} onFeedback={vi.fn()} onRetry={vi.fn()} />);
		// Original message content stays visible (this is the bugfix from #178:
		// previously the bubble replaced its content with the error block).
		expect(screen.getByText('How do I solve task 2?')).toBeInTheDocument();
		expect(screen.getByText('Not sent')).toBeInTheDocument();
		expect(screen.getByText('Please select a course or exercise context first.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Retry sending this message' })).toBeInTheDocument();
	});

	it('renders default error message when no errorMessage provided', () => {
		const message = makeMessage({ role: 'user', content: 'Hi', status: 'error' });
		render(<MessageBubble message={message} onFeedback={vi.fn()} onRetry={vi.fn()} />);
		expect(screen.getByText('Failed to send message')).toBeInTheDocument();
	});

	it('does not render Retry button when onRetry prop is omitted', () => {
		const message = makeMessage({ role: 'user', content: 'Hi', status: 'error', errorMessage: 'Boom' });
		render(<MessageBubble message={message} onFeedback={vi.fn()} />);
		expect(screen.queryByRole('button', { name: 'Retry sending this message' })).not.toBeInTheDocument();
	});

	it('invokes onRetry with message localId when Retry is clicked', async () => {
		const onRetry = vi.fn();
		const message = makeMessage({
			localId: 'failed-msg-1',
			role: 'user',
			content: 'Retry me',
			status: 'error',
			errorMessage: 'Boom',
		});
		render(<MessageBubble message={message} onFeedback={vi.fn()} onRetry={onRetry} />);
		await userEvent.click(screen.getByRole('button', { name: 'Retry sending this message' }));
		expect(onRetry).toHaveBeenCalledWith('failed-msg-1');
	});

	it('disables Retry button when retryDisabled is true and does not call onRetry on click', async () => {
		const onRetry = vi.fn();
		const message = makeMessage({
			role: 'user',
			content: 'Stuck',
			status: 'error',
			errorMessage: 'No context',
			errorReason: 'no-context',
		});
		render(
			<MessageBubble
				message={message}
				onFeedback={vi.fn()}
				onRetry={onRetry}
				retryDisabled={true}
			/>
		);
		const retry = screen.getByRole('button', { name: 'Retry sending this message' });
		expect(retry).toBeDisabled();
		await userEvent.click(retry);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it('does not render feedback buttons for failed messages', () => {
		const message = makeMessage({
			role: 'assistant',
			content: 'Something',
			status: 'error',
			errorMessage: 'Boom',
		});
		const { container } = render(
			<MessageBubble message={message} onFeedback={vi.fn()} onRetry={vi.fn()} />
		);
		const wrapper = container.firstChild as HTMLElement;
		// Even on hover, feedback should not appear for an error-state message.
		void userEvent.hover(wrapper);
		expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
	});

	it('renders feedback buttons for assistant messages (revealed on hover via CSS)', () => {
		const message = makeMessage({ role: 'assistant', content: 'Here is help.' });
		render(<MessageBubble message={message} onFeedback={vi.fn()} />);

		// The thumbs live in the DOM (a floating bar shown on hover via CSS), so they
		// are reachable without simulating hover in jsdom.
		expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Not helpful' })).toBeInTheDocument();
	});

	// The action bar is pointer-events:none until hover (CSS), which jsdom cannot
	// simulate; fireEvent dispatches directly to verify the handler wiring.
	it('calls onFeedback with positive when helpful button clicked', () => {
		const onFeedback = vi.fn();
		const message = makeMessage({ id: 1, role: 'assistant', content: 'Help.' });
		render(<MessageBubble message={message} onFeedback={onFeedback} />);

		fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));

		expect(onFeedback).toHaveBeenCalledWith(1, 'positive');
	});

	it('calls onFeedback with negative when not helpful button clicked', () => {
		const onFeedback = vi.fn();
		const message = makeMessage({ id: 1, role: 'assistant', content: 'Help.' });
		render(<MessageBubble message={message} onFeedback={onFeedback} />);

		fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));

		expect(onFeedback).toHaveBeenCalledWith(1, 'negative');
	});

	it('renders Streamdown in static mode for assistant messages', () => {
		const message = makeMessage({ role: 'assistant', content: 'Some content.' });
		render(<MessageBubble message={message} onFeedback={vi.fn()} />);
		const streamdown = screen.getByTestId('streamdown');
		expect(streamdown).toHaveAttribute('data-mode', 'static');
	});
});
