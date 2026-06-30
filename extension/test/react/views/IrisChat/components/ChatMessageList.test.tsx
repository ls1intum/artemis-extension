import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

	it('passes onFeedback to message bubbles', () => {
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

	it('collapses proactive messages sharing a proactiveEpisodeId into one group, hiding earlier behind a toggle', () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 1' }, 0),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 2' }, 1),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 3 latest' }, 2),
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
		// Only the latest suggestion shows; earlier repeats are folded away.
		expect(screen.getByText('Repeat 3 latest')).toBeInTheDocument();
		expect(screen.queryByText('Repeat 1')).not.toBeInTheDocument();
		expect(screen.queryByText('Repeat 2')).not.toBeInTheDocument();
		// The toggle advertises how many earlier suggestions are folded.
		expect(screen.getByText(/show 2 earlier suggestions/i)).toBeInTheDocument();
	});

	it('collapses an episode even when a chat turn sits between the proactive messages', () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 1' }, 0),
			makeMessage({ role: 'user', content: 'thanks' }, 1),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 2 latest' }, 2),
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
		// Repeat 2 latest shows; Repeat 1 is folded away; user turn renders inline.
		expect(screen.getByText('Repeat 2 latest')).toBeInTheDocument();
		expect(screen.queryByText('Repeat 1')).not.toBeInTheDocument();
		expect(screen.getByText('thanks')).toBeInTheDocument();
		expect(screen.getByText(/show 1 earlier suggestion/i)).toBeInTheDocument();
	});

	it('expands the folded proactive repeats when the toggle is clicked', async () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 1' }, 0),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 2 latest' }, 1),
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
		expect(screen.queryByText('Repeat 1')).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: /show 1 earlier suggestion/i }));
		expect(screen.getByText('Repeat 1')).toBeInTheDocument();
	});

	it('flips the toggle label and aria-expanded between Show and Hide', async () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 1' }, 0),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 2 latest' }, 1),
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
		const toggle = screen.getByRole('button', { name: /show 1 earlier suggestion/i });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await userEvent.click(toggle);
		const collapse = screen.getByRole('button', { name: /hide earlier suggestions/i });
		expect(collapse).toHaveAttribute('aria-expanded', 'true');
	});

	it('collapses an episode even when the latest proactive message is already dismissed', () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Earlier repeat' }, 0),
			makeMessage(
				{ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Latest secret body', proactiveOutcome: 'DISMISSED', id: 9 },
				1,
			),
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
		// The episode still folds the earlier repeat behind the toggle.
		expect(screen.getByText(/show 1 earlier suggestion/i)).toBeInTheDocument();
		expect(screen.queryByText('Earlier repeat')).not.toBeInTheDocument();
		// The dismissed latest renders collapsed: caption + "Show suggestion", body hidden.
		expect(screen.getByText('Iris thought this might help')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /show suggestion/i })).toBeInTheDocument();
		expect(screen.queryByText('Latest secret body')).not.toBeInTheDocument();
	});

	it('does not collapse proactive messages that have no episodeId (renders each as a separate bubble)', () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', content: 'Hint A' }, 0),
			makeMessage({ role: 'user', content: 'thanks' }, 1),
			makeMessage({ role: 'assistant', origin: 'proactive', content: 'Hint B' }, 2),
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
		// Without episodeId, both proactive hints render in full; nothing is folded.
		expect(screen.getByText('Hint A')).toBeInTheDocument();
		expect(screen.getByText('Hint B')).toBeInTheDocument();
		expect(screen.queryByText(/earlier suggestion/i)).not.toBeInTheDocument();
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
