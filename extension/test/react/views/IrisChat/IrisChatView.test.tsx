import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
			suppressedIds: new Set<number>(),
			staleAskBindings: new Map<number, { askId: string; question: string }>(),
			foldStates: new Map(),
			liveEpisodeIds: new Set(),
			streaming: { isStreaming: false },
			irisStages: [],
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

	it('shows context selector', () => {
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);
		// ContextSelector shows "Select context" when no context
		expect(screen.getByText('Select context')).toBeInTheDocument();
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
		const mockApi = createMockVsCodeApi();
		render(<IrisChatView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'addMessage',
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

	describe('irisStages reset paths', () => {
		beforeEach(() => {
			useChatStore.setState({
				irisStages: [{ name: 'thinking', state: 'IN_PROGRESS', message: 'Thinking', weight: 10 }],
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

		it('clears irisStages when assistant AddMessage arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 1, role: 'assistant', content: 'Response', timestamp: Date.now() },
			});

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toEqual([]);
			});
		});

		it('does not clear irisStages when user AddMessage arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 1, role: 'user', content: 'Question', timestamp: Date.now() },
			});

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toHaveLength(1);
			});
		});

		it('clears irisStages when LoadMessages arrives', async () => {
			useChatStore.setState({ activeSessionId: 'local-test' });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-test',
				artemisSessionId: 42,
				messages: [{ id: 1, role: 'user', content: 'Loaded', timestamp: Date.now(), helpful: null }],
			});

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toEqual([]);
			});
		});

		it('clears irisStages when ClearChatMessages arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'clearChatMessages' });

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toEqual([]);
			});
		});

		it('clears irisStages when UpdateWebSocketStatus reports a non-connected state', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'updateWebSocketStatus', status: 'disconnected' });

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toEqual([]);
			});
		});

		it('does not clear irisStages when UpdateWebSocketStatus reports connected', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({ type: 'updateWebSocketStatus', status: 'connected' });

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toHaveLength(1);
			});
		});

		it('clears irisStages when user sends a message', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await userEvent.type(textarea, 'Hello{Enter}');

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toEqual([]);
			});
		});

		it('sets irisStages when UpdateIrisStages arrives', async () => {
			useChatStore.setState({ irisStages: [] });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'updateIrisStages',
				stages: [{ name: 'analyzing', state: 'IN_PROGRESS', message: 'Analyzing', weight: 20 }],
			});

			await waitFor(() => {
				expect(useChatStore.getState().irisStages).toHaveLength(1);
				expect(useChatStore.getState().irisStages[0].name).toBe('analyzing');
			});
		});
	});

	describe('RemoveMessage routing (stale-row suppression, C4)', () => {
		it('removes a previously-added message row when RemoveMessage arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Add a message via the extension wire.
			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 77, role: 'assistant', content: 'Proactive hint', timestamp: Date.now() },
			});

			await waitFor(() => {
				expect(screen.getByText('Proactive hint')).toBeInTheDocument();
			});

			// The host now drops the stale control frame and posts RemoveMessage.
			dispatchExtensionMessage({ type: 'removeMessage', id: 77 });

			await waitFor(() => {
				expect(useChatStore.getState().messages.find((m) => m.id === 77)).toBeUndefined();
			});
		});

		it('suppresses a subsequent AddMessage with the same id after RemoveMessage (suppressedIds)', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Add, then remove message id 88.
			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 88, role: 'assistant', content: 'Will be removed', timestamp: Date.now() },
			});
			await waitFor(() => {
				expect(useChatStore.getState().messages.find((m) => m.id === 88)).toBeDefined();
			});

			dispatchExtensionMessage({ type: 'removeMessage', id: 88 });
			await waitFor(() => {
				expect(useChatStore.getState().messages.find((m) => m.id === 88)).toBeUndefined();
			});

			// A late-arriving chat-ws row with the same id must NOT be reinserted.
			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 88, role: 'assistant', content: 'Re-inserted (should NOT happen)', timestamp: Date.now() },
			});

			// Store must still have no row with id 88.
			expect(useChatStore.getState().messages.find((m) => m.id === 88)).toBeUndefined();
		});
	});

	describe('AddStaleAsk routing and stale-ask UI (C6)', () => {
		it('attachStaleAsk is called when AddStaleAsk message arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addStaleAsk',
				episodeId: 'ep-1',
				askId: 'ask-abc',
				messageId: 77,
				question: 'Are you still stuck?',
			});

			await waitFor(() => {
				expect(useChatStore.getState().staleAskBindings.get(77)).toEqual({
					askId: 'ask-abc',
					question: 'Are you still stuck?',
				});
			});
		});

		it('StaleAskButtons render on the row whose id matches the binding', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Message arrives first.
			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 77, role: 'assistant', origin: 'proactive', content: 'I can help!', timestamp: Date.now() },
			});
			await waitFor(() => expect(screen.getByText('I can help!')).toBeInTheDocument());

			// Binding arrives after.
			dispatchExtensionMessage({
				type: 'addStaleAsk',
				episodeId: 'ep-1',
				askId: 'ask-abc',
				messageId: 77,
				question: 'Are you still stuck?',
			});

			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Got it, solved!' })).toBeInTheDocument();
				expect(screen.getByRole('button', { name: 'Still working on it' })).toBeInTheDocument();
				expect(screen.getByRole('button', { name: 'Something else' })).toBeInTheDocument();
			});
		});

		it('clicking a stale-ask button posts staleAskButton command with the correct askId', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 88, role: 'assistant', origin: 'proactive', content: 'Need help?', timestamp: Date.now() },
			});
			dispatchExtensionMessage({
				type: 'addStaleAsk',
				episodeId: 'ep-2',
				askId: 'ask-xyz',
				messageId: 88,
				question: 'Are you stuck?',
			});

			await waitFor(() =>
				expect(screen.getByRole('button', { name: 'Got it, solved!' })).toBeInTheDocument()
			);

			await userEvent.click(screen.getByRole('button', { name: 'Got it, solved!' }));

			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'staleAskButton',
					payload: { askId: 'ask-xyz', button: 'solved' },
				}),
			);
		});

		it('binding before row: StaleAskButtons render once the message row arrives', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Binding arrives BEFORE the row.
			dispatchExtensionMessage({
				type: 'addStaleAsk',
				episodeId: 'ep-3',
				askId: 'ask-early',
				messageId: 99,
				question: 'Still need help?',
			});

			// Row arrives after.
			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 99, role: 'assistant', origin: 'proactive', content: 'Late row', timestamp: Date.now() },
			});

			await waitFor(() => {
				expect(screen.getByText('Late row')).toBeInTheDocument();
				expect(screen.getByRole('button', { name: 'Got it, solved!' })).toBeInTheDocument();
			});
		});

		it('a stale-ask row WITHOUT a live binding (simulating reload) renders no quick-reply buttons', async () => {
			// On reload staleAskBindings is empty; the row has no staleAsk flag (not in payload).
			useChatStore.setState({
				messages: [
					{
						localId: 'loaded-1',
						id: 55,
						role: 'assistant',
						origin: 'proactive',
						content: 'Persisted stale-ask',
						timestamp: Date.now(),
						status: 'sent',
					},
				],
				messageLoad: { localSessionId: 'local-test', status: 'success' },
				activeSessionId: 'local-test',
				sessions: [{ id: 'local-test', artemisSessionId: 1, preview: '', title: '', messageCount: 1, createdAt: 0, lastActivity: 0 }],
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				// staleAskBindings is empty (default from beforeEach reset)
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await waitFor(() => expect(screen.getByText('Persisted stale-ask')).toBeInTheDocument());
			expect(screen.queryByRole('button', { name: 'Got it, solved!' })).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Still working on it' })).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Something else' })).not.toBeInTheDocument();
		});

		it('Dismiss does NOT render on a stale-ask proactive row', async () => {
			const mockApi = createMockVsCodeApi();
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				...HYDRATED,
			});
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addMessage',
				message: { id: 33, role: 'assistant', origin: 'proactive', content: 'Stale ask hint', timestamp: Date.now() },
			});
			dispatchExtensionMessage({
				type: 'addStaleAsk',
				episodeId: 'ep-sa',
				askId: 'ask-sa',
				messageId: 33,
				question: 'Question?',
			});

			await waitFor(() => expect(screen.getByText('Stale ask hint')).toBeInTheDocument());
			// The stale-ask row has staleAsk: true, so Dismiss must NOT appear.
			expect(screen.queryByRole('button', { name: 'Dismiss this suggestion' })).not.toBeInTheDocument();
		});
	});

	describe('proactiveEpisodeId passthrough (C4)', () => {
		it('AddMessage with proactiveEpisodeId stores it on the resulting row', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'addMessage',
				message: {
					id: 55,
					role: 'assistant',
					content: 'Episode-tagged message',
					timestamp: Date.now(),
					proactiveEpisodeId: 'ep-abc-123',
				},
			});

			await waitFor(() => {
				const row = useChatStore.getState().messages.find((m) => m.id === 55);
				expect(row).toBeDefined();
				expect(row?.proactiveEpisodeId).toBe('ep-abc-123');
			});
		});

		it('LoadMessages with proactiveEpisodeId stores it on the resulting rows', async () => {
			useChatStore.setState({ activeSessionId: 'local-test' });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-test',
				artemisSessionId: 42,
				messages: [
					{
						id: 10,
						role: 'assistant',
						content: 'Loaded proactive',
						timestamp: Date.now(),
						helpful: null,
						proactiveEpisodeId: 'ep-xyz-789',
					},
				],
			});

			await waitFor(() => {
				const row = useChatStore.getState().messages.find((m) => m.id === 10);
				expect(row).toBeDefined();
				expect(row?.proactiveEpisodeId).toBe('ep-xyz-789');
			});
		});
	});

	describe('C7: FoldEpisode closing UX', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('foldEpisode no-praise: immediate fold with client-derived label', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Live message via addMessage (adds to liveEpisodeIds)
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: {
						id: 10,
						role: 'assistant',
						origin: 'proactive',
						proactiveEpisodeId: 'ep-1',
						content: 'Use a different index here please',
						timestamp: Date.now(),
					},
				});
			});

			// No praise: should fold immediately
			await act(async () => {
				dispatchExtensionMessage({ type: 'foldEpisode', episodeId: 'ep-1' });
			});

			// foldStates should have folded: true immediately (no timer)
			expect(useChatStore.getState().foldStates.get('ep-1')?.folded).toBe(true);

			// Fold line button renders with first 40 chars of content (no praise prefix)
			const foldBtn = screen.getByRole('button', { name: /Use a different index here please/i });
			expect(foldBtn).toBeInTheDocument();
			expect(foldBtn.textContent).not.toMatch(/^\s*✓/);
		});

		it('foldEpisode with praise (order A: close row present) folds after 5 s timer', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Two live messages arrive (ep-1 episode)
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 10, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-1', content: 'Hint one', timestamp: Date.now() },
				});
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 11, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-1', content: 'Wrong index here', timestamp: Date.now() },
				});
			});

			// Close row (id=11) is already present; now foldEpisode arrives with praise
			await act(async () => {
				dispatchExtensionMessage({
					type: 'foldEpisode',
					episodeId: 'ep-1',
					praise: { episodeLabel: 'Wrong index', closeMessageId: 11 },
				});
			});

			// Not yet folded (timer pending)
			expect(useChatStore.getState().foldStates.get('ep-1')?.folded).toBe(false);
			expect(screen.queryByRole('button', { name: /✓ Wrong index/i })).not.toBeInTheDocument();

			// Advance 5 s
			act(() => { vi.advanceTimersByTime(5000); });

			// Now folded; praise fold line renders
			expect(useChatStore.getState().foldStates.get('ep-1')?.folded).toBe(true);
			expect(screen.getByRole('button', { name: /✓ Wrong index/i })).toBeInTheDocument();
		});

		it('foldEpisode with praise (order B: control arrives before close row) waits for row, then folds after 5 s', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// First live message
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 10, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-2', content: 'First hint', timestamp: Date.now() },
				});
			});

			// foldEpisode arrives with praise BEFORE the close row (id=20) lands
			await act(async () => {
				dispatchExtensionMessage({
					type: 'foldEpisode',
					episodeId: 'ep-2',
					praise: { episodeLabel: 'Wrong index', closeMessageId: 20 },
				});
			});

			// Timer must NOT have started yet (close row absent)
			expect(useChatStore.getState().foldStates.get('ep-2')?.folded).toBe(false);

			// Order-safety invariant: advance the full 5 s while close row is still absent.
			// A buggy implementation that ignores the guard would fire the timer here and
			// flip folded to true; the correct implementation must keep folded=false.
			act(() => { vi.advanceTimersByTime(5000); });
			expect(useChatStore.getState().foldStates.get('ep-2')?.folded).toBe(false);
			expect(screen.queryByRole('button', { name: /✓ Wrong index/i })).not.toBeInTheDocument();

			// Close row arrives
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 20, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-2', content: 'Progress confirmed', timestamp: Date.now() },
				});
			});

			// Still not folded (5 s delay)
			expect(useChatStore.getState().foldStates.get('ep-2')?.folded).toBe(false);

			// Advance 5 s
			act(() => { vi.advanceTimersByTime(5000); });

			// Now folded with praise label
			expect(useChatStore.getState().foldStates.get('ep-2')?.folded).toBe(true);
			expect(screen.getByRole('button', { name: /✓ Wrong index/i })).toBeInTheDocument();
		});

		it('episode on reload (no foldEpisode received) folds automatically with client-derived label', () => {
			// Bypasses addMessage: liveEpisodeIds stays empty
			useChatStore.setState({
				messages: [
					{
						id: 10,
						localId: 'l1',
						role: 'assistant',
						origin: 'proactive',
						proactiveEpisodeId: 'ep-reload',
						content: 'Hint for a bug',
						timestamp: 0,
						status: 'sent',
					},
				],
				messageLoad: { localSessionId: 'local-test', status: 'success' },
				activeSessionId: 'local-test',
				sessions: [{ id: 'local-test', artemisSessionId: 1, preview: '', title: '', messageCount: 1, createdAt: 0, lastActivity: 0 }],
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Not in liveEpisodeIds => auto-fold with client label
			const foldBtn = screen.getByRole('button', { name: /Hint for a bug/i });
			expect(foldBtn).toBeInTheDocument();
			expect(foldBtn.textContent).not.toMatch(/^\s*✓/);
		});

		it('earlier member of episode group renders no Dismiss button', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				activeSessionId: 'local-test',
				sessions: [{ id: 'local-test', artemisSessionId: 1, preview: '', title: '', messageCount: 0, createdAt: 0, lastActivity: 0 }],
				messageLoad: { localSessionId: 'local-test', status: 'success' },
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Two messages in same episode (live, via addMessage)
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 10, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-g', content: 'Earlier hint', timestamp: Date.now() },
				});
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 11, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-g', content: 'Latest hint', timestamp: Date.now() },
				});
			});

			// Expand the toggle to see earlier messages
			const toggle = screen.getByRole('button', { name: /show 1 earlier suggestion/i });
			await act(async () => {
				toggle.click();
			});

			// Earlier hint visible
			expect(screen.getByText('Earlier hint')).toBeInTheDocument();

			// Exactly one Dismiss button in the entire view
			const allDismissButtons = screen.queryAllByRole('button', { name: 'Dismiss this suggestion' });
			expect(allDismissButtons.length).toBe(1);

			// The single Dismiss button is scoped to the Latest hint bubble, not the Earlier hint bubble.
			// data-origin="proactive" is the attribute on the bubble div inside MessageBubble.
			const earlierBubble = screen.getByText('Earlier hint').closest('[data-origin="proactive"]') as HTMLElement | null;
			const latestBubble = screen.getByText('Latest hint').closest('[data-origin="proactive"]') as HTMLElement | null;
			expect(earlierBubble).not.toBeNull();
			expect(latestBubble).not.toBeNull();
			expect(within(earlierBubble!).queryByRole('button', { name: 'Dismiss this suggestion' })).not.toBeInTheDocument();
			expect(within(latestBubble!).getByRole('button', { name: 'Dismiss this suggestion' })).toBeInTheDocument();

			expect(useChatStore.getState().liveEpisodeIds.has('ep-g')).toBe(true);
		});

		it('closing row (latest is close row) renders no Dismiss button', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				activeSessionId: 'local-test',
				sessions: [{ id: 'local-test', artemisSessionId: 1, preview: '', title: '', messageCount: 0, createdAt: 0, lastActivity: 0 }],
				messageLoad: { localSessionId: 'local-test', status: 'success' },
				// Pre-set foldState with closeMessageId pointing to message 11
				foldStates: new Map([['ep-close', { folded: false, episodeLabel: 'Good job', closeMessageId: 11 }]]),
				liveEpisodeIds: new Set(['ep-close']),
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Single-message episode (only the close row)
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 11, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-close', content: 'Great progress!', timestamp: Date.now() },
				});
			});

			expect(screen.getByText('Great progress!')).toBeInTheDocument();
			// The close row is the latest but isClosingRow=true, so canDismiss=false
			expect(screen.queryByRole('button', { name: 'Dismiss this suggestion' })).not.toBeInTheDocument();
		});

		it('fold timer is cancelled when the component unmounts (cleanup guard)', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				...HYDRATED,
			});
			const mockApi = createMockVsCodeApi();
			const { unmount } = render(<IrisChatView vscodeApi={mockApi} />);

			// First live message
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 10, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-unmount', content: 'Hint', timestamp: Date.now() },
				});
			});

			// Close row arrives (id=20, matching closeMessageId below)
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 20, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-unmount', content: 'Progress confirmed', timestamp: Date.now() },
				});
			});

			// foldEpisode with praise: close row IS present, so the 5 s timer starts
			await act(async () => {
				dispatchExtensionMessage({
					type: 'foldEpisode',
					episodeId: 'ep-unmount',
					praise: { episodeLabel: 'Fixed it', closeMessageId: 20 },
				});
			});

			// Timer is pending; episode not yet folded
			expect(useChatStore.getState().foldStates.get('ep-unmount')?.folded).toBe(false);

			// Unmount BEFORE the 5 s deadline (cleanup effect must cancel the timer)
			unmount();

			// Advance past the deadline; the cancelled timer must not fire
			act(() => { vi.advanceTimersByTime(5000); });

			// Fold must NOT have happened (a missing cleanup would flip this to true)
			expect(useChatStore.getState().foldStates.get('ep-unmount')?.folded).toBe(false);
		});

		it('live latest hint card (not closing row) renders Dismiss button', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				activeSessionId: 'local-test',
				sessions: [{ id: 'local-test', artemisSessionId: 1, preview: '', title: '', messageCount: 0, createdAt: 0, lastActivity: 0 }],
				messageLoad: { localSessionId: 'local-test', status: 'success' },
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 42, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-live', content: 'Try a helper method', timestamp: Date.now() },
				});
			});

			expect(screen.getByText('Try a helper method')).toBeInTheDocument();
			// Latest live hint with no closeMessageId => canDismiss=true => Dismiss renders
			expect(screen.getByRole('button', { name: 'Dismiss this suggestion' })).toBeInTheDocument();
		});

		it('regression C6: stale-ask row still hides Dismiss regardless of isLatest', async () => {
			useChatStore.setState({
				context: { type: 'exercise', id: 1, title: 'Ex', locked: false, source: 'user-selected' },
				activeSessionId: 'local-test',
				sessions: [{ id: 'local-test', artemisSessionId: 1, preview: '', title: '', messageCount: 0, createdAt: 0, lastActivity: 0 }],
				messageLoad: { localSessionId: 'local-test', status: 'success' },
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Row arrives then stale-ask binding is attached
			await act(async () => {
				dispatchExtensionMessage({
					type: 'addMessage',
					message: { id: 77, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-sa', content: 'Stale ask hint', timestamp: Date.now() },
				});
				dispatchExtensionMessage({
					type: 'addStaleAsk',
					episodeId: 'ep-sa',
					askId: 'ask-sa',
					messageId: 77,
					question: 'Are you stuck?',
				});
			});

			// act() flushed all React updates; query directly (waitFor hangs under fake timers)
			expect(screen.getByText('Stale ask hint')).toBeInTheDocument();
			// staleAsk=true on row => MessageBubble hides Dismiss regardless of isLatest
			expect(screen.queryByRole('button', { name: 'Dismiss this suggestion' })).not.toBeInTheDocument();
		});
	});
});
