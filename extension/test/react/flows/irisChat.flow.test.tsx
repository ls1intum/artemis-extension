import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';
import { IrisChatView } from '@webview/views/IrisChat/IrisChatView';

import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';

/**
 * Iris chat flow integration tests.
 *
 * Tests the full chat lifecycle: context selection -> type message -> send ->
 * streaming response simulation -> final message with code blocks.
 * Also covers conversation history, referenced files, and streaming interruption.
 *
 * Streaming simulation uses vi.useFakeTimers() + advanceTimersByTimeAsync().
 * Store-based streaming actions (startStreaming/appendStreamChunk/finishStreaming)
 * are called directly since chatStreamChunk messages come from the WebSocket bridge
 * (not window messages) in the production flow.
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
			streaming: { isStreaming: false, messageLocalId: null, visibleChunks: [] },
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

	describe('Streaming response simulation', () => {
		it('shows streaming indicator when streaming is active', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Simulate streaming starting via store action
			act(() => {
				useChatStore.getState().startStreaming('response-local-id');
			});

			// Streaming state should be active in store
			await waitFor(() => {
				const state = useChatStore.getState();
				expect(state.streaming.isStreaming).toBe(true);
			});
		});

		it('completes full chat flow with streaming simulation', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Step 1: Send a message via store action (simulating what handleSendMessage does)
			// This avoids fake timers + userEvent deadlock issues
			act(() => {
				const localId = 'user-msg-1';
				useChatStore.getState().addMessage({
					localId,
					role: 'user',
					content: 'How do I implement binary search?',
					timestamp: Date.now(),
					status: 'sending',
				});
				// sendCommand is called internally by handleSendMessage, we verify postMessage separately
			});

			// Step 2: Verify user message appears
			await waitFor(() => {
				expect(screen.getByText('How do I implement binary search?')).toBeInTheDocument();
			});

			// Step 3: Simulate streaming start
			act(() => {
				const responseLocalId = 'response-msg-1';
				useChatStore.getState().addMessage({
					localId: responseLocalId,
					role: 'assistant',
					content: '',
					timestamp: Date.now(),
					status: 'sending',
				});
				useChatStore.getState().startStreaming(responseLocalId);
			});

			// Verify streaming state is active
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);

			// Step 4: Simulate streaming chunks with fake timer delays
			vi.useFakeTimers();

			act(() => {
				useChatStore.getState().appendStreamChunk('Binary search works by ');
			});
			await vi.advanceTimersByTimeAsync(50);

			act(() => {
				useChatStore.getState().appendStreamChunk('dividing the search space in half.');
			});
			await vi.advanceTimersByTimeAsync(50);

			// Step 5: Finalize stream
			const finalContent = 'Binary search works by dividing the search space in half.\n\n```java\nint mid = (lo + hi) / 2;\n```';
			act(() => {
				useChatStore.getState().finishStreaming(finalContent);
			});

			vi.useRealTimers();

			// Step 6: Verify streaming is complete
			const storeState = useChatStore.getState();
			expect(storeState.streaming.isStreaming).toBe(false);

			// Step 7: Verify final message content in store
			const assistantMessage = storeState.messages.find((m) => m.role === 'assistant');
			expect(assistantMessage).toBeTruthy();
			expect(assistantMessage?.content).toBe(finalContent);
		});

		it('accumulates stream chunks correctly in store', () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });

			const localId = 'stream-test-id';
			act(() => {
				useChatStore.getState().addMessage({
					localId,
					role: 'assistant',
					content: '',
					timestamp: Date.now(),
					status: 'sending',
				});
				useChatStore.getState().startStreaming(localId);
			});

			act(() => {
				useChatStore.getState().appendStreamChunk('Hello ');
				useChatStore.getState().appendStreamChunk('world!');
			});

			const state = useChatStore.getState();
			expect(state.streaming.visibleChunks).toEqual(['Hello ', 'world!']);
			expect(state.streaming.isStreaming).toBe(true);

			act(() => {
				useChatStore.getState().finishStreaming('Hello world!');
			});

			const finalState = useChatStore.getState();
			expect(finalState.streaming.isStreaming).toBe(false);
			expect(finalState.streaming.visibleChunks).toHaveLength(0);

			const msg = finalState.messages.find((m) => m.localId === localId);
			expect(msg?.content).toBe('Hello world!');
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
