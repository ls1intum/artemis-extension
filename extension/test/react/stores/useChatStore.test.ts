import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ExtMsg, IrisRunUiProjection } from '@shared/messageContracts';
import type { IrisActivityDTO } from '@shared/types/apiResponses';

import { useChatStore } from '@webview/stores/useChatStore';
import type { ChatMessage, ReferencedFilesData } from '@webview/views/IrisChat/types';

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
	localId: 'local-1',
	role: 'user',
	content: 'Hello, Iris!',
	timestamp: Date.now(),
	...overrides,
});

const makeIrisState = (overrides: Partial<ExtMsg<'updateIrisState'>['state']> = {}): ExtMsg<'updateIrisState'>['state'] => ({
	context: null,
	activeSessionId: null,
	sessions: [],
	exercises: [],
	courses: [],
	...overrides,
});

const makeActivity = (overrides: Partial<IrisActivityDTO> = {}): IrisActivityDTO => ({
	id: 'a1',
	kind: 'TOOL',
	name: 'file_lookup',
	state: 'RUNNING',
	...overrides,
});

describe('useChatStore', () => {
	it('initializes with empty state', () => {
		const { result } = renderHook(() => useChatStore());

		expect(result.current.context).toBeNull();
		expect(result.current.messages).toEqual([]);
		expect(result.current.sessions).toEqual([]);
		expect(result.current.streaming.isStreaming).toBe(false);
		expect(result.current.isLoading).toBe(false);
		expect(result.current.webSocketStatus).toBe('unknown');
		expect(result.current.disabledMessage).toBeNull();
		expect(result.current.unavailableMessage).toBeNull();
		expect(result.current.isNoAiDetected).toBe(false);
		expect(result.current.referencedFiles).toBeNull();
		expect(result.current.showDiagnostics).toBe(false);
		expect(result.current.hasReceivedInitialIrisState).toBe(false);
	});

	it('hasReceivedInitialIrisState flips to true on first setIrisState and stays true after clearMessages', () => {
		const { result } = renderHook(() => useChatStore());

		expect(result.current.hasReceivedInitialIrisState).toBe(false);

		act(() => {
			result.current.setIrisState(makeIrisState());
		});

		expect(result.current.hasReceivedInitialIrisState).toBe(true);

		// clearMessages must not reset the flag — the webview is still
		// considered initialized, just emptied. Resetting would re-trigger
		// the cold-mount skeleton on every session switch.
		act(() => {
			result.current.clearMessages();
		});

		expect(result.current.hasReceivedInitialIrisState).toBe(true);
	});

	it('addMessage appends a message to the messages array', () => {
		const { result } = renderHook(() => useChatStore());
		const message = makeMessage({ localId: 'msg-1', content: 'First message' });

		act(() => {
			result.current.addMessage(message);
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.messages[0].content).toBe('First message');
	});

	it('addMessage accumulates multiple messages in order', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1', role: 'user', content: 'Question' }));
			result.current.addMessage(makeMessage({ localId: 'msg-2', role: 'assistant', content: 'Answer' }));
		});

		expect(result.current.messages).toHaveLength(2);
		expect(result.current.messages[0].role).toBe('user');
		expect(result.current.messages[1].role).toBe('assistant');
	});

	it('clearMessages resets messages to empty array', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1' }));
			result.current.addMessage(makeMessage({ localId: 'msg-2' }));
		});

		act(() => {
			result.current.clearMessages();
		});

		expect(result.current.messages).toEqual([]);
	});

	it('startStreaming sets isStreaming true', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.startStreaming();
		});

		expect(result.current.streaming.isStreaming).toBe(true);
	});

	it('setLoading updates isLoading', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setLoading(true);
		});

		expect(result.current.isLoading).toBe(true);

		act(() => {
			result.current.setLoading(false);
		});

		expect(result.current.isLoading).toBe(false);
	});

	it('setWebSocketStatus updates webSocketStatus', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setWebSocketStatus('connected');
		});

		expect(result.current.webSocketStatus).toBe('connected');
	});

	it('messageLoad starts as null and applyLoadedMessages records success per session', () => {
		const { result } = renderHook(() => useChatStore());

		expect(result.current.messageLoad).toBeNull();

		act(() => {
			result.current.applyLoadedMessages('local-A', [
				{ id: 1, localId: 'a', role: 'user', content: 'Hi', timestamp: 1, helpful: null, status: 'sent' },
			]);
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.messageLoad).toEqual({ localSessionId: 'local-A', status: 'success' });
	});

	it('setMessageLoadError records the failed sessionId without touching messages', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.applyLoadedMessages('local-A', [
				{ id: 1, localId: 'a', role: 'user', content: 'Old', timestamp: 1, helpful: null, status: 'sent' },
			]);
		});
		act(() => {
			result.current.setMessageLoadError('local-A');
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.messageLoad).toEqual({ localSessionId: 'local-A', status: 'error' });
	});

	it('clearMessages also resets messageLoad so the next session shows the skeleton', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.applyLoadedMessages('local-A', [
				{ id: 1, localId: 'a', role: 'user', content: 'Hi', timestamp: 1, helpful: null, status: 'sent' },
			]);
		});
		act(() => {
			result.current.clearMessages();
		});

		expect(result.current.messages).toEqual([]);
		expect(result.current.messageLoad).toBeNull();
	});

	it('setDisabledMessage sets disabled reason', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setDisabledMessage('Iris is not available for this course');
		});

		expect(result.current.disabledMessage).toBe('Iris is not available for this course');
	});

	it('setDisabledMessage can be cleared with null', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setDisabledMessage('Disabled reason');
		});

		act(() => {
			result.current.setDisabledMessage(null);
		});

		expect(result.current.disabledMessage).toBeNull();
	});

	it('setUnavailableMessage sets transient unavailability reason', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setUnavailableMessage('Iris is temporarily unavailable. Retry to reload.');
		});

		expect(result.current.unavailableMessage).toBe('Iris is temporarily unavailable. Retry to reload.');
	});

	it('setUnavailableMessage can be cleared with null', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setUnavailableMessage('Unavailable reason');
		});

		act(() => {
			result.current.setUnavailableMessage(null);
		});

		expect(result.current.unavailableMessage).toBeNull();
	});

	it('setUnavailableMessage clears any existing disabledMessage', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setDisabledMessage('Disabled reason');
		});
		act(() => {
			result.current.setUnavailableMessage('Unavailable reason');
		});

		expect(result.current.unavailableMessage).toBe('Unavailable reason');
		expect(result.current.disabledMessage).toBeNull();
	});

	it('setDisabledMessage clears any existing unavailableMessage', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setUnavailableMessage('Unavailable reason');
		});
		act(() => {
			result.current.setDisabledMessage('Disabled reason');
		});

		expect(result.current.disabledMessage).toBe('Disabled reason');
		expect(result.current.unavailableMessage).toBeNull();
	});

	it('setUnavailableMessage(null) does NOT clear an existing disabledMessage', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setDisabledMessage('Disabled reason');
		});
		act(() => {
			result.current.setUnavailableMessage(null);
		});

		expect(result.current.disabledMessage).toBe('Disabled reason');
		expect(result.current.unavailableMessage).toBeNull();
	});

	it('setDisabledMessage(null) does NOT clear an existing unavailableMessage', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setUnavailableMessage('Unavailable reason');
		});
		act(() => {
			result.current.setDisabledMessage(null);
		});

		expect(result.current.unavailableMessage).toBe('Unavailable reason');
		expect(result.current.disabledMessage).toBeNull();
	});

	it('setNoAiDetected updates isNoAiDetected', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setNoAiDetected(true);
		});

		expect(result.current.isNoAiDetected).toBe(true);
	});

	it('setReferencedFiles sets referenced files data', () => {
		const { result } = renderHook(() => useChatStore());
		const filesData: ReferencedFilesData = {
			includedFiles: ['src/Main.java'],
			excludedFiles: [{ path: 'node_modules/', reason: 'too large' }],
			totalCount: 2,
		};

		act(() => {
			result.current.setReferencedFiles(filesData);
		});

		expect(result.current.referencedFiles).toEqual(filesData);
	});

	it('setReferencedFiles can be cleared with null', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setReferencedFiles({ includedFiles: [], excludedFiles: [], totalCount: 0 });
		});

		act(() => {
			result.current.setReferencedFiles(null);
		});

		expect(result.current.referencedFiles).toBeNull();
	});

	it('setShowDiagnostics toggles diagnostics panel', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setShowDiagnostics(true);
		});

		expect(result.current.showDiagnostics).toBe(true);

		act(() => {
			result.current.setShowDiagnostics(false);
		});

		expect(result.current.showDiagnostics).toBe(false);
	});

	it('setIrisState updates context and session data', () => {
		const { result } = renderHook(() => useChatStore());
		const irisState = makeIrisState({
			context: {
				type: 'exercise',
				id: 42,
				title: 'Sorting Algorithms',
				shortName: 'sort',
				locked: false,
				source: 'workspace-detected',
			},
			activeSessionId: 'session-abc',
			sessions: [
				{
					id: 'session-abc',
					artemisSessionId: 1001,
					preview: 'How do I fix...',
					messageCount: 5,
					createdAt: 1000000,
					lastActivity: 1000100,
				},
			],
			exercises: [{ id: 42, title: 'Sorting Algorithms', courseId: 10 }],
			courses: [{ id: 10, title: 'Algorithms' }],
		});

		act(() => {
			result.current.setIrisState(irisState);
		});

		expect(result.current.activeSessionId).toBe('session-abc');
		expect(result.current.sessions).toHaveLength(1);
		expect(result.current.context?.type).toBe('exercise');
		expect(result.current.context?.id).toBe(42);
		expect(result.current.exercises).toHaveLength(1);
		expect(result.current.courses).toHaveLength(1);
	});

	it('setIrisState passes courseId from context directly', () => {
		const { result } = renderHook(() => useChatStore());
		const irisState = makeIrisState({
			context: {
				type: 'exercise',
				id: 42,
				title: 'Exercise',
				courseId: 10,
				locked: false,
				source: 'workspace-detected',
			},
			exercises: [{ id: 42, title: 'Exercise', courseId: 10 }],
		});

		act(() => {
			result.current.setIrisState(irisState);
		});

		expect(result.current.context?.courseId).toBe(10);
	});

	it('setIrisState with null context sets context to null', () => {
		const { result } = renderHook(() => useChatStore());

		// First set a context
		act(() => {
			result.current.setIrisState(makeIrisState({
				context: { type: 'course', id: 1, title: 'Course', locked: false, source: 'user-selected' },
			}));
		});

		// Then clear it
		act(() => {
			result.current.setIrisState(makeIrisState({ context: null }));
		});

		expect(result.current.context).toBeNull();
	});

	it('resetTransientChatUi clears the run UI and streaming state', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.applyRunUi({
				localSessionId: 's1', revision: 1, draft: { runId: 'A', text: 'partial' },
				activities: [makeActivity()], waiting: true, runState: 'RUNNING',
			}, 's1');
		});

		act(() => {
			result.current.resetTransientChatUi();
		});

		expect(result.current.streaming.isStreaming).toBe(false);
		expect(result.current.liveDraft).toBeNull();
		expect(result.current.activities).toEqual([]);
		expect(result.current.runState).toBeNull();
		expect(result.current.runError).toBeNull();
		expect(result.current.lastRunUiRevision).toBe(0);
	});

	it('resetTransientChatUi does not clear messages', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1' }));
			result.current.applyRunUi({
				localSessionId: 's1', revision: 1, draft: { runId: 'A', text: 'partial' },
				activities: [makeActivity()], waiting: true, runState: 'RUNNING',
			}, 's1');
		});

		act(() => {
			result.current.resetTransientChatUi();
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.liveDraft).toBeNull();
		expect(result.current.activities).toEqual([]);
	});

	describe('markMessageFailed', () => {
		it('marks a pending user message as failed and returns true', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({
					localId: 'pending-1',
					role: 'user',
					status: 'sending',
				}));
			});

			let returnValue: boolean | undefined;
			act(() => {
				returnValue = result.current.markMessageFailed('pending-1', 'No context', 'no-context');
			});

			expect(returnValue).toBe(true);
			expect(result.current.messages[0].status).toBe('error');
			expect(result.current.messages[0].errorMessage).toBe('No context');
			expect(result.current.messages[0].errorReason).toBe('no-context');
		});

		it('returns false and does not mutate when localId does not match', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({
					localId: 'real-1',
					role: 'user',
					status: 'sending',
				}));
			});

			let returnValue: boolean | undefined;
			act(() => {
				returnValue = result.current.markMessageFailed('stale-99', 'No context', 'no-context');
			});

			expect(returnValue).toBe(false);
			expect(result.current.messages[0].status).toBe('sending');
			expect(result.current.messages[0].errorMessage).toBeUndefined();
		});

		it('returns false and does not mutate when target is not a user role', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({
					localId: 'asst-1',
					role: 'assistant',
					status: 'sending',
				}));
			});

			let returnValue: boolean | undefined;
			act(() => {
				returnValue = result.current.markMessageFailed('asst-1', 'No context', 'no-context');
			});

			expect(returnValue).toBe(false);
			expect(result.current.messages[0].status).toBe('sending');
		});

		it('returns false and does not mutate when target is already sent', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({
					localId: 'sent-1',
					role: 'user',
					status: 'sent',
				}));
			});

			let returnValue: boolean | undefined;
			act(() => {
				returnValue = result.current.markMessageFailed('sent-1', 'Stale rejection', 'no-context');
			});

			expect(returnValue).toBe(false);
			expect(result.current.messages[0].status).toBe('sent');
		});
	});

	describe('removeMessage', () => {
		it('removes the matching message by localId', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({ localId: 'a' }));
				result.current.addMessage(makeMessage({ localId: 'b' }));
			});

			act(() => {
				result.current.removeMessage('a');
			});

			expect(result.current.messages).toHaveLength(1);
			expect(result.current.messages[0].localId).toBe('b');
		});

		it('is a no-op when no matching localId exists', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({ localId: 'a' }));
			});

			act(() => {
				result.current.removeMessage('does-not-exist');
			});

			expect(result.current.messages).toHaveLength(1);
		});
	});

	it('clearMessages also clears the run UI (draft, activities, run state, revision)', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			const activity: IrisActivityDTO = { id: 'a1', kind: 'TOOL', name: 'search', state: 'RUNNING' };
			result.current.applyRunUi({
				localSessionId: 's1', revision: 3, draft: { runId: 'A', text: 'partial' },
				activities: [activity],
				waiting: true, runState: 'RUNNING',
			}, 's1');
		});

		act(() => {
			result.current.clearMessages();
		});

		expect(result.current.liveDraft).toBeNull();
		expect(result.current.activities).toEqual([]);
		expect(result.current.runState).toBeNull();
		expect(result.current.runError).toBeNull();
		expect(result.current.lastRunUiRevision).toBe(0);
	});

	describe('streaming and commits', () => {
		const projection = (over: Partial<IrisRunUiProjection> = {}): IrisRunUiProjection => ({
			localSessionId: 's1', revision: 1, draft: null, activities: [],
			waiting: false, runState: null, ...over,
		});
		const msg = (id: number | undefined, content: string): ChatMessage => ({
			id, localId: `l${id ?? 'x'}`, role: 'assistant', content, timestamp: 0, status: 'sent',
		});

		it('upserts by server id instead of duplicating', () => {
			useChatStore.getState().addMessage(msg(7, 'first'));
			useChatStore.getState().addMessage(msg(7, 'first with memories'));
			expect(useChatStore.getState().messages).toHaveLength(1);
			expect(useChatStore.getState().messages[0].content).toBe('first with memories');
		});

		it('appends messages without a server id', () => {
			useChatStore.getState().addMessage({ ...msg(undefined, 'a'), localId: 'l1' });
			useChatStore.getState().addMessage({ ...msg(undefined, 'b'), localId: 'l2' });
			expect(useChatStore.getState().messages).toHaveLength(2);
		});

		it('applies a newer projection and rejects an older revision', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 5, draft: { runId: 'A', text: 'hi' } }), 's1');
			expect(useChatStore.getState().liveDraft?.text).toBe('hi');
			useChatStore.getState().applyRunUi(projection({ revision: 4, draft: { runId: 'A', text: 'stale' } }), 's1');
			expect(useChatStore.getState().liveDraft?.text).toBe('hi');
		});

		it('rejects a projection for another session', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 9, draft: { runId: 'A', text: 'x' } }), 's2');
			expect(useChatStore.getState().liveDraft).toBeNull();
		});

		it('applies a commit atomically: message present, draft cleared, one update', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 1, draft: { runId: 'A', text: 'partial' } }), 's1');
			useChatStore.getState().applyCommit(msg(3, 'final'), projection({ revision: 2 }), 's1', 's1');
			expect(useChatStore.getState().messages).toHaveLength(1);
			expect(useChatStore.getState().liveDraft).toBeNull();
		});

		it('inserts a projection-less bubble without touching run state', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 1, waiting: true }), 's1');
			useChatStore.getState().applyCommit(msg(4, 'error'), undefined, 's1', 's1');
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().messages).toHaveLength(1);
		});

		it('drops a projection-less bubble from a stale session', () => {
			useChatStore.getState().applyCommit(msg(5, 'stale'), undefined, 's-old', 's1');
			expect(useChatStore.getState().messages).toHaveLength(0);
		});

		it('applies the message but rejects a stale-revision projection, leaving run-UI fields untouched', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 5, draft: { runId: 'A', text: 'live' }, waiting: true }), 's1');
			useChatStore.getState().applyCommit(msg(6, 'final'), projection({ revision: 5 }), 's1', 's1');

			expect(useChatStore.getState().messages.some((m) => m.id === 6 && m.content === 'final')).toBe(true);
			expect(useChatStore.getState().liveDraft).toEqual({ runId: 'A', text: 'live' });
			expect(useChatStore.getState().runState).toBeNull();
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().lastRunUiRevision).toBe(5);
		});

		it('applies the message but rejects a projection scoped to another session, leaving run-UI fields untouched', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 1, draft: { runId: 'A', text: 'live' }, waiting: true }), 's1');
			useChatStore.getState().applyCommit(msg(7, 'final'), projection({ revision: 2, localSessionId: 's2' }), 's1', 's1');

			expect(useChatStore.getState().messages.some((m) => m.id === 7 && m.content === 'final')).toBe(true);
			expect(useChatStore.getState().liveDraft).toEqual({ runId: 'A', text: 'live' });
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().lastRunUiRevision).toBe(1);
		});
	});
});
