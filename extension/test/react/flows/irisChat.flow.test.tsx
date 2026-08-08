import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
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

/** The conversation these flows run in. */
const OPEN = 900;

// Steady-state shape: tests that just want the chat input enabled do
// `useChatStore.setState({ ...HYDRATED })`. Mirrors the post-load state where
// a conversation is open and its transcript has arrived.
const HYDRATED = {
	courseId: 10,
	courseTitle: 'Algorithms',
	currentSessionId: OPEN,
	loadedSessionId: OPEN,
	contentState: 'content' as const,
};

describe('Iris Chat Flow', () => {
	beforeEach(() => {
		useChatStore.setState({
			courseId: null,
			courseTitle: null,
			currentSessionId: null,
			conversationTitle: null,
			workspaceExerciseId: null,
			// 'settled': these flows are about the ordinary steady state, not
			// about workspace detection's own progress.
			detectionState: 'settled',
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
			isNoAiDetected: false,
			referencedFiles: null,
			showDiagnostics: false,
			sendInFlight: false,
			navigationInFlight: false,
			composerText: '',
			unavailableMessage: null,
			// Default flows assume init has happened. The cold-mount flow
			// test below explicitly opts out to exercise pre-init behavior.
			hasReceivedInitialIrisState: true,
		});
		vi.useRealTimers();
	});

	describe('Cold start', () => {
		it('offers the course list when nothing is open', () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);
			expect(screen.getByText(/No Artemis workspace detected/)).toBeInTheDocument();
		});

		it('enables chat input once a conversation and its transcript arrive', async () => {
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// INBOUND: the conversation the host opened.
			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					exercises: [],
					courses: [{ id: 10, title: 'Algorithms' }],
					courseId: 10,
					courseTitle: 'Algorithms',
					currentSessionId: OPEN,
					conversationTitle: 'Binary Search',
					displayMessageCount: 0,
					committedContext: undefined,
					pendingContext: undefined,
					contentState: 'empty',
					sendInFlight: false,
					navigationInFlight: false,
					conversations: [],
					workspaceExerciseId: undefined,
				},
			});
			// And the matching transcript. The host always delivers one once
			// the conversation is installed; the input stays disabled until
			// then so the student does not race the hydration.
			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: OPEN,
				messages: [],
			});

			await waitFor(() => {
				const textarea = screen.getByRole('textbox', { name: 'Chat input' });
				expect(textarea).not.toBeDisabled();
			});
		});
	});

	describe('Sending messages', () => {
		it('sends sendMessage postMessage when user submits text', async () => {
			useChatStore.setState({ ...HYDRATED });
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
			useChatStore.setState({ ...HYDRATED });
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
			useChatStore.setState({ ...HYDRATED });
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
			useChatStore.setState({ ...HYDRATED });
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
			useChatStore.setState({ ...HYDRATED });
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
					sessionId: OPEN, revision: 1,
					draft: { runId: 'A', text: 'partial' },
					activities: [], waiting: true, runState: 'RUNNING',
				});
			});

			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().liveDraft?.text).toBe('partial');

			// The Artemis MESSAGE frame arrives — extension forwards it as an
			// AddMessage carrying the commit projection, which clears the draft
			// and waiting flag atomically with the committed message.
			dispatchExtensionMessage({
				type: 'addMessage',
				sessionId: OPEN,
				runUi: {
					sessionId: OPEN, revision: 2, draft: null,
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
			useChatStore.setState({ currentSessionId: OPEN });
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Load multiple messages from extension
			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: OPEN,
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

			// Extension pushes a new message. sessionId must match the
			// active session or applyCommit drops it.
			dispatchExtensionMessage({
				type: 'addMessage',
				sessionId: OPEN,
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

		it('replaces the transcript when another conversation is opened', async () => {
			useChatStore.setState({
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

			// The host delivers the newly opened conversation's transcript.
			dispatchExtensionMessage({ type: 'loadMessages', sessionId: OPEN, messages: [] });

			await waitFor(() => {
				expect(screen.queryByText('Old message')).not.toBeInTheDocument();
			});
		});
	});

	describe('Referenced files display', () => {
		it('displays referenced files when updateReferencedFiles event received', async () => {
			useChatStore.setState({ ...HYDRATED });
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
			useChatStore.setState({ ...HYDRATED });
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
			const payload = (sendCall![0] as { payload: { localId: string; sessionId: number } }).payload;

			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();

			// Host posts SendRejected.
			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: payload.localId,
				sessionId: payload.sessionId,
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
			useChatStore.setState({ ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'Old session question{Enter}');

			const sendCall = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			const oldLocalSessionId: number = (sendCall![0] as { payload: { sessionId: number } }).payload.sessionId;
			const oldLocalId = (sendCall![0] as { payload: { localId: string } }).payload.localId;

			// User switches session before the rejection arrives.
			act(() => {
				useChatStore.setState({ currentSessionId: 901 });
			});

			// Stale rejection arrives — must be ignored. Without the
			// conversation guard, this would clear the next conversation's
			// transient UI by accident.
			act(() => {
				useChatStore.getState().startStreaming(); // simulate new session has a pending send
			});

			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: oldLocalId,
				sessionId: oldLocalSessionId,
				reason: 'no-context',
				errorMessage: 'Please select a course or exercise context first.',
			});

			// New session's streaming flag is untouched.
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
		});

		it('Retry on a failed message removes it and resends with a fresh localId', async () => {
			useChatStore.setState({ ...HYDRATED });
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

		it('keeps the composer usable while a send is in flight', async () => {
			useChatStore.setState({ ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'First send{Enter}');

			// Streaming flips on synchronously inside handleSendMessage.
			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			});

			expect(textarea).toBeEnabled();
			await user.type(textarea, 'Follow-up');
			expect(useChatStore.getState().composerText).toBe('Follow-up');
			expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
			// The invitation to keep writing is the whole point of leaving the
			// textarea enabled, so the wording is part of the contract.
			expect(textarea).toHaveAttribute('placeholder', 'Type your next message…');
		});

		it('attempting a second send while one is in flight does not fire a second sendMessage', async () => {
			useChatStore.setState({ ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'First{Enter}');

			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			});

			// Typing is allowed during a run now, sending is not. The Enter
			// guard in ChatInput plus the funnel guard in handleSendMessage
			// are what keep this to one command.
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
			useChatStore.setState({ ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// First send.
			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'Persistent question{Enter}');

			const sendCall1 = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			const payload1 = (sendCall1![0] as { payload: { localId: string; sessionId: number } }).payload;

			// First rejection.
			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: payload1.localId,
				sessionId: payload1.sessionId,
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
			const payload2 = (sendCalls[1][0] as { payload: { localId: string; sessionId: number } }).payload;
			expect(payload2.localId).not.toBe(payload1.localId);

			// Second rejection on the retried message.
			dispatchExtensionMessage({
				type: 'sendRejected',
				localId: payload2.localId,
				sessionId: payload2.sessionId,
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
				...HYDRATED,
				currentSessionId: null,
				loadedSessionId: null,
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

		it('keeps a draft written during the run once the run ends', async () => {
			useChatStore.setState({ ...HYDRATED });
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const textarea = screen.getByRole('textbox', { name: 'Chat input' });
			await user.type(textarea, 'First send{Enter}');
			await waitFor(() => {
				expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			});

			// Both transitions travel the real wire, so this exercises the
			// view's own message path and not just the local startStreaming
			// that handleSendMessage already did.
			act(() => {
				dispatchExtensionMessage({
					type: 'updateIrisRunUi',
					projection: {
						sessionId: OPEN,
						revision: 1,
						draft: null,
						activities: [],
						waiting: true,
						runState: 'RUNNING',
					},
				});
			});

			await user.type(textarea, 'Follow-up');

			act(() => {
				dispatchExtensionMessage({
					type: 'updateIrisRunUi',
					projection: {
						sessionId: OPEN,
						revision: 2,
						draft: null,
						activities: [],
						waiting: false,
						runState: 'FINISHED',
					},
				});
			});

			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
			});
			expect(textarea).toHaveValue('Follow-up');
		});

		it('keeps sending blocked while the host still holds the lock', async () => {
			// `streaming` starts ON so the FINISHED projection below genuinely
			// turns the run off. Without it the projection would move the run
			// from off to off and the assertion would prove nothing about the
			// lock outliving the run.
			useChatStore.setState({
				...HYDRATED,
				sendInFlight: true,
				streaming: { isStreaming: true },
				composerText: 'Draft',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// The run is over as far as the run UI is concerned...
			act(() => {
				dispatchExtensionMessage({
					type: 'updateIrisRunUi',
					projection: {
						sessionId: OPEN,
						revision: 2,
						draft: null,
						activities: [],
						waiting: false,
						runState: 'FINISHED',
					},
				});
			});
			// ...the run really is off, so only the lock is left to block on...
			expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			// ...but the host has not released its lock yet.
			expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

			act(() => { useChatStore.setState({ sendInFlight: false }); });
			expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
		});

		it('keeps sending blocked when the socket drops mid-send', async () => {
			useChatStore.setState({
				...HYDRATED,
				sendInFlight: true,
				streaming: { isStreaming: true },
				composerText: 'Draft',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// A disconnect resets the run UI, so isStreaming alone would say
			// "go ahead" while the host would still reject.
			act(() => {
				dispatchExtensionMessage({ type: 'updateWebSocketStatus', status: 'disconnected' });
			});

			expect(useChatStore.getState().streaming.isStreaming).toBe(false);
			expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

			act(() => { useChatStore.setState({ sendInFlight: false }); });
			expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
		});

		it('blocks sending during a conversation switch and says so', async () => {
			// The combination the host rejects for NAVIGATION, not for the run.
			useChatStore.setState({
				...HYDRATED,
				navigationInFlight: true,
				sendInFlight: false,
				streaming: { isStreaming: true },
				composerText: 'Draft',
			});
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			await user.type(screen.getByRole('textbox', { name: 'Chat input' }), '{Enter}');

			const sendCalls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendCalls).toHaveLength(0);
			expect(useChatStore.getState().composerText).toBe('Draft');
			expect(screen.getByTitle('The conversation is still loading')).toBeInTheDocument();
		});

		it('refuses a blocked send at the funnel without disturbing anything', () => {
			// The welcome prompts are the shortest path to the funnel: they
			// call handleSendMessage directly (WelcomeState.tsx, via
			// onSendPrompt), with no composer in between. They are now gated
			// like Retry, so the lock has to be taken AFTER the render that
			// drew them live, the same way the Retry race test below reaches
			// its guard. That stale button is the only way into the funnel
			// while the gate is shut, which makes this test the coverage of
			// the funnel guard itself.
			//
			// Only the host lock is set, deliberately. `showWelcome` is
			// `messages.length === 0 && !hasRunSurface` (ChatMessageList.tsx),
			// so seeding `streaming` here would hide the very buttons this
			// test clicks. The lock alone blocks the funnel and keeps them on
			// screen.
			useChatStore.setState({
				...HYDRATED,
				messages: [],
				sendInFlight: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const prompt = screen.getByRole('button', { name: 'Help me debug my code' });
			expect(prompt).toBeEnabled();

			// The missing act() is the POINT, exactly as in the Retry race test
			// below: wrapping it would flush the disabling render, the click
			// would land on an inert button, and this test would keep passing
			// while covering nothing at all. The act() warning is expected.
			useChatStore.setState({ sendInFlight: true });
			expect(prompt).toBeEnabled();

			fireEvent.click(prompt);

			const sendCalls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendCalls).toHaveLength(0);
			// Without the guard, handleSendMessage would have added an
			// optimistic bubble and called startStreaming before the host ever
			// saw the command.
			expect(useChatStore.getState().messages).toHaveLength(0);
			expect(useChatStore.getState().streaming.isStreaming).toBe(false);
		});

		it('makes the welcome prompts inert while a send is in flight', () => {
			useChatStore.setState({
				...HYDRATED,
				messages: [],
				sendInFlight: true,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const prompt = screen.getByRole('button', { name: 'Help me debug my code' });
			expect(prompt).toBeDisabled();
			// The reason travels with the disabling, so a hover explains the
			// dead control instead of leaving the student guessing.
			expect(prompt.parentElement).toHaveAttribute('title', 'Iris is still answering');
		});

		it('keeps the draft when a send click beats the disabling render', () => {
			// The composer's own guard is only as fresh as the last committed
			// render. The host can take the lock in between, and the funnel
			// then refuses from live state. The clear must follow the funnel's
			// answer, not the click: a refusal produces no bubble, so the
			// composer is the only thing left holding the student's text.
			useChatStore.setState({
				...HYDRATED,
				sendInFlight: false,
				navigationInFlight: false,
				streaming: { isStreaming: false },
				composerText: 'Draft',
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const send = screen.getByRole('button', { name: 'Send message' });
			expect(send).toBeEnabled();

			// Deliberately unwrapped, see the Retry race test below.
			useChatStore.setState({ navigationInFlight: true });
			expect(send).toBeEnabled();

			fireEvent.click(send);

			const sendCalls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sendCalls).toHaveLength(0);
			// Clearing regardless of the funnel's answer makes this ''.
			expect(useChatStore.getState().composerText).toBe('Draft');
			expect(screen.getByRole('textbox', { name: 'Chat input' })).toHaveValue('Draft');
		});

		it('makes Retry inert while a send is in flight', async () => {
			useChatStore.setState({
				...HYDRATED,
				sendInFlight: true,
				streaming: { isStreaming: true },
				messages: [{
					localId: 'failed-1',
					role: 'user' as const,
					content: 'Retry me',
					timestamp: Date.now(),
					status: 'error' as const,
					errorMessage: 'Something went wrong',
				}],
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			expect(screen.getByRole('button', { name: /retry/i })).toBeDisabled();
		});

		it('keeps the failed bubble when a Retry click beats the disabling render', () => {
			// Disabling the button narrows the window, it does not close it. The
			// host can take the lock between the render that drew an enabled
			// Retry and the click on it, and `handleRetry` would then remove the
			// bubble and hand a blocked send to the funnel, which refuses it: the
			// student's text is gone and nothing was sent. The guard placed above
			// that removal is the only thing standing between this click and that
			// outcome, so this test is its only coverage.
			useChatStore.setState({
				...HYDRATED,
				sendInFlight: false,
				streaming: { isStreaming: false },
				messages: [{
					localId: 'failed-1',
					role: 'user' as const,
					content: 'Retry me',
					timestamp: Date.now(),
					status: 'error' as const,
					errorMessage: 'Something went wrong',
				}],
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			const retry = screen.getByRole('button', { name: /retry/i });
			expect(retry).toBeEnabled();

			// The host takes the lock. The missing act() is the POINT of this
			// test, not an oversight: wrapping it would flush the re-render, the
			// button would come back disabled, the click would do nothing and
			// this test would silently stop covering anything. Left unwrapped,
			// React has not committed the disabling render yet, so the button in
			// the DOM is still the enabled one the student is looking at. That
			// stale button is the only way to reach `handleRetry` while the gate
			// is shut, which is why the act() warning this line prints is
			// expected. Do not "fix" it.
			useChatStore.setState({ sendInFlight: true });
			expect(retry).toBeEnabled();

			fireEvent.click(retry);

			const sends = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);
			expect(sends).toHaveLength(0);
			// The bubble survived, so the text is still retryable once the lock
			// clears. Without the guard above the removal this is 0.
			expect(useChatStore.getState().messages).toHaveLength(1);
			expect(useChatStore.getState().messages[0].content).toBe('Retry me');
		});

		it('holds a deferred resend until the gate releases, then sends it once', async () => {
			// The lock must NOT be held yet: Retry is inert while it is, so a
			// blocked click could never arm the deferred resend in the first
			// place. The sequence under test is arm first, then get blocked.
			useChatStore.setState({
				...HYDRATED,
				sendInFlight: false,
				unavailableMessage: 'Iris is temporarily unavailable',
				messages: [{
					localId: 'failed-1',
					role: 'user' as const,
					content: 'Retry me',
					timestamp: Date.now(),
					status: 'error' as const,
					errorReason: 'iris-unavailable' as const,
					errorMessage: 'Iris is temporarily unavailable',
				}],
			});
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Arms resendWhenReachable and asks for a reload.
			await user.click(screen.getByRole('button', { name: /retry/i }));

			// The banner clears while the host now holds its lock: the
			// availability refresh runs ahead of the reload that was deferred
			// until the send settles. Both in one update, because that is the
			// render the effect has to survive.
			act(() => {
				useChatStore.setState({ unavailableMessage: null, sendInFlight: true });
			});

			const sends = () => (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);

			// Blocked: nothing sent, and the bubble is still there to retry.
			expect(sends()).toHaveLength(0);
			expect(useChatStore.getState().messages).toHaveLength(1);

			act(() => { useChatStore.setState({ sendInFlight: false }); });

			await waitFor(() => { expect(sends()).toHaveLength(1); });
			expect((sends()[0][0] as { payload: { text: string } }).payload.text).toBe('Retry me');
		});

		/**
		 * A stand-in for "a host snapshot lands between this render
		 * committing and its effect running". React flushes a commit's
		 * passive effects in tree order, and a PRECEDING sibling's own
		 * `useEffect` runs strictly before `IrisChatView`'s. Mounted before
		 * `IrisChatView`, this fires exactly once (guarded by `armed`), right
		 * when `unavailableMessage` turns null, and mutates the store
		 * directly, before the resend effect's own body runs in the SAME
		 * flush.
		 *
		 * That is the only way found, with the tools available here, to make
		 * a render commit with `sendBlocked === false` in its closure while
		 * `useChatStore.getState().sendInFlight` is already `true` by the
		 * time the effect body reads it. Every attempt to produce the same
		 * gap purely through test-level `act()`/`setState` sequencing (two
		 * sequential `act()` calls, raw `setState` outside `act()`, awaiting
		 * across micro- and macrotasks) either collapsed both changes into
		 * one render that saw them together, or let the whole effect
		 * including the resend run to completion before the second change
		 * was even applied. A closure read would have passed either of those
		 * cases too, so they would not have exercised the bug this guards
		 * against.
		 */
		function RaceInjector({ armed }: { armed: { current: boolean } }) {
			const unavailable = useChatStore((s) => s.unavailableMessage);
			useEffect(() => {
				if (armed.current && unavailable === null) {
					armed.current = false;
					useChatStore.setState({ sendInFlight: true });
				}
			});
			return null;
		}

		it('keeps the deferred resend when the lock lands before the effect body runs, not just before its render', async () => {
			const armed = { current: false };
			useChatStore.setState({
				...HYDRATED,
				sendInFlight: false,
				unavailableMessage: 'Iris is temporarily unavailable',
				messages: [{
					localId: 'failed-1',
					role: 'user' as const,
					content: 'Retry me',
					timestamp: Date.now(),
					status: 'error' as const,
					errorReason: 'iris-unavailable' as const,
					errorMessage: 'Iris is temporarily unavailable',
				}],
			});
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<><RaceInjector armed={armed} /><IrisChatView vscodeApi={mockApi} /></>);

			// Arms resendWhenReachable and asks for a reload.
			await user.click(screen.getByRole('button', { name: /retry/i }));

			const sends = () => (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
				(call) => (call[0] as Record<string, unknown>).command === 'sendMessage'
			);

			// The ONLY state change in this act(): unlike the test above,
			// `sendInFlight` is untouched here. RaceInjector flips it to
			// `true` from inside its own effect, part of the SAME
			// passive-effect flush, strictly before the resend effect's body
			// runs, so this render's closure captures `sendBlocked === false`
			// even though the lock is already live by the time that closure
			// is read.
			armed.current = true;
			act(() => {
				useChatStore.setState({ unavailableMessage: null });
			});

			// Blocked: nothing sent, and the bubble is still there to retry.
			// Before the fix this failed right here: the stale closure let
			// the effect through, it removed the bubble, and the funnel's own
			// (already-live) guard then refused the send, losing the text for
			// good.
			expect(sends()).toHaveLength(0);
			expect(useChatStore.getState().messages).toHaveLength(1);
			expect(useChatStore.getState().messages[0].content).toBe('Retry me');

			act(() => { useChatStore.setState({ sendInFlight: false }); });

			await waitFor(() => { expect(sends()).toHaveLength(1); });
			expect((sends()[0][0] as { payload: { text: string } }).payload.text).toBe('Retry me');
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
		it('cold mount → snapshot naming the conversation → transcript: loader then messages, no welcome flash', async () => {
			// Simulate the real cold-start sequence the host produces: a
			// snapshot naming the conversation first, then its transcript.
			useChatStore.setState({
				currentSessionId: null,
				loadedSessionId: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			// Frame 1: loader, never welcome.
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();

			dispatchExtensionMessage({
				type: 'updateIrisState',
				state: {
					exercises: [],
					courses: [],
					courseId: 10,
					courseTitle: 'Algorithms',
					currentSessionId: OPEN,
					conversationTitle: 'Question',
					displayMessageCount: 1,
					committedContext: undefined,
					pendingContext: undefined,
					contentState: 'content',
					sendInFlight: false,
					navigationInFlight: false,
					conversations: [],
					workspaceExerciseId: 1,
				},
			});

			// Still loader: the transcript has not arrived yet.
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();

			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: OPEN,
				messages: [
					{ id: 1, role: 'user', content: 'Question', timestamp: 0, helpful: null },
				],
			});

			await waitFor(() => {
				expect(screen.getByText('Question')).toBeInTheDocument();
			});
			expect(screen.queryByText("Hi! I'm Iris, your AI tutor.")).not.toBeInTheDocument();
		});

		it('a transcript that overtakes the snapshot naming its conversation is rejected', async () => {
			// The host must post the snapshot first. If the transcript wins the
			// race, the webview does not yet know the conversation is open and
			// drops it, leaving the chat on the loader.
			useChatStore.setState({
				currentSessionId: null,
				loadedSessionId: null,
				hasReceivedInitialIrisState: false,
			});
			const mockApi = createMockVsCodeApi();
			render(<IrisChatView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'loadMessages',
				sessionId: OPEN,
				messages: [
					{ id: 1, role: 'user', content: 'Question', timestamp: 0, helpful: null },
				],
			});

			expect(useChatStore.getState().loadedSessionId).toBeNull();
			expect(useChatStore.getState().messages).toEqual([]);
			expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
		});
	});
});
