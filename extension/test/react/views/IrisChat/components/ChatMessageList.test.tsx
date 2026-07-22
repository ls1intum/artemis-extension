import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import { useChatStore } from '@webview/stores/useChatStore';
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
	// ChatMessageList reads liveEpisodeIds from the store. Seed it with the
	// episode id used across the episode-grouping tests so they see live episodes
	// (rather than auto-folded reloaded ones). The global resetTestState beforeEach
	// clears the store first; this runs after it.
	beforeEach(() => {
		useChatStore.setState({ liveEpisodeIds: new Set(['ep-A']) });
	});

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
		// onFeedback is passed through, verify message renders
		expect(screen.getByText('Answer')).toBeInTheDocument();
	});

	it('renders a live multi-message episode as one block: all messages, one caption, no earlier-toggle', () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 1' }, 0),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 2' }, 1),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 3 latest' }, 2),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// The whole episode is one block: every message is visible, nothing hidden behind a toggle.
		expect(screen.getByText('Repeat 1')).toBeInTheDocument();
		expect(screen.getByText('Repeat 2')).toBeInTheDocument();
		expect(screen.getByText('Repeat 3 latest')).toBeInTheDocument();
		// Exactly one caption for the whole block, and no "show earlier" toggle.
		expect(screen.getAllByText('Iris reached out')).toHaveLength(1);
		expect(screen.queryByText(/earlier suggestion/i)).not.toBeInTheDocument();
	});

	it('groups an episode into one block even when a chat turn sits between the proactive messages', () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 1' }, 0),
			makeMessage({ role: 'user', content: 'thanks' }, 1),
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-A', content: 'Repeat 2 latest' }, 2),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// Both proactive messages render inside one block; the user turn stays inline.
		expect(screen.getByText('Repeat 1')).toBeInTheDocument();
		expect(screen.getByText('Repeat 2 latest')).toBeInTheDocument();
		expect(screen.getByText('thanks')).toBeInTheDocument();
		expect(screen.getAllByText('Iris reached out')).toHaveLength(1);
	});

	it('an explicit foldState wins over liveness: praise-pending (folded=false) episode stays OPEN even when not live', () => {
		// RECOVERED close with praise: the host posts FoldEpisode(praise) -> foldState { folded: false }
		// (waiting for the close row + ~5 s timer) AND SetLiveEpisode(null) -> episode leaves the live set.
		// The explicit foldState must decide alone, or the praise window collapses instantly.
		useChatStore.setState({
			liveEpisodeIds: new Set<string>(),
			foldStates: new Map([
				['ep-C', { folded: false, outcome: 'RECOVERED' as const, episodeLabel: 'Loop bound fixed', closeMessageId: 90 }],
			]),
		});
		const messages = [
			makeMessage({ id: 89, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-C', content: 'Check the loop bound' }, 0),
			makeMessage({ id: 90, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-C', content: 'Nice, that fixed it!' }, 1),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// Open block visible (praise window), not a collapsed fold line.
		expect(screen.getByText('Iris reached out')).toBeInTheDocument();
		expect(screen.getByText('Nice, that fixed it!')).toBeInTheDocument();
	});

	it('a hydrated episode marked live via setLiveEpisode renders as the OPEN timeline, not an "Earlier hint" fold', () => {
		// Reload path: rows come from LoadMessages (no addMessage registration), the host's
		// init-time SetLiveEpisode frame is the only liveness source.
		useChatStore.setState({ liveEpisodeIds: new Set<string>() });
		useChatStore.getState().setLiveEpisode('ep-D');
		const messages = [
			makeMessage({ id: 70, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-D', content: 'Hydrated live hint' }, 0),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.getByText('Iris reached out')).toBeInTheDocument();
		expect(screen.getByText('Hydrated live hint')).toBeInTheDocument();
		expect(screen.queryByRole('img', { name: 'Earlier hint' })).not.toBeInTheDocument();
	});

	it('an explicit folded=true foldState folds the episode even while it is still in the live set', () => {
		useChatStore.setState({
			liveEpisodeIds: new Set(['ep-E']),
			foldStates: new Map([['ep-E', { folded: true, outcome: 'DISMISSED' as const }]]),
		});
		const messages = [
			makeMessage({ id: 80, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-E', content: 'Dismissed hint' }, 0),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		expect(screen.getByRole('img', { name: 'Dismissed' })).toBeInTheDocument();
		expect(screen.queryByText('Iris reached out')).not.toBeInTheDocument();
	});

	it('a closed (non-live) episode shows a borderless summary line and expands into the full block with NO Dismiss', async () => {
		// ep-B is not in liveEpisodeIds -> it renders folded (closed). ids are set so a Dismiss button
		// WOULD render if the block were dismissable; a reopened closed block must keep it off.
		const messages = [
			makeMessage({ id: 50, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-B', content: 'In isValidSelection, fix the loop bound', proactiveOutcome: 'DISMISSED' }, 0),
			makeMessage({ id: 51, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-B', content: 'later stale-check' }, 1),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				onDismiss={vi.fn()}
				hasContext={true}
			/>
		);
		// Closed: an icon-only outcome (its aria-label names it, no visible word) + a topic from the first
		// hint; the messages stay hidden, no block caption yet.
		expect(screen.getByRole('img', { name: 'Dismissed' })).toBeInTheDocument();
		expect(screen.queryByText('Dismissed')).not.toBeInTheDocument();
		expect(screen.getByText('In isValidSelection, fix the loop bound')).toBeInTheDocument();
		expect(screen.queryByText('later stale-check')).not.toBeInTheDocument();
		expect(screen.queryByText('Iris reached out')).not.toBeInTheDocument();
		// Expand -> the outcome word now spells the icon out (visible text), and the shared block reveals
		// the single caption and every message, but stays non-dismissable.
		await userEvent.click(screen.getByRole('button', { name: /Dismissed/ }));
		expect(screen.getByText('Dismissed')).toBeInTheDocument();
		expect(screen.getByText('Iris reached out')).toBeInTheDocument();
		expect(screen.getByText('later stale-check')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Dismiss this suggestion' })).not.toBeInTheDocument();
	});

	it('the closed fold-line chevron toggles aria-expanded and reads the outcome word', async () => {
		const messages = [
			makeMessage({ role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-B', content: 'A single closed hint', proactiveOutcome: 'RECOVERED' }, 0),
		];
		render(
			<ChatMessageList
				messages={messages}
				streaming={defaultStreaming}
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// A RECOVERED closed episode reads "Resolved" (icon-only while collapsed: named via aria-label).
		expect(screen.getByRole('img', { name: 'Resolved' })).toBeInTheDocument();
		const toggle = screen.getByRole('button');
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await userEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
	});

	it('a live episode with a DISMISSED latest still shows all content in the block (no per-row collapse)', () => {
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
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
				onFeedback={vi.fn()}
				onSendPrompt={vi.fn()}
				hasContext={true}
			/>
		);
		// One block: the earlier repeat AND the dismissed latest are both visible (grouped = no per-row collapse).
		expect(screen.getByText('Earlier repeat')).toBeInTheDocument();
		expect(screen.getByText('Latest secret body')).toBeInTheDocument();
		expect(screen.queryByText('Show suggestion')).not.toBeInTheDocument();
		// One caption for the whole block.
		expect(screen.getAllByText('Iris reached out')).toHaveLength(1);
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
				activities={[]}
				liveDraft={null}
				runState={null}
				runError={null}
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
