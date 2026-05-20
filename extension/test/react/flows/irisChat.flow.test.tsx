import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';
import { IrisChatView } from '@webview/views/IrisChat/IrisChatView';

import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';

/**
 * Iris chat flow integration tests.
 *
 * Tests the chat lifecycle: context selection -> type message -> send ->
 * thinking indicator -> final assistant message clears transient UI.
 * Also covers conversation history, referenced files, disabled states,
 * websocket banner, and cold-mount hydration.
 *
 * The Artemis Iris WebSocket does NOT chunk-stream to this client; only a
 * single final MESSAGE frame is delivered (see irisWebSocketMessageHandler).
 * These tests therefore exercise the thinking-indicator -> AddMessage path,
 * not a chunk simulation.
 */

// Mock streamdown — ESM-only package
vi.mock('streamdown', () => ({
	Streamdown: ({ children }: { children?: string }) => (
		<span data-testid="streamdown">{children}</span>
	),
}));

// Mock use-stick-to-bottom — ESM package
vi.mock('use-stick-to-bottom', () => ({
	useStickToBottom: vi.fn().mockReturnValue({
		scrollRef: { current: null },
		contentRef: { current: null },
		isAtBottom: true,
		scrollToBottom: vi.fn(),
	}),
}));

// Mock Shiki/CodeBlock to avoid dynamic imports
vi.mock('../../../src/webview/views/IrisChat/components/CodeBlock', () => ({
	CodeBlock: ({ children }: { language?: string; children?: string }) => (
		<pre data-testid="code-block"><code>{children}</code></pre>
	),
}));

const exerciseContext = {
	type: 'exercise' as const,
	id: 1,
	title: 'Binary Search',
	locked: false,
	source: 'user-selected' as const,
};

// Steady-state shape: tests that just want the chat input enabled
// `useChatStore.setState({ context: exerciseContext, ...HYDRATED })`.
// Mirrors the post-load state where a session is active and its
// hydration has completed successfully.
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

describe('Iris Chat Flow', () => {
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
			isLoading: false,
			webSocketStatus: 'connected',
			disabledMessage: null,
			isNoAiDetected: false,
			referencedFiles: null,
			showDiagnostics: false,
			// Default flows assume init has happened. The cold-mount flow
			// test below explicitly opts out to exercise pre-init behavior.
			hasReceivedInitialIrisState: true,
		});
		vi.useRealTimers();
	});

	describe('Context selection', () => {
		it('shows "Select context" when no context is set', () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);
			expect(screen.getByText('Select context')).toBeInTheDocument();
		});

		it('disables chat input when no context is selected', () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);
			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			expect(textarea).toBeDisabled();
		});

		it('enables chat input after context is received from extension', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// INBOUND: simulate context update from extension
			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					context: {
						type: 'exercise',
						id: 1,
						title: 'Binary Search',
						shortName: 'BS',
						locked: false,
						source: 'user-selected',
					},
					activeSessionId: 'session-1',
					sessions: [],
					exercises: [],
					courses: [],
				},
			});
			// And the matching LoadMessages — the real extension always emits
			// one once the session has finished initialising; the input stays
			// disabled until then so the user does not race the hydration.
			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'session-1',
				artemisSessionId: 1,
				messages: [],
			});

			await waitFor(() => {
				const textarea = screen.getByRole('textbox', { name: 'Chat input' });
				expect(textarea).not.toBeDisabled();
			});
		});

		it('sends selectChatContext postMessage when context is selected via context selector', async () => {
			const user = userEvent.setup();

			useChatStore.setState({
				context: null,
				exercises: [
					{ id: 1, title: 'Binary Search', courseId: 10, isWorkspace: false },
				],
			});

			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Click the "Select context" button to open context picker
			const selectContextButton = screen.getByText('Select context');
			await user.click(selectContextButton);

			// Context picker should now be open with exercises listed
			await waitFor(() => {
				expect(screen.getByText('Binary Search')).toBeInTheDocument();
			});

			// Click on the exercise to select it as context
			await user.click(screen.getByText('Binary Search'));

			// OUTBOUND: verify selectChatContext postMessage
			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'selectChatContext',
					payload: expect.objectContaining({
						context: 'exercise',
						itemId: 1,
					}),
				})
			);
		});
	});

	describe('Sending messages', () => {
		it('sends sendMessage postMessage when user submits text', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'How do I implement binary search?{Enter}');

			// OUTBOUND: verify sendMessage postMessage with message text
			await waitFor(() => {
				expect(mockApi.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({
						type: 'command',
						command: 'sendMessage',
						payload: expect.objectContaining({
							text: 'How do I implement binary search?',
						}),
					})
				);
			});
		});

		it('adds optimistic user message to chat list immediately after send', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'Explain quicksort{Enter}');

			// User message appears optimistically before extension response
			await waitFor(() => {
				expect(screen.getByText('Explain quicksort')).toBeInTheDocument();
			});
		});

		it('does not send message when input is empty', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Try to send empty message via Enter
			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.click(textarea);
			await user.keyboard('{Enter}');

			// No sendMessage postMessage should be sent
			const calls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls;
			const sendMessageCalls = calls.filter(
				(call) =>
					typeof call[0] === 'object' &&
					call[0] !== null &&
					(call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendMessageCalls).toHaveLength(0);
		});
	});

	describe('Thinking indicator lifecycle', () => {
		it('startStreaming surfaces the thinking indicator', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			act(() => {
				useChatStore.getState().addMessage({
					localId: 'user-msg-1',
					role: 'user',
					content: 'Question',
					timestamp: Date.now(),
					status: 'sending',
				});
				useChatStore.getState().startStreaming();
			});

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			});
			expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
		});

		it('assistant addMessage clears the transient thinking + stages UI', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Pre-state: thinking indicator on, stages populated (as if STATUS
			// frame had pushed pipeline stages).
			act(() => {
				useChatStore.getState().addMessage({
					localId: 'user-msg-1',
					role: 'user',
					content: 'Question',
					timestamp: Date.now(),
					status: 'sending',
				});
				useChatStore.getState().startStreaming();
				useChatStore.getState().setIrisStages([
					{ name: 'thinking', weight: 10, state: 'IN_PROGRESS', message: 'Thinking', internal: false },
				]);
			});

			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().irisStages).toHaveLength(1);

			// The Artemis MESSAGE frame arrives — extension forwards it as
			// AddMessage. IrisChatView's handler calls resetTransientChatUi
			// for assistant messages.
			dispatchExtensionMessage({
				type: 'addMessage',
				message: {
					id: 99,
					role: 'assistant',
					content: 'Final answer.',
					timestamp: Date.now(),
				},
			});

			await waitFor(() => {
				expect(screen.getByText('Final answer.')).toBeInTheDocument();
			});
			expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			expect(useChatStore.getState().irisStages).toEqual([]);
		});
	});

	describe('Conversation history', () => {
		it('preserves message history across multiple exchanges', async () => {
			// LoadMessages is gated on activeSessionId — set it to match the dispatched payload.
			useChatStore.setState({ activeSessionId: 'local-test' });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Load multiple messages from extension
			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-test',
				artemisSessionId: 42,
				messages: [
					{ id: 1, role: 'user', content: 'First question', timestamp: Date.now() - 2000 },
					{ id: 2, role: 'assistant', content: 'First answer', timestamp: Date.now() - 1500 },
					{ id: 3, role: 'user', content: 'Second question', timestamp: Date.now() - 1000 },
					{ id: 4, role: 'assistant', content: 'Second answer', timestamp: Date.now() - 500 },
				],
			});

			await waitFor(() => {
				expect(screen.getByText('First question')).toBeInTheDocument();
				expect(screen.getByText('First answer')).toBeInTheDocument();
				expect(screen.getByText('Second question')).toBeInTheDocument();
				expect(screen.getByText('Second answer')).toBeInTheDocument();
			});
		});

		it('adds new message to existing conversation via addMessage event', async () => {
			// Pre-populate with existing messages
			useChatStore.setState({
				context: exerciseContext,
				...HYDRATED,
				messages: [
					{
						localId: 'msg-1',
						role: 'user',
						content: 'Prior question',
						timestamp: Date.now() - 1000,
						status: 'sent',
					},
				],
			});

			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Extension pushes a new message
			dispatchExtensionMessage({
				type: 'addMessage',
				message: {
					id: 10,
					role: 'assistant',
					content: 'New response from Iris',
					timestamp: Date.now(),
				},
			});

			await waitFor(() => {
				expect(screen.getByText('Prior question')).toBeInTheDocument();
				expect(screen.getByText('New response from Iris')).toBeInTheDocument();
			});
		});

		it('clears messages on clearChatMessages event', async () => {
			useChatStore.setState({
				context: exerciseContext,
				...HYDRATED,
				messages: [
					{
						localId: 'msg-1',
						role: 'user',
						content: 'Old message',
						timestamp: Date.now() - 1000,
						status: 'sent',
					},
				],
			});

			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await waitFor(() => {
				expect(screen.getByText('Old message')).toBeInTheDocument();
			});

			// Extension clears messages
			dispatchExtensionMessage({ type: 'clearChatMessages' });

			await waitFor(() => {
				expect(screen.queryByText('Old message')).not.toBeInTheDocument();
			});
		});
	});

	describe('Referenced files display', () => {
		it('displays referenced files when updateReferencedFiles event received', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// INBOUND: extension sends referenced files
			dispatchExtensionMessage({
				type: 'updateReferencedFiles',
				includedFiles: ['src/Main.java', 'src/Utils.java'],
				excludedFiles: [],
				totalCount: 2,
			});

			await waitFor(() => {
				const state = useChatStore.getState();
				expect(state.referencedFiles).toBeTruthy();
				expect(state.referencedFiles?.includedFiles).toContain('src/Main.java');
			});
		});
	});

	describe('Chat disabled states', () => {
		it('shows disabled banner when disabledMessage is set via extension message', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'showDisabledState',
				message: 'Iris is not available for this exercise.',
			});

			await waitFor(() => {
				expect(screen.getByText('Iris is not available for this exercise.')).toBeInTheDocument();
			});
		});

		it('removes disabled banner when hideDisabledState is received', async () => {
			useChatStore.setState({ disabledMessage: 'Iris disabled.' });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await waitFor(() => {
				expect(screen.getByText('Iris disabled.')).toBeInTheDocument();
			});

			dispatchExtensionMessage({ type: 'hideDisabledState' });

			await waitFor(() => {
				expect(screen.queryByText('Iris disabled.')).not.toBeInTheDocument();
			});
		});

		it('shows .noai detection banner when updateNoAiStatus is received', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'updateNoAiStatus',
				isNoAiDetected: true,
			});

			await waitFor(() => {
				expect(screen.getByText(/\.noai file was detected/i)).toBeInTheDocument();
			});
		});
	});

	describe('WebSocket connectivity', () => {
		it('shows WebSocket disconnected banner when retries are exhausted', () => {
			useChatStore.setState({ webSocketStatus: 'disconnected' });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);
			expect(screen.getByText('WebSocket disconnected')).toBeInTheDocument();
		});

		it('hides WebSocket banner when connection is restored via updateWebSocketStatus', async () => {
			useChatStore.setState({ webSocketStatus: 'disconnected' });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.getByText('WebSocket disconnected')).toBeInTheDocument();

			dispatchExtensionMessage({
				type: 'updateWebSocketStatus',
				status: 'connected',
			});

			await waitFor(() => {
				expect(screen.queryByText('WebSocket disconnected')).not.toBeInTheDocument();
			});
		});
	});

	describe('Cold-mount hydration flow', () => {
		it('cold mount → snapshot with imported session → LoadMessages: loader then messages, no welcome flash', async () => {
			// Pre-init: nothing rendered yet. Simulate the real cold-start
			// sequence the extension produces: a postSnapshot first (with
			// the imported session UUID), then LoadMessages tagged with
			// the same UUID.
			useChatStore.setState({
				activeSessionId: null,
				messageLoad: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			const { container } = render(<IrisChatView vscodeApi={mockApi} />);

			// Frame 1: loader, never welcome.
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();

			// Snapshot arrives with an imported session.
			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					context: exerciseContext,
					activeSessionId: 'local-imported',
					sessions: [
						{
							id: 'local-imported',
							artemisSessionId: 42,
							preview: 'Question',
							title: '',
							messageCount: 1,
							createdAt: 0,
							lastActivity: 0,
						},
					],
					exercises: [],
					courses: [],
				},
			});

			// Still loader — load has not arrived yet.
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();

			// LoadMessages arrives tagged with the same local UUID.
			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-imported',
				artemisSessionId: 42,
				messages: [
					{ id: 1, role: 'user', content: 'Question', timestamp: 0, helpful: null },
				],
			});

			await waitFor(() => {
				expect(screen.getByText('Question')).toBeInTheDocument();
			});
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
		});

		it('LoadMessages tagged with the wrong UUID before snapshot arrives is rejected', async () => {
			// Reproduces the pre-fix bug: LoadMessages emit beats the snapshot
			// to the webview. Without the extension-side fix, the webview's
			// activeSessionId is null and the localSessionId guard rejects
			// the payload, leaving the chat stuck on the loader.
			useChatStore.setState({
				activeSessionId: null,
				messageLoad: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			const { container } = render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				localSessionId: 'local-imported',
				artemisSessionId: 42,
				messages: [
					{ id: 1, role: 'user', content: 'Question', timestamp: 0, helpful: null },
				],
			});

			// Guard rejects: messageLoad still null, no messages, loader stays.
			expect(useChatStore.getState().messageLoad).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
		});
	});
});
