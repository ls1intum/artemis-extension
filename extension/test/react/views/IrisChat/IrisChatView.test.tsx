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

// Helper: seed a fully-hydrated session so tests that just want to
// exercise input/messaging can do `useChatStore.setState({ context, ...HYDRATED })`
// without re-typing the whole state-shape.
const HYDRATED = {
	activeSessionId: 'local-test',
	sessions: [{
		id: 'local-test',
		artemisSessionId: undefined,
		preview: '',
		title: '',
		messageCount: 0,
		createdAt: 0,
		lastActivity: 0,
	}],
	messageLoad: { localSessionId: 'local-test', status: 'success' as const },
};

describe('IrisChatView', () => {
	beforeEach(() => {
		useChatStore.setState({
			context: null,
			activeSessionId: null,
			sessions: [],
			exercises: [],
			courses: [],
			messages: [],
			messageLoad: null,
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

	it('chat input is disabled when no context is selected', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).toBeDisabled();
	});

	it('chat input is enabled when context is set', () => {
		useChatStore.setState({
			context: {
				type: 'exercise',
				id: 1,
				title: 'Test Exercise',
				locked: false,
				source: 'user-selected',
			},
			...HYDRATED,
		});
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		expect(textarea).not.toBeDisabled();
	});

	it('shows the header prompt to select a context when none is set', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		// ChatHeader shows "Select a course or exercise" when no context.
		expect(screen.getByText('Select a course or exercise')).toBeInTheDocument();
	});

	describe('Header popovers', () => {
		it('opens the context picker from the header and posts selectChatContext', async () => {
			useChatStore.setState({
				context: {
					type: 'exercise',
					id: 1,
					title: 'Test Exercise',
					locked: false,
					source: 'user-selected',
				},
				exercises: [
					{ id: 2, title: 'Other Exercise', courseId: 10 },
				],
				courses: [{ id: 10, title: 'Course X' }],
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByText('Test Exercise'));

			await waitFor(() => {
				expect(screen.getByText('Other Exercise')).toBeInTheDocument();
			});

			await userEvent.click(screen.getByText('Other Exercise'));

			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'selectChatContext',
					payload: expect.objectContaining({
						context: 'exercise',
						itemId: 2,
					}),
				})
			);

			// Closing the picker after a selection must not leave both
			// popovers mounted.
			expect(screen.queryAllByRole('dialog')).toHaveLength(0);
		});

		it('never shows the context picker and history at the same time', async () => {
			useChatStore.setState({
				context: {
					type: 'exercise',
					id: 1,
					title: 'Test Exercise',
					locked: false,
					source: 'user-selected',
				},
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
			await userEvent.click(screen.getByText('Test Exercise'));

			await waitFor(() => {
				expect(screen.getAllByRole('dialog')).toHaveLength(1);
			});
		});
	});

	describe('Run lock: navigation while Iris is streaming', () => {
		const exerciseContext = {
			type: 'exercise' as const,
			id: 1,
			title: 'Test Exercise',
			shortName: 'TE',
			courseId: 10,
			locked: false,
			source: 'user-selected' as const,
		};

		// canCreateConversation requires a non-empty active session; use this
		// instead of HYDRATED so the "New conversation" affordances start out
		// enabled and any suppression proven below is caused by the run
		// lock, not by the pre-existing (unrelated) canCreateConversation gate.
		const HYDRATED_NON_EMPTY = {
			...HYDRATED,
			sessions: [{ ...HYDRATED.sessions[0], messageCount: 1 }],
		};

		const NAV_COMMANDS = ['selectChatContext', 'switchSession', 'createNewSession', 'openArtemisSession', 'resetChatSessions'];

		const expectNoNavCommandPosted = (mockApi: ReturnType<typeof createMockVsCodeApi>) => {
			for (const command of NAV_COMMANDS) {
				expect(mockApi.postMessage).not.toHaveBeenCalledWith(
					expect.objectContaining({ type: 'command', command })
				);
			}
		};

		it('disables the ChatHeader context row, new-conversation, and history buttons while streaming', () => {
			useChatStore.setState({
				context: exerciseContext,
				...HYDRATED_NON_EMPTY,
				streaming: { isStreaming: true },
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.getByRole('button', { name: /Test Exercise/ })).toBeDisabled();
			expect(screen.getByLabelText('New conversation')).toBeDisabled();
			expect(screen.getByLabelText('View past conversations')).toBeDisabled();

			fireEvent.click(screen.getByRole('button', { name: /Test Exercise/ }));
			fireEvent.click(screen.getByLabelText('New conversation'));
			fireEvent.click(screen.getByLabelText('View past conversations'));

			expectNoNavCommandPosted(mockApi);
		});

		it('closes an already-open context picker when streaming starts, so a late row click cannot post selectChatContext', async () => {
			useChatStore.setState({
				context: exerciseContext,
				exercises: [{ id: 2, title: 'Other Exercise', courseId: 10 }],
				courses: [{ id: 10, title: 'Course X' }],
				...HYDRATED_NON_EMPTY,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByText('Test Exercise'));
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

		it('closes an already-open history popover when streaming starts, so a late entry click cannot post openArtemisSession', async () => {
			useChatStore.setState({
				context: exerciseContext,
				...HYDRATED_NON_EMPTY,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await userEvent.click(screen.getByRole('button', { name: 'View past conversations' }));

			dispatchExtensionMessage({
				type: 'updateCourseHistory',
				requestId: 1,
				entries: [{
					artemisSessionId: 99,
					courseId: 10,
					mode: 'PROGRAMMING_EXERCISE_CHAT',
					entityId: 5,
					entityName: 'Other Exercise',
					title: 'Old conversation',
					lastActivity: Date.now(),
				}],
			});

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
		useChatStore.setState({
			context: {
				type: 'exercise',
				id: 1,
				title: 'Test Exercise',
				locked: false,
				source: 'user-selected',
			},
			...HYDRATED,
		});
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
						localSessionId: 'local-test',
					}),
				})
			);
		});
	});

	it('adds optimistic user message to the list after send', async () => {
		useChatStore.setState({
			context: {
				type: 'exercise',
				id: 1,
				title: 'Test Exercise',
				locked: false,
				source: 'user-selected',
			},
			...HYDRATED,
		});
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		const textarea = screen.getByRole('textbox', { name: 'Chat input' });
		await userEvent.type(textarea, 'Hello Iris{Enter}');

		await waitFor(() => {
			expect(screen.getByText('Hello Iris')).toBeInTheDocument();
		});
	});

	it('loads messages from loadMessages extension event', async () => {
		// LoadMessages is gated on activeSessionId — set it to match the payload.
		useChatStore.setState({ activeSessionId: 'local-test' });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'loadMessages',
			localSessionId: 'local-test',
			artemisSessionId: 42,
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
		// applyCommit drops a message whose localSessionId does not match the
		// active session, so both must line up for the commit to land.
		useChatStore.setState({ activeSessionId: 'local-test' });
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'addMessage',
			localSessionId: 'local-test',
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
				context: {
					type: 'exercise',
					id: 1,
					title: 'Test Exercise',
					shortName: 'TE',
					courseId: 10,
					locked: false,
					source: 'user-selected',
				},
				activeSessionId: 'local-A',
				sessions: [{
					id: 'local-A',
					artemisSessionId: 42,
					preview: '',
					title: '',
					messageCount: 0,
					createdAt: 0,
					lastActivity: 0,
				}],
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
				context: {
					type: 'exercise',
					id: 1,
					title: 'Test Exercise',
					shortName: 'TE',
					courseId: 10,
					locked: false,
					source: 'user-selected',
				},
				activeSessionId: 'local-A',
				sessions: [{
					id: 'local-A',
					artemisSessionId: 42,
					preview: '',
					title: '',
					messageCount: 0,
					createdAt: 0,
					lastActivity: 0,
				}],
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
				context: {
					type: 'exercise',
					id: 1,
					title: 'Test Exercise',
					shortName: 'TE',
					courseId: 10,
					locked: false,
					source: 'user-selected',
				},
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
		const seedActiveSession = (localSessionId: string, artemisSessionId?: number) => {
			useChatStore.setState({
				context: {
					type: 'exercise',
					id: 1,
					title: 'Test Exercise',
					shortName: 'TE',
					courseId: 10,
					locked: false,
					source: 'user-selected',
				},
				activeSessionId: localSessionId,
				sessions: [
					{
						id: localSessionId,
						artemisSessionId: artemisSessionId ?? undefined,
						preview: '',
						title: '',
						messageCount: 0,
						createdAt: 0,
						lastActivity: 0,
					},
				],
			});
		};

		it('shows loader while messageLoad is null for the active session', () => {
			seedActiveSession('local-A', 42);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Welcome state should NOT be shown while we wait for hydration.
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
			// Loader is identified by its 'Loading conversation' text.
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
		});

		it('shows loader for a brand-new local session that has no artemisSessionId yet', () => {
			// New-session path: local UUID exists, but server has not returned an id yet.
			seedActiveSession('local-new');
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
		});

		it('hides loader and shows welcome state after empty LoadMessages for the active session', async () => {
			seedActiveSession('local-A', 42);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'loadMessages', localSessionId: 'local-A', artemisSessionId: 42, messages: [] });

			await waitFor(() => {
				expect(screen.getByText("Hi! I'm Iris, your AI tutor.")).toBeInTheDocument();
			});
		});

		it('ignores stale LoadMessages for a different local session and leaves the store untouched', () => {
			seedActiveSession('local-current', 99);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-stale',
				artemisSessionId: 42,
				messages: [
					{ id: 1, role: 'user', content: 'stale', timestamp: 0, helpful: null },
				],
			});

			// Stale message must not appear; loader stays; store keeps no record of the stale load.
			expect(screen.queryByText('stale')).not.toBeInTheDocument();
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
			expect(useChatStore.getState().messageLoad).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
		});

		it('discards a late-arriving stale load that fires after the current session has hydrated', async () => {
			seedActiveSession('local-current', 99);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Current session hydrates with one message.
			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-current',
				artemisSessionId: 99,
				messages: [
					{ id: 10, role: 'assistant', content: 'live', timestamp: 0, helpful: null },
				],
			});
			await waitFor(() => {
				expect(screen.getByText('live')).toBeInTheDocument();
			});

			// A late stale response for a different session arrives. It must NOT
			// overwrite the live messages or flip the load state back to that session.
			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-old',
				artemisSessionId: 42,
				messages: [
					{ id: 7, role: 'user', content: 'should not appear', timestamp: 0, helpful: null },
				],
			});

			expect(screen.queryByText('should not appear')).not.toBeInTheDocument();
			expect(screen.getByText('live')).toBeInTheDocument();
			expect(useChatStore.getState().messageLoad).toEqual({ localSessionId: 'local-current', status: 'success' });
		});

		it('A→B same-context switch: a late load tagged with A is discarded once B is active', async () => {
			seedActiveSession('local-A', 1);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// User switches to B before A's load completes.
			seedActiveSession('local-B', 2);

			// A's late response now arrives. Must NOT mutate store state.
			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-A',
				artemisSessionId: 1,
				messages: [
					{ id: 1, role: 'user', content: 'from-A', timestamp: 0, helpful: null },
				],
			});

			expect(useChatStore.getState().messageLoad).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
			expect(screen.queryByText('from-A')).not.toBeInTheDocument();
		});

		it('rejects late stale LoadMessages when no session is active (post-clear leak guard)', () => {
			// Default state in beforeEach has activeSessionId === null.
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-stale',
				artemisSessionId: 99,
				messages: [
					{ id: 7, role: 'user', content: 'should not appear', timestamp: 0, helpful: null },
				],
			});

			// With no active session, a stale load must not pollute the store.
			expect(useChatStore.getState().messageLoad).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
		});

		it('shows error UI when LoadMessagesError matches the active session', async () => {
			seedActiveSession('local-A', 42);
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'loadMessagesError', localSessionId: 'local-A' });

			await waitFor(() => {
				expect(screen.getByText(/Failed to load chat history/i)).toBeInTheDocument();
			});
		});

		it('keeps loader on the very first render before any UpdateIrisState (cold-mount welcome flash guard)', () => {
			// Pre-init state: no snapshot has arrived yet. Even though
			// activeSessionId is null, the welcome state must NOT flash —
			// we cannot tell "no session" from "snapshot pending" until
			// the first UpdateIrisState push.
			useChatStore.setState({
				activeSessionId: null,
				messageLoad: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
		});

		it('keeps loader when UpdateIrisState arrives with a context but no active session yet', async () => {
			// The cold-start path posts a snapshot before any sessions have
			// been imported, so the first UpdateIrisState often carries
			// `context: <something>` together with `activeSessionId: null`.
			// That state means "sessions are still loading" — the Iris
			// greeting must NOT flash; the loader stays up until either
			// LoadMessages arrives or a follow-up snapshot brings the
			// imported session id.
			useChatStore.setState({
				activeSessionId: null,
				messageLoad: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					context: {
						type: 'exercise',
						id: 1,
						title: 'Test Exercise',
						shortName: 'TE',
						courseId: 10,
						locked: false,
						source: 'user-selected',
					},
					activeSessionId: null,
					sessions: [],
					exercises: [],
					courses: [],
				},
			});

			await waitFor(() => {
				expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
			});
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
		});

		it('shows welcome ("Select a course") when UpdateIrisState arrives with no context', async () => {
			// The legitimate "no work to do" steady state: extension says no
			// context selected. WelcomeState renders the "Select a course
			// or exercise" copy — that is hydrated.
			useChatStore.setState({
				activeSessionId: null,
				messageLoad: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					context: null,
					activeSessionId: null,
					sessions: [],
					exercises: [],
					courses: [],
				},
			});

			await waitFor(() => {
				expect(screen.getByText(/Select a course or exercise/i)).toBeInTheDocument();
			});
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

	it('clears all messages on clearChatMessages event', async () => {
		useChatStore.setState({
			messages: [
				{ id: 1, localId: 'a', role: 'user', content: 'Existing msg', timestamp: Date.now(), helpful: null, status: 'sent' },
			],
		});
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		expect(screen.getByText('Existing msg')).toBeInTheDocument();

		dispatchExtensionMessage({ type: 'clearChatMessages' });

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
				context: {
					type: 'exercise',
					id: 1,
					title: 'Test Exercise',
					locked: false,
					source: 'user-selected',
				},
				...HYDRATED,
			});
		});

		it('commits an assistant message with a runUi and clears the run UI atomically', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addMessage',
				localSessionId: 'local-test',
				runUi: {
					localSessionId: 'local-test', revision: 5, draft: null,
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
				localSessionId: 'local-test',
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
					localSessionId: 'local-test', revision: 2,
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
				localSessionId: 'local-test',
				artemisSessionId: 42,
				messages: [{ id: 1, role: 'user', content: 'Loaded', timestamp: Date.now(), helpful: null }],
			});

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			});
			expect(useChatStore.getState().liveDraft).toBeNull();
		});

		it('clears the run UI when ClearChatMessages arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'clearChatMessages' });

			await waitFor(() => {
				expect(useChatStore.getState().liveDraft).toBeNull();
			});
			expect(useChatStore.getState().activities).toEqual([]);
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
