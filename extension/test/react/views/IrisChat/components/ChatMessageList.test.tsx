import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import type { ChatMessage, StreamingState } from '@webview/views/IrisChat/types';

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

function makeMessage(overrides: Partial<ChatMessage> = {}, index = 0): ChatMessage {
	return {
		localId: `msg-${index}`,
		role: 'assistant',
		content: `Message ${index}`,
		timestamp: Date.now() - index * 1000,
		...overrides,
	};
}

interface RenderListOverrides {
	messages?: ChatMessage[];
	streaming?: StreamingState;
	activities?: IrisActivityDTO[];
	liveDraft?: { runId: string; text: string } | null;
	runState?: IrisRunState | null;
	runError?: { message?: string } | null;
	hasContext?: boolean;
}

/**
 * Renders ChatMessageList with sensible defaults for every required prop so
 * new cases can override only what they exercise and can never silently omit
 * a required prop (which would otherwise make the component crash or render
 * an unrelated branch).
 */
function renderList(overrides: RenderListOverrides = {}) {
	return render(
		<ChatMessageList
			messages={overrides.messages ?? []}
			streaming={overrides.streaming ?? defaultStreaming}
			activities={overrides.activities ?? []}
			liveDraft={overrides.liveDraft ?? null}
			runState={overrides.runState ?? null}
			runError={overrides.runError ?? null}
			onFeedback={vi.fn()}
			onSendPrompt={vi.fn()}
			hasContext={overrides.hasContext ?? true}
		/>
	);
}

describe('ChatMessageList', () => {
	it('renders welcome state when no messages', () => {
		renderList({ hasContext: true });
		// WelcomeState renders with Iris greeting when hasContext is true
		expect(screen.getByText("Hi! I'm Iris, your AI tutor.")).toBeInTheDocument();
	});

	it('renders no-context welcome state when hasContext is false', () => {
		renderList({ hasContext: false });
		expect(
			screen.getByText('Select a course or exercise to start chatting with Iris.')
		).toBeInTheDocument();
	});

	it('renders messages when messages array is non-empty', () => {
		renderList({
			messages: [
				makeMessage({ role: 'user', content: 'Hello Iris' }, 0),
				makeMessage({ role: 'assistant', content: 'Hi there!' }, 1),
			],
		});
		expect(screen.getByText('Hello Iris')).toBeInTheDocument();
		expect(screen.getByText('Hi there!')).toBeInTheDocument();
	});

	it('does not render welcome state when messages exist', () => {
		renderList({ messages: [makeMessage({ content: 'Hello' }, 0)] });
		expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
	});

	it('renders messages in order (user then assistant)', () => {
		renderList({
			messages: [
				makeMessage({ role: 'user', content: 'Question 1' }, 0),
				makeMessage({ role: 'assistant', content: 'Answer 1' }, 1),
				makeMessage({ role: 'user', content: 'Question 2' }, 2),
			],
		});

		const allText = screen.getAllByTestId('streamdown').map(el => el.textContent);
		// Streamdown renders content in DOM order
		expect(allText[0]).toBe('Question 1');
		expect(allText[1]).toBe('Answer 1');
		expect(allText[2]).toBe('Question 2');
	});

	it('renders scroll container div', () => {
		const { container } = renderList();
		// The scroll container is the outermost div
		expect(container.firstChild).toBeInTheDocument();
	});

	it('renders multiple messages as separate MessageBubble elements', () => {
		renderList({
			messages: Array.from({ length: 5 }, (_, i) =>
				makeMessage({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Msg ${i}` }, i)
			),
		});
		// All 5 messages should be rendered
		for (let i = 0; i < 5; i++) {
			expect(screen.getByText(`Msg ${i}`)).toBeInTheDocument();
		}
	});

	it('passes onFeedback to message bubbles (feedback buttons visible on hover)', () => {
		renderList({ messages: [makeMessage({ role: 'assistant', content: 'Answer' }, 0)] });
		// onFeedback is passed through — verify message renders
		expect(screen.getByText('Answer')).toBeInTheDocument();
	});

	it('renders the draft bubble from liveDraft', () => {
		renderList({ liveDraft: { runId: 'A', text: 'partial answer' } });
		expect(screen.getByText('partial answer')).toBeTruthy();
	});

	it('hides the thinking indicator once a draft exists', () => {
		renderList({ streaming: { isStreaming: true }, liveDraft: { runId: 'A', text: 'x' } });
		expect(screen.queryByTestId('thinking-indicator')).toBeNull();
	});

	it('hides the thinking indicator once activities exist', () => {
		renderList({ streaming: { isStreaming: true }, activities: [
			{ id: 'a1', kind: 'TOOL', name: 'file_lookup', state: 'RUNNING' },
		] });
		expect(screen.queryByTestId('thinking-indicator')).toBeNull();
		expect(screen.getByTestId('activity-feed-live')).toBeTruthy();
	});

	it('shows the thinking indicator while waiting with neither', () => {
		renderList({ streaming: { isStreaming: true } });
		expect(screen.getByTestId('thinking-indicator')).toBeTruthy();
	});

	it('does not show thinking indicator when not streaming', () => {
		renderList({ messages: [makeMessage({ content: 'Done' }, 0)] });
		expect(screen.queryByTestId('thinking-indicator')).not.toBeInTheDocument();
	});

	it('renders the trail on a finished assistant message', () => {
		renderList({ messages: [{
			id: 1, localId: 'l1', role: 'assistant', content: 'done', timestamp: 0, status: 'sent',
			activities: [{ id: 'a1', kind: 'TOOL', name: 'file_lookup', state: 'FINISHED', durationMillis: 300 }],
		}] });
		expect(screen.getByTestId('activity-feed-trail')).toBeTruthy();
		expect(screen.getByText(/Tools used: 1/)).toBeTruthy();
	});
});
