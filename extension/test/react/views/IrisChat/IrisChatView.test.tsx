import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { useChatStore } from '@webview/stores/useChatStore';
import { IrisChatView } from '@webview/views/IrisChat/IrisChatView';

// Mock streamdown — ESM-only package
vi.mock('streamdown', () => ({
	Streamdown: ({ children }: { children?: string }) => (
		<span data-testid="streamdown">{children}</span>
	),
}));

// Mock use-stick-to-bottom — ESM package (must include scrollToBottom fn)
vi.mock('use-stick-to-bottom', () => ({
	useStickToBottom: vi.fn().mockReturnValue({
		scrollRef: { current: null },
		contentRef: { current: null },
		isAtBottom: true,
		scrollToBottom: vi.fn(),
	}),
}));

// Mock Shiki/CodeBlock to avoid dynamic imports
vi.mock('@webview/views/IrisChat/components/CodeBlock', () => ({
	CodeBlock: ({ children }: { language?: string; children?: string }) => (
		<pre><code>{children}</code></pre>
	),
}));

/** The conversation these tests run in. */
const OPEN = 900;

// Helper: seed a fully-hydrated conversation so tests that just want to
// exercise input/messaging can do `useChatStore.setState({ ...HYDRATED })`
// without re-typing the whole state shape.
const HYDRATED = {
	courseId: 10,
	courseTitle: 'Course X',
	currentSessionId: OPEN,
	loadedSessionId: OPEN,
	contentState: 'content' as const,
};

describe('IrisChatView', () => {
	beforeEach(() => {
		useChatStore.setState({
			courseId: null,
			courseTitle: null,
			currentSessionId: null,
			conversationTitle: null,
			workspaceExerciseId: null,
			exercises: [],
			courses: [],
			messages: [],
			loadedSessionId: null,
			streaming: { isStreaming: false },
			liveDraft: null,
			activities: [],
			runState: null,
			runError: null,
			lastRunUiRevision: 0,
			isLoading: false,
			webSocketStatus: 'connected',
			disabledMessage: null,
			unavailableMessage: null,
			isNoAiDetected: false,
			referencedFiles: null,
			showDiagnostics: false,
			// Default tests to post-init so they exercise the steady-state
			// rendering. Cold-mount tests opt out by setting this to false.
			hasReceivedInitialIrisState: true,
		});
	});

	it('renders the Iris chat header', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.getByText('Chat with Iris')).toBeInTheDocument();
	});

	it('renders chat input at the bottom', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.getByRole('textbox', { name: 'Chat input' })).toBeInTheDocument();
	});

	it('chat input is disabled when no conversation is open', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).toBeDisabled();
	});

	it('chat input is enabled when a conversation is open', () => {
		useChatStore.setState({ ...HYDRATED });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).not.toBeDisabled();
	});

	it('offers the course list when nothing is open', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.getByText(/No Artemis workspace detected/)).toBeInTheDocument();
	});

	describe('Header popovers', () => {
		it('opens the topic picker from the composer and posts selectTopic', async () => {
			useChatStore.setState({
				exercises: [{ id: 2, title: 'Other Exercise', courseId: 10 }],
				courses: [{ id: 10, title: 'Course X' }],
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByRole('button', { name: 'Choose topic' }));

			await waitFor(() => {
				expect(screen.getByText('Other Exercise')).toBeInTheDocument();
			});

			await userEvent.click(screen.getByText('Other Exercise'));

			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'selectTopic',
					payload: expect.objectContaining({
						mode: 'PROGRAMMING_EXERCISE_CHAT',
						entityId: 2,
					}),
				})
			);

			// Closing the picker after a selection must not leave both
			// popovers mounted.
			expect(screen.queryAllByRole('dialog')).toHaveLength(0);
		});

		it('never shows the topic picker and history at the same time', async () => {
			useChatStore.setState({
				exercises: [],
				courses: [],
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Open history first.
			await userEvent.click(screen.getByRole('button', { name: 'View past conversations' }));
			expect(screen.getAllByRole('dialog')).toHaveLength(1);

			// Now open the picker. History must unmount; exactly one dialog remains.
			await userEvent.click(screen.getByRole('button', { name: 'Choose topic' }));

			await waitFor(() => {
				expect(screen.getAllByRole('dialog')).toHaveLength(1);
			});
		});
	});

	describe('Run lock: navigation while Iris is streaming', () => {
		const NAV_COMMANDS = ['selectTopic', 'openConversation', 'newConversation', 'switchCourse', 'resetChatSessions'];

		const expectNoNavCommandPosted = (mockApi: ReturnType<typeof createMockVsCodeApi>) => {
			for (const command of NAV_COMMANDS) {
				expect(mockApi.postMessage).not.toHaveBeenCalledWith(
					expect.objectContaining({ type: 'command', command })
				);
			}
		};

		it('disables the header course label, new-conversation, and history buttons while streaming', () => {
			useChatStore.setState({
				...HYDRATED,
				streaming: { isStreaming: true },
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.getByRole('button', { name: /Course X/ })).toBeDisabled();
			expect(screen.getByLabelText('New conversation')).toBeDisabled();
			expect(screen.getByLabelText('View past conversations')).toBeDisabled();

			fireEvent.click(screen.getByRole('button', { name: /Course X/ }));
			fireEvent.click(screen.getByLabelText('New conversation'));
			fireEvent.click(screen.getByLabelText('View past conversations'));

			expectNoNavCommandPosted(mockApi);
		});

		it('closes an already-open topic picker when streaming starts, so a late row click cannot post selectTopic', async () => {
			useChatStore.setState({
				exercises: [{ id: 2, title: 'Other Exercise', courseId: 10 }],
				courses: [{ id: 10, title: 'Course X' }],
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByRole('button', { name: 'Choose topic' }));
			const otherExerciseRow = await screen.findByText('Other Exercise');

			// The run starts while the picker is still open.
			useChatStore.setState({ streaming: { isStreaming: true } });

			await waitFor(() => {
				expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
			});

			// The row reference was captured before the popover unmounted.
			// React tears down its listeners on unmount, so this simulates a
			// click that lands just as the run starts.
			fireEvent.click(otherExerciseRow);

			expectNoNavCommandPosted(mockApi);
		});

		it('closes an already-open history popover when streaming starts, so a late entry click cannot post openConversation', async () => {
			useChatStore.setState({
				...HYDRATED,
				conversations: [{
					sessionId: 99,
					courseId: 10,
					mode: 'PROGRAMMING_EXERCISE_CHAT',
					entityId: 5,
					entityName: 'Other Exercise',
					title: 'Old conversation',
					lastActivity: Date.now(),
				}],
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByRole('button', { name: 'View past conversations' }));

			const historyRow = await screen.findByText('Old conversation');
			const newConversationButton = within(screen.getByRole('dialog')).getByRole('button', { name: /new conversation/i });

			// The run starts while the history popover is still open.
			useChatStore.setState({ streaming: { isStreaming: true } });

			await waitFor(() => {
				expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
			});

			fireEvent.click(historyRow);
			fireEvent.click(newConversationButton);

			expectNoNavCommandPosted(mockApi);
		});

		it('closes an already-open side menu when streaming starts, so a late click cannot post resetChatSessions', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
			const resetButton = screen.getByText('Reset & Sync Sessions');

			// The run starts while the side menu is still open.
			useChatStore.setState({ streaming: { isStreaming: true } });

			await waitFor(() => {
				expect(screen.queryByText('Reset & Sync Sessions')).not.toBeInTheDocument();
			});

			fireEvent.click(resetButton);

			expectNoNavCommandPosted(mockApi);
		});
	});

	it('sends sendMessage command when user submits text', async () => {
		useChatStore.setState({ ...HYDRATED });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello Iris{Enter}');

		await waitFor(() => {
			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'sendMessage',
					payload: expect.objectContaining({
						text: 'Hello Iris',
						// #178: payload carries the optimistic message's localId
						// and the active local session UUID so the host can echo
						// them back on rejection without races.
						localId: expect.any(String),
						sessionId: OPEN,
					}),
				})
			);
		});
	});

	it('adds optimistic user message to the list after send', async () => {
		useChatStore.setState({ ...HYDRATED });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello Iris{Enter}');

		await waitFor(() => {
			expect(screen.getByText('Hello Iris')).toBeInTheDocument();
		});
	});

	it('loads messages from loadMessages extension event', async () => {
		// The transcript is gated on the open conversation.
		useChatStore.setState({ ...HYDRATED });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'loadMessages',
			sessionId: OPEN,
			messages: [
				{ id: 1, role: 'user', content: 'Hi there', timestamp: Date.now(), helpful: null },
				{ id: 2, role: 'assistant', content: 'Hello!', timestamp: Date.now(), helpful: null },
			],
		});

		await waitFor(() => {
			expect(screen.getByText('Hi there')).toBeInTheDocument();
			expect(screen.getByText('Hello!')).toBeInTheDocument();
		});
	});

	it('adds a single message from addMessage extension event', async () => {
		// applyCommit drops a message for a conversation that is not open, so
		// both must line up for the commit to land.
		useChatStore.setState({ ...HYDRATED });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'addMessage',
			sessionId: OPEN,
			message: { id: 5, role: 'assistant', content: 'New reply', timestamp: Date.now() },
		});

		await waitFor(() => {
			expect(screen.getByText('New reply')).toBeInTheDocument();
		});
	});

	it('shows disabled banner when disabledMessage is set', () => {
		useChatStore.setState({ disabledMessage: 'Iris is not available for this exercise.' });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.getByText('Iris is not available for this exercise.')).toBeInTheDocument();
	});

	it('shows .noai detected banner when isNoAiDetected is true', () => {
		useChatStore.setState({ isNoAiDetected: true });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.getByText(/\.noai file was detected/i)).toBeInTheDocument();
	});

	it('shows WebSocket disconnected banner when retries are exhausted', () => {
		useChatStore.setState({ webSocketStatus: 'disconnected' });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.getByText('WebSocket disconnected')).toBeInTheDocument();
	});

	describe('Iris unavailable banner', () => {
		it('renders the unavailable banner with a Retry button when unavailableMessage is set', () => {
			useChatStore.setState({
				unavailableMessage: 'Iris is temporarily unavailable. Retry to reload.',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.getByText('Iris is temporarily unavailable. Retry to reload.')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
		});

		it('posts reloadChatSession when the unavailable Retry button is clicked', async () => {
			useChatStore.setState({
				unavailableMessage: 'Iris is temporarily unavailable. Retry to reload.',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByRole('button', { name: /retry/i }));

			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'reloadChatSession',
				})
			);
		});

		it('does NOT render the loader when unavailableMessage is set even if an active session is awaiting hydration', () => {
			useChatStore.setState({
				courseId: 10,
				courseTitle: 'Course X',
				currentSessionId: 42,
				loadedSessionId: null,
				unavailableMessage: 'Iris is temporarily unavailable. Retry to reload.',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// The previous bug (#219) left the loader spinning forever when
			// the chat became unavailable. The banner is the terminal state
			// — no spinner should coexist with it.
			expect(screen.queryByText(/Loading conversation/i)).not.toBeInTheDocument();
		});

		it('does NOT render the loader when disabledMessage is set (parallel fix to the spinning-forever bug)', () => {
			useChatStore.setState({
				courseId: 10,
				courseTitle: 'Course X',
				currentSessionId: 42,
				loadedSessionId: null,
				disabledMessage: 'Iris chat is not enabled for this exercise. Please contact your instructor.',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.queryByText(/Loading conversation/i)).not.toBeInTheDocument();
		});

		it('suppresses the websocket-disconnected banner when the unavailable banner is active (avoid duplicate Retry affordances)', () => {
			useChatStore.setState({
				webSocketStatus: 'disconnected',
				unavailableMessage: 'Iris is temporarily unavailable. Retry to reload.',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// The unavailable banner already has the Retry action — surfacing
			// the websocket banner alongside would give the user two
			// competing recovery affordances for the same underlying problem.
			expect(screen.queryByText('WebSocket disconnected')).not.toBeInTheDocument();
		});

		it('lets the disabled banner win when both fields are non-null (defensive — extension never emits both)', () => {
			useChatStore.setState({
				disabledMessage: 'Iris chat is not enabled for this exercise.',
				unavailableMessage: 'Iris is temporarily unavailable.',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Disabled is the more specific signal, so it wins. The store
			// cross-clears in normal flow, so this state shouldn't arise —
			// but if it ever does, the user must not be told two
			// contradictory things at once.
			expect(screen.getByText('Iris chat is not enabled for this exercise.')).toBeInTheDocument();
			expect(screen.queryByText('Iris is temporarily unavailable.')).not.toBeInTheDocument();
		});

		it('disables the chat input with an unavailable-specific placeholder', () => {
			useChatStore.setState({
				...HYDRATED,
				unavailableMessage: 'Iris is temporarily unavailable. Retry to reload.',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const input = screen.getByPlaceholderText(/temporarily unavailable/i);
			expect(input).toBeDisabled();
		});
	});

	describe('ShowUnavailableState / HideUnavailableState message handling', () => {
		it('sets unavailableMessage on ShowUnavailableState and clears it on HideUnavailableState', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'showUnavailableState',
				message: 'Iris is temporarily unavailable. Retry to reload.',
			});

			await waitFor(() => {
				expect(screen.getByText('Iris is temporarily unavailable. Retry to reload.')).toBeInTheDocument();
			});

			dispatchExtensionMessage({ type: 'hideUnavailableState' });

			await waitFor(() => {
				expect(screen.queryByText('Iris is temporarily unavailable. Retry to reload.')).not.toBeInTheDocument();
			});
		});
	});

	describe('Message hydration loader', () => {
		// Helper to set up a state where there IS an active session waiting for hydration.
		const seedActiveSession = (sessionId: number) => {
			useChatStore.setState({
				courseId: 10,
				courseTitle: 'Course X',
				currentSessionId: sessionId,
				loadedSessionId: null,
				contentState: 'content',
			});
		};

		it('shows loader while the open conversation has no transcript yet', () => {
			seedActiveSession(42);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Welcome state should NOT be shown while we wait for hydration.
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
			// Loader is identified by its 'Loading conversation' text.
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
		});

		it('hides loader and shows welcome state after an empty transcript for the open conversation', async () => {
			seedActiveSession(42);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'loadMessages', sessionId: 42, messages: [] });

			await waitFor(() => {
				expect(screen.getByText("Hi! I'm Iris, your AI tutor.")).toBeInTheDocument();
			});
		});

		it('ignores a transcript for a different conversation and leaves the store untouched', () => {
			seedActiveSession(99);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: 42,
				messages: [
					{ id: 1, role: 'user', content: 'stale', timestamp: 0, helpful: null },
				],
			});

			// Stale message must not appear; loader stays; store keeps no record of the stale load.
			expect(screen.queryByText('stale')).not.toBeInTheDocument();
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
			expect(useChatStore.getState().loadedSessionId).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
		});

		it('discards a late-arriving stale transcript that fires after the open conversation has hydrated', async () => {
			seedActiveSession(99);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// The open conversation hydrates with one message.
			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: 99,
				messages: [
					{ id: 10, role: 'assistant', content: 'live', timestamp: 0, helpful: null },
				],
			});
			await waitFor(() => {
				expect(screen.getByText('live')).toBeInTheDocument();
			});

			// A late stale response for a different conversation arrives. It must
			// NOT overwrite the live messages or re-point the hydration.
			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: 42,
				messages: [
					{ id: 7, role: 'user', content: 'should not appear', timestamp: 0, helpful: null },
				],
			});

			expect(screen.queryByText('should not appear')).not.toBeInTheDocument();
			expect(screen.getByText('live')).toBeInTheDocument();
			expect(useChatStore.getState().loadedSessionId).toBe(99);
		});

		it('A→B navigation: a late transcript for A is discarded once B is open', async () => {
			seedActiveSession(1);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// The student navigates to B before A's transcript arrives.
			seedActiveSession(2);

			// A's late response now arrives. Must NOT mutate store state.
			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: 1,
				messages: [
					{ id: 1, role: 'user', content: 'from-A', timestamp: 0, helpful: null },
				],
			});

			expect(useChatStore.getState().loadedSessionId).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
			expect(screen.queryByText('from-A')).not.toBeInTheDocument();
		});

		it('rejects a late transcript when no conversation is open (post-navigation leak guard)', () => {
			// Default state in beforeEach has currentSessionId === null.
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: 99,
				messages: [
					{ id: 7, role: 'user', content: 'should not appear', timestamp: 0, helpful: null },
				],
			});

			// With nothing open, a stale transcript must not pollute the store.
			expect(useChatStore.getState().loadedSessionId).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
		});

		it('keeps loader on the very first render before any UpdateIrisState (cold-mount welcome flash guard)', () => {
			// Pre-init state: no snapshot has arrived yet. Even though
			// currentSessionId is null, the welcome state must NOT flash —
			// we cannot tell "nothing open" from "snapshot pending" until
			// the first UpdateIrisState push.
			useChatStore.setState({
				currentSessionId: null,
				loadedSessionId: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
		});

		it('keeps the loader when a snapshot names a conversation whose transcript has not arrived', async () => {
			// The host posts the snapshot first and the transcript a moment
			// later. That gap means "the transcript is still coming" — the
			// Iris greeting must NOT flash.
			useChatStore.setState({
				currentSessionId: null,
				loadedSessionId: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					exercises: [],
					courses: [],
					courseId: 10,
					courseTitle: 'Course X',
					currentSessionId: 42,
					conversationTitle: undefined,
					displayMessageCount: 0,
					committedContext: undefined,
					pendingContext: undefined,
					contentState: 'empty',
					sendInFlight: false,
					navigationInFlight: false,
					conversations: [],
					workspaceExerciseId: 1,
				},
			});

			await waitFor(() => {
				expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
			});
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
		});

		it('offers the course list when a snapshot arrives with nothing open', async () => {
			// The legitimate "no work to do" steady state: no workspace
			// exercise and no conversation, so the cold start takes over.
			useChatStore.setState({
				currentSessionId: null,
				loadedSessionId: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					exercises: [],
					courses: [],
					courseId: undefined,
					courseTitle: undefined,
					currentSessionId: undefined,
					conversationTitle: undefined,
					displayMessageCount: 0,
					committedContext: undefined,
					pendingContext: undefined,
					contentState: 'unknown',
					sendInFlight: false,
					navigationInFlight: false,
					conversations: [],
					workspaceExerciseId: undefined,
				},
			});

			await waitFor(() => {
				expect(screen.getByText(/No Artemis workspace detected/i)).toBeInTheDocument();
			});
		});
	});

	describe('MergeSessionMessages / ConfirmSentMessage (reconnect reconciliation)', () => {
		const seedActiveSession = (sessionId: number) => {
			useChatStore.setState({
				courseId: 10,
				courseTitle: 'Course X',
				currentSessionId: sessionId,
				contentState: 'content',
				loadedSessionId: sessionId,
			});
		};

		it('merges MergeSessionMessages into the open conversation without wiping a live draft', async () => {
			seedActiveSession(42);
			useChatStore.setState({ liveDraft: { runId: 'run-1', text: 'draft in progress' } });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'mergeSessionMessages',
				sessionId: 42,
				messages: [
					{ id: 1, role: 'assistant', content: 'merged answer', timestamp: 0, helpful: null },
				],
			});

			await waitFor(() => {
				expect(screen.getByText('merged answer')).toBeInTheDocument();
			});
			// The whole point of a merge (vs. LoadMessages) is that it does not
			// call resetTransientChatUi, so a live draft must survive it.
			expect(useChatStore.getState().liveDraft).toEqual({ runId: 'run-1', text: 'draft in progress' });
		});

		it('ignores MergeSessionMessages for a conversation that is not open', () => {
			seedActiveSession(99);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'mergeSessionMessages',
				sessionId: 1,
				messages: [
					{ id: 5, role: 'assistant', content: 'should not appear', timestamp: 0, helpful: null },
				],
			});

			expect(screen.queryByText('should not appear')).not.toBeInTheDocument();
			expect(useChatStore.getState().messages).toEqual([]);
		});

		it('stamps the optimistic user bubble with its server id on ConfirmSentMessage', async () => {
			seedActiveSession(42);
			const localId = 'optimistic-1';
			useChatStore.setState({
				messages: [
					{ localId, role: 'user', content: 'hello', timestamp: 0, status: 'sending' },
				],
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'confirmSentMessage', sessionId: 42, localId, id: 7 });

			await waitFor(() => {
				const stamped = useChatStore.getState().messages.find((m) => m.localId === localId);
				expect(stamped?.id).toBe(7);
				expect(stamped?.status).toBe('sent');
			});
		});

		it('ignores ConfirmSentMessage for a conversation that is not open', () => {
			seedActiveSession(99);
			const localId = 'optimistic-1';
			useChatStore.setState({
				messages: [
					{ localId, role: 'user', content: 'hello', timestamp: 0, status: 'sending' },
				],
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'confirmSentMessage', sessionId: 1, localId, id: 7 });

			const untouched = useChatStore.getState().messages.find((m) => m.localId === localId);
			expect(untouched?.id).toBeUndefined();
			expect(untouched?.status).toBe('sending');
		});
	});

	it('does not show banner during initial connect or reconnect attempts', () => {
		useChatStore.setState({ webSocketStatus: 'connecting' });
		const mockApi = createMockVsCodeApi();
		const { rerender } = render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.queryByText('WebSocket disconnected')).not.toBeInTheDocument();

		useChatStore.setState({ webSocketStatus: 'reconnecting' });
		rerender(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.queryByText('WebSocket disconnected')).not.toBeInTheDocument();

		useChatStore.setState({ webSocketStatus: 'unknown' });
		rerender(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.queryByText('WebSocket disconnected')).not.toBeInTheDocument();
	});

	it('reconnect button sends reconnectWebSocket command', async () => {
		useChatStore.setState({ webSocketStatus: 'disconnected' });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		const reconnectButton = screen.getByText('Reconnect');
		await userEvent.click(reconnectButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'reconnectWebSocket',
			})
		);
	});

	it('renders menu button in header', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
	});

	it('menu opens when menu button clicked', async () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		const menuButton = screen.getByRole('button', { name: 'Menu' });
		await userEvent.click(menuButton);

		expect(screen.getByText('Reset & Sync Sessions')).toBeInTheDocument();
	});

	it('reset sessions sends resetChatSessions command', async () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
		await userEvent.click(screen.getByText('Reset & Sync Sessions'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'resetChatSessions',
			})
		);
	});

	it('replaces the transcript when a new conversation is opened', async () => {
		// There is no "clear" message any more: a navigation delivers the new
		// conversation's transcript, which replaces the old one wholesale.
		useChatStore.setState({
			...HYDRATED,
			messages: [
				{ id: 1, localId: 'a', role: 'user', content: 'Existing msg', timestamp: Date.now(), helpful: null, status: 'sent' },
			],
		});
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		expect(screen.getByText('Existing msg')).toBeInTheDocument();

		dispatchExtensionMessage({ type: 'loadMessages', sessionId: OPEN, messages: [] });

		await waitFor(() => {
			expect(screen.queryByText('Existing msg')).not.toBeInTheDocument();
		});
	});

	describe('run UI projection and reset paths', () => {
		beforeEach(() => {
			// Seed an in-flight run: waiting flag on, a partial draft and a
			// running activity, so each path can assert whether it is cleared.
			useChatStore.setState({
				streaming: { isStreaming: true },
				liveDraft: { runId: 'A', text: 'partial' },
				activities: [{ id: 'a1', kind: 'TOOL', name: 'file_lookup', state: 'RUNNING' }],
				runState: 'RUNNING',
				lastRunUiRevision: 0,
				...HYDRATED,
			});
		});

		it('commits an assistant message with a runUi and clears the run UI atomically', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addMessage',
				sessionId: OPEN,
				runUi: {
					sessionId: OPEN, revision: 5, draft: null,
					activities: [], waiting: false, runState: 'FINISHED',
				},
				message: { id: 1, role: 'assistant', content: 'Response', timestamp: Date.now() },
			});

			await waitFor(() => {
				expect(screen.getByText('Response')).toBeInTheDocument();
			});
			expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			expect(useChatStore.getState().liveDraft).toBeNull();
			expect(useChatStore.getState().activities).toEqual([]);
		});

		it('does not clear the waiting flag when an intermediate (final:false) message arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// An intermediate message carries no runUi: the run continues, so
			// the waiting flag (and the rest of the run UI) must survive.
			dispatchExtensionMessage({
				type: 'addMessage',
				sessionId: OPEN,
				message: { id: 2, role: 'assistant', content: 'Intermediate', timestamp: Date.now(), final: false },
			});

			await waitFor(() => {
				expect(screen.getByText('Intermediate')).toBeInTheDocument();
			});
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().liveDraft?.text).toBe('partial');
		});

		it('applies a standalone UpdateIrisRunUi projection', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'updateIrisRunUi',
				projection: {
					sessionId: OPEN, revision: 2,
					draft: { runId: 'B', text: 'new draft' },
					activities: [], waiting: true, runState: 'RUNNING',
				},
			});

			await waitFor(() => {
				expect(useChatStore.getState().liveDraft?.text).toBe('new draft');
			});
		});

		it('clears the run UI when LoadMessages arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: OPEN,
				artemisSessionId: 42,
				messages: [{ id: 1, role: 'user', content: 'Loaded', timestamp: Date.now(), helpful: null }],
			});

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			});
			expect(useChatStore.getState().liveDraft).toBeNull();
		});

		it('clears the run UI when UpdateWebSocketStatus reports a non-connected state', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'updateWebSocketStatus', status: 'disconnected' });

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			});
			expect(useChatStore.getState().liveDraft).toBeNull();
			expect(useChatStore.getState().activities).toEqual([]);
		});

		it('does not clear the run UI when UpdateWebSocketStatus reports connected', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'updateWebSocketStatus', status: 'connected' });

			await waitFor(() => {
				expect(useChatStore.getState().webSocketStatus).toBe('connected');
			});
			expect(useChatStore.getState().liveDraft?.text).toBe('partial');
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
		});

		it('clears the run draft when the user sends a message', async () => {
			// Streaming must be off for the input to be enabled; the stale
			// draft/activities from a previous run should be cleared on send.
			useChatStore.setState({ streaming: { isStreaming: false } });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await userEvent.type(textarea, 'Hello{Enter}');

			await waitFor(() => {
				expect(useChatStore.getState().liveDraft).toBeNull();
			});
			expect(useChatStore.getState().activities).toEqual([]);
		});
	});
});
