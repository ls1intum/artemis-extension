import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { useChatStore } from '@webview/stores/useChatStore';
import { IrisChatView } from '@webview/views/IrisChat/IrisChatView';

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
vi.mock('@webview/views/IrisChat/components/CodeBlock', () => ({
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
			liveDraft: null,
			activities: [],
			runState: null,
			runError: null,
			lastRunUiRevision: 0,
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

		it('assistant addMessage with a runUi clears the transient draft + waiting UI', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Pre-state: thinking indicator on, a partial draft in flight (as if
			// UpdateIrisRunUi frames had streamed a growing answer).
			act(() => {
				useChatStore.getState().addMessage({
					localId: 'user-msg-1',
					role: 'user',
					content: 'Question',
					timestamp: Date.now(),
					status: 'sending',
				});
				useChatStore.getState().applyRunUi({
					localSessionId: 'local-test', revision: 1,
					draft: { runId: 'A', text: 'partial' },
					activities: [], waiting: true, runState: 'RUNNING',
				}, 'local-test');
			});

			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().liveDraft?.text).toBe('partial');

			// The Artemis MESSAGE frame arrives — extension forwards it as an
			// AddMessage carrying the commit projection, which clears the draft
			// and waiting flag atomically with the committed message.
			dispatchExtensionMessage({
				type: 'addMessage',
				localSessionId: 'local-test',
				runUi: {
					localSessionId: 'local-test', revision: 2, draft: null,
					activities: [], waiting: false, runState: 'FINISHED',
				},
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
			expect(useChatStore.getState().liveDraft).toBeNull();
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

			// Extension pushes a new message. localSessionId must match the
			// active session or applyCommit drops it.
			dispatchExtensionMessage({
				type: 'addMessage',
				localSessionId: 'local-test',
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

	describe('Send rejection lifecycle (#178)', () => {
		it('SendRejected marks the optimistic message failed, clears thinking, preserves original text', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'How do I solve task 2?{Enter}');

			// Capture the localId the webview generated so the simulated
			// host can echo it back.
			const sendCall = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendCall).toBeDefined();
			const payload = (sendCall![0] as { payload: { localId: string; localSessionId: string } }).payload;

			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();

			// Host posts SendRejected.
			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: payload.localId,
				localSessionId: payload.localSessionId,
				reason: 'no-context',
				errorMessage: 'Please select a course or exercise context first.',
			});

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			});

			// Original user text still visible.
			expect(screen.getByText('How do I solve task 2?')).toBeInTheDocument();
			// Error footer rendered.
			expect(screen.getByText('Not sent')).toBeInTheDocument();
			expect(
				screen.getByText('Please select a course or exercise context first.')
			).toBeInTheDocument();
			// Message marked error in store.
			const updated = useChatStore.getState().messages.find((m) => m.localId === payload.localId);
			expect(updated?.status).toBe('error');
			expect(updated?.errorReason).toBe('no-context');
		});

		it('stale SendRejected after session switch is ignored (no transient UI changes)', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'Old session question{Enter}');

			const sendCall = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			const oldLocalSessionId = (sendCall![0] as { payload: { localSessionId: string } }).payload.localSessionId;
			const oldLocalId = (sendCall![0] as { payload: { localId: string } }).payload.localId;

			// User switches session before the rejection arrives.
			act(() => {
				useChatStore.setState({ activeSessionId: 'different-session' });
			});

			// Stale rejection arrives — must be ignored. Without the
			// localSessionId guard, this would clear the next session's
			// transient UI by accident.
			act(() => {
				useChatStore.getState().startStreaming(); // simulate new session has a pending send
			});

			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: oldLocalId,
				localSessionId: oldLocalSessionId,
				reason: 'no-context',
				errorMessage: 'Please select a course or exercise context first.',
			});

			// New session's streaming flag is untouched.
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
		});

		it('Retry on a failed message removes it and resends with a fresh localId', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Seed a failed user message directly.
			act(() => {
				useChatStore.setState({
					messages: [{
						localId: 'failed-1',
						role: 'user',
						content: 'Retry me',
						timestamp: Date.now(),
						status: 'error',
						errorMessage: 'Please select a course or exercise context first.',
						errorReason: 'no-context',
					}],
				});
			});

			const retry = screen.getByRole('button', { name: 'Retry sending this message' });
			await user.click(retry);

			// Failed entry removed.
			expect(useChatStore.getState().messages.find((m) => m.localId === 'failed-1')).toBeUndefined();
			// New optimistic message present with same content but different localId.
			const fresh = useChatStore.getState().messages.find((m) => m.content === 'Retry me');
			expect(fresh).toBeDefined();
			expect(fresh!.localId).not.toBe('failed-1');
			expect(fresh!.status).toBe('sending');

			// sendMessage posted with the fresh localId.
			const sendCalls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendCalls).toHaveLength(1);
			const lastPayload = (sendCalls[0][0] as { payload: { localId: string; text: string } }).payload;
			expect(lastPayload.text).toBe('Retry me');
			expect(lastPayload.localId).toBe(fresh!.localId);
		});

		it('ChatInput is disabled while a send is in flight', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'First send{Enter}');

			// Streaming flips on synchronously inside handleSendMessage.
			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			});
			expect(textarea).toBeDisabled();
		});

		it('attempting a second send while one is in flight does not fire a second sendMessage', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'First{Enter}');

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			});

			// Typing into the disabled textarea is a no-op; an Enter press
			// while disabled cannot reach handleSendMessage either. Verify
			// that the only sendMessage command posted is the first one.
			await user.click(textarea);
			await user.keyboard('Second{Enter}');

			const sendCalls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendCalls).toHaveLength(1);
			const payload = (sendCalls[0][0] as { payload: { text: string } }).payload;
			expect(payload.text).toBe('First');
		});

		it('retry of a retried message also produces a fresh localId and clears thinking on re-rejection', async () => {
			useChatStore.setState({ context: exerciseContext, ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// First send.
			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'Persistent question{Enter}');

			const sendCall1 = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			const payload1 = (sendCall1![0] as { payload: { localId: string; localSessionId: string } }).payload;

			// First rejection.
			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: payload1.localId,
				localSessionId: payload1.localSessionId,
				reason: 'no-context',
				errorMessage: 'Please select a course or exercise context first.',
			});
			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			});

			// First retry: Retry button is currently disabled (context held —
			// see other test) so simulate a context where retry is enabled.
			// Use a reason that allows retry without state change: temporarily
			// override errorReason to a value the current canRetry permits.
			act(() => {
				useChatStore.setState({
					messages: useChatStore.getState().messages.map((m) =>
						m.localId === payload1.localId
							? { ...m, errorReason: undefined } // unrecognized reason → retry enabled
							: m,
					),
				});
			});

			await user.click(screen.getByRole('button', { name: 'Retry sending this message' }));

			// A second sendMessage call should have fired with a different localId.
			const sendCalls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendCalls).toHaveLength(2);
			const payload2 = (sendCalls[1][0] as { payload: { localId: string; localSessionId: string } }).payload;
			expect(payload2.localId).not.toBe(payload1.localId);

			// Second rejection on the retried message.
			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: payload2.localId,
				localSessionId: payload2.localSessionId,
				reason: 'no-context',
				errorMessage: 'Please select a course or exercise context first.',
			});

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			});
			// The retried message is itself now marked failed.
			const retried = useChatStore.getState().messages.find((m) => m.localId === payload2.localId);
			expect(retried?.status).toBe('error');
		});

		it('Retry button is disabled when the rejection reason still holds (no-context)', async () => {
			// Context cleared but the failed message still references no-context.
			useChatStore.setState({
				context: null,
				...HYDRATED,
				messages: [{
					localId: 'stuck-1',
					role: 'user',
					content: 'Still no context',
					timestamp: Date.now(),
					status: 'error',
					errorMessage: 'Please select a course or exercise context first.',
					errorReason: 'no-context',
				}],
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const retry = screen.getByRole('button', { name: 'Retry sending this message' });
			expect(retry).toBeDisabled();
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
			render(<IrisChatView vscodeApi={mockApi} />);

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
			render(<IrisChatView vscodeApi={mockApi} />);

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
