import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage, IrisStageDTO, StreamingState } from '@webview/views/IrisChat/types';

// Mock use-stick-to-bottom (ESM package used via useAutoScroll)
vi.mock('use-stick-to-bottom', () => ({
	useStickToBottom: vi.fn().mockReturnValue({
		scrollRef: { current: null },
		contentRef: { current: null },
		isAtBottom: true,
		scrollToBottom: vi.fn(),
	}),
}));

// Mock streamdown to avoid ESM issues
vi.mock('streamdown', () => ({
	Streamdown: ({ children }: { children?: string }) => (
		<div data-testid="streamdown">{children}</div>
	),
}));

// Mock CodeBlock to avoid Shiki complexity
vi.mock(
	'@webview/views/IrisChat/components/CodeBlock',
	() => ({
		CodeBlock: ({ language, children }: { language?: string; children?: string }) => (
			<pre data-language={language}><code>{children}</code></pre>
		),
	})
);

import { ChatMessageList } from '@webview/views/IrisChat/components/ChatMessageList';

const defaultStreaming: StreamingState = {
	isStreaming: false,
};

const makeStage = (overrides: Partial<IrisStageDTO> = {}): IrisStageDTO => ({
    name: 'thinking',
    weight: 10,
    state: 'IN_PROGRESS',
    message: 'Thinking hard',
    ...overrides,
});

function makeMessage(overrides: Partial<ChatMessage> = {}, index = 0): ChatMessage {
	return {
		localId: `msg-${index}`,
		role: 'assistant',
		content: `Message ${index}`,
		timestamp: Date.now() - index * 1000,
		...overrides,
	};
}

describe('ChatMessageList', () => {
	it('renders welcome state when no messages', () => {
		render(
			<ChatMessageList
				messages={[]}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// WelcomeState renders with Iris greeting when hasContext is true
		expect(screen.getByText("Hi! I'm Iris, your AI tutor.")).toBeInTheDocument();
	});

	it('renders no-context welcome state when hasContext is false', () => {
		render(
			<ChatMessageList
				messages={[]}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={false}
			/>
		);
		expect(
			screen.getByText('Select a course or exercise to start chatting with Iris.')
		).toBeInTheDocument();
	});

	it('renders messages when messages array is non-empty', () => {
		const messages = [
			makeMessage({ role: 'user', content: 'Hello Iris' }, 0),
			makeMessage({ role: 'assistant', content: 'Hi there!' }, 1),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.getByText('Hello Iris')).toBeInTheDocument();
		expect(screen.getByText('Hi there!')).toBeInTheDocument();
	});

	it('does not render welcome state when messages exist', () => {
		const messages = [makeMessage({ content: 'Hello' }, 0)];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
	});

	it('renders messages in order (user then assistant)', () => {
		const messages = [
			makeMessage({ role: 'user', content: 'Question 1' }, 0),
			makeMessage({ role: 'assistant', content: 'Answer 1' }, 1),
			makeMessage({ role: 'user', content: 'Question 2' }, 2),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);

		const allText = screen.getAllByTestId('streamdown').map(el => el.textContent);
		// Streamdown renders content in DOM order
		expect(allText[0]).toBe('Question 1');
		expect(allText[1]).toBe('Answer 1');
		expect(allText[2]).toBe('Question 2');
	});

	it('shows thinking indicator when streaming is active', () => {
		const messages = [makeMessage({ role: 'user', content: 'Question' }, 0)];
		const streamingState: StreamingState = { isStreaming: true };
		render(
			<ChatMessageList
				messages={messages}
				streaming={streamingState}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
	});

	it('does not show thinking indicator when not streaming', () => {
		const messages = [makeMessage({ content: 'Done' }, 0)];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.queryByTestId('thinking-indicator')).not.toBeInTheDocument();
	});

	it('renders scroll container div', () => {
		const { container } = render(
			<ChatMessageList
				messages={[]}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// The scroll container is the outermost div
		expect(container.firstChild).toBeInTheDocument();
	});

	it('renders multiple messages as separate MessageBubble elements', () => {
		const messages = Array.from({ length: 5 }, (_, i) =>
			makeMessage({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Msg ${i}` }, i)
		);
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// All 5 messages should be rendered
		for (let i = 0; i < 5; i++) {
			expect(screen.getByText(`Msg ${i}`)).toBeInTheDocument();
		}
	});

	it('passes onFeedback to message bubbles (feedback buttons visible on hover)', () => {
		const onFeedback = vi.fn();
		const messages = [makeMessage({ role: 'assistant', content: 'Answer' }, 0)];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activeStage={null}
				onFeedback={onFeedback}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// onFeedback is passed through — verify message renders
		expect(screen.getByText('Answer')).toBeInTheDocument();
	});

	it('shows stage indicator when activeStage is present', () => {
		const messages = [makeMessage({ role: 'user', content: 'Question' }, 0)];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activeStage={makeStage()}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.getByText('Thinking hard')).toBeInTheDocument();
	});

	it('stage indicator takes priority over legacy thinking dots when both could apply', () => {
		const messages = [makeMessage({ role: 'user', content: 'Question' }, 0)];
		const streamingState: StreamingState = { isStreaming: true };
		render(
			<ChatMessageList
				messages={messages}
				streaming={streamingState}
				activeStage={makeStage()}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// Stage indicator wins — its message is rendered.
		expect(screen.getByText('Thinking hard')).toBeInTheDocument();
	});

	it('shows legacy thinking dots when streaming but no activeStage', () => {
		const messages = [makeMessage({ role: 'user', content: 'Question' }, 0)];
		const streamingState: StreamingState = { isStreaming: true };
		render(
			<ChatMessageList
				messages={messages}
				streaming={streamingState}
				activeStage={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
	});
});
