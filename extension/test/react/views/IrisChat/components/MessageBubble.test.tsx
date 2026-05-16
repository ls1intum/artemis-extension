import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@webview/views/IrisChat/types';

// Mock streamdown since it's an ESM package
vi.mock('streamdown', () => ({
	Streamdown: ({ children, mode }: { children?: string; mode?: string }) => (
		<div data-testid="streamdown" data-mode={mode}>{children}</div>
	),
}));

// Mock CodeBlock to avoid Shiki complexity in MessageBubble tests
vi.mock(
	'../../../../../src/webview/views/IrisChat/components/CodeBlock',
	() => ({
		CodeBlock: ({ language, children }: { language?: string; children?: string }) => (
			<pre data-testid="code-block" data-language={language}><code>{children}</code></pre>
		),
	})
);

// Mock StreamingMessage to isolate MessageBubble behavior
vi.mock(
	'../../../../../src/webview/views/IrisChat/components/StreamingMessage',
	() => ({
		StreamingMessage: ({ chunks }: { chunks: string[] }) => (
			<div data-testid="streaming-message">{chunks.join('')}</div>
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
		render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);
		expect(screen.getByText('Hello, I can help!')).toBeInTheDocument();
	});

	it('renders user message content', () => {
		const message = makeMessage({ role: 'user', content: 'What is polymorphism?' });
		render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);
		expect(screen.getByText('What is polymorphism?')).toBeInTheDocument();
	});

	it('does not render avatar for assistant messages', () => {
		const message = makeMessage({ role: 'assistant' });
		const { container } = render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);
		expect(container.querySelector('img')).not.toBeInTheDocument();
	});

	it('renders StreamingMessage when isStreaming is true', () => {
		const message = makeMessage({ role: 'assistant' });
		render(
			<MessageBubble
				message={message}
				isStreaming={true}
				streamingChunks={['Hello', ' world']}
				onFeedback={vi.fn()}
			/>
		);
		expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
		expect(screen.getByText('Hello world')).toBeInTheDocument();
	});

	it('does not render StreamingMessage when not streaming', () => {
		const message = makeMessage({ role: 'assistant', content: 'Done.' });
		render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);
		expect(screen.queryByTestId('streaming-message')).not.toBeInTheDocument();
	});

	it('renders error state with error message', () => {
		const message = makeMessage({
			role: 'assistant',
			status: 'error',
			errorMessage: 'Network error occurred',
		});
		render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);
		expect(screen.getByText('Network error occurred')).toBeInTheDocument();
		expect(screen.getByText('Retry')).toBeInTheDocument();
	});

	it('renders default error message when no errorMessage provided', () => {
		const message = makeMessage({ role: 'assistant', status: 'error' });
		render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);
		expect(screen.getByText('Failed to send message')).toBeInTheDocument();
	});

	it('shows feedback buttons for assistant messages on hover', async () => {
		const message = makeMessage({ role: 'assistant', content: 'Here is help.' });
		const { container } = render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);

		const wrapper = container.firstChild as HTMLElement;
		await userEvent.hover(wrapper);

		expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Not helpful' })).toBeInTheDocument();
	});

	it('calls onFeedback with positive when helpful button clicked', async () => {
		const onFeedback = vi.fn();
		const message = makeMessage({ id: 1, role: 'assistant', content: 'Help.' });
		const { container } = render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={onFeedback}
			/>
		);

		const wrapper = container.firstChild as HTMLElement;
		await userEvent.hover(wrapper);

		const helpfulButton = screen.getByRole('button', { name: 'Helpful' });
		await userEvent.click(helpfulButton);

		expect(onFeedback).toHaveBeenCalledWith(1, 'positive');
	});

	it('calls onFeedback with negative when not helpful button clicked', async () => {
		const onFeedback = vi.fn();
		const message = makeMessage({ id: 1, role: 'assistant', content: 'Help.' });
		const { container } = render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={onFeedback}
			/>
		);

		const wrapper = container.firstChild as HTMLElement;
		await userEvent.hover(wrapper);

		const notHelpfulButton = screen.getByRole('button', { name: 'Not helpful' });
		await userEvent.click(notHelpfulButton);

		expect(onFeedback).toHaveBeenCalledWith(1, 'negative');
	});

	it('renders Streamdown in static mode for non-streaming assistant messages', () => {
		const message = makeMessage({ role: 'assistant', content: 'Some content.' });
		render(
			<MessageBubble
				message={message}
				isStreaming={false}
				streamingChunks={[]}
				onFeedback={vi.fn()}
			/>
		);
		const streamdown = screen.getByTestId('streamdown');
		expect(streamdown).toHaveAttribute('data-mode', 'static');
	});
});
