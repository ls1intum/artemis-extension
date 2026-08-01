import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ExtMsg, IrisRunUiProjection } from '@shared/messageContracts';
import type { IrisActivityDTO } from '@shared/types/apiResponses';

import { selectCanChangeTopic, useChatStore } from '@webview/stores/useChatStore';
import type { ChatMessage, ReferencedFilesData } from '@webview/views/IrisChat/types';

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
	localId: 'local-1',
	role: 'user',
	content: 'Hello, Iris!',
	timestamp: Date.now(),
	...overrides,
});

const makeIrisState = (overrides: Partial<ExtMsg<'updateIrisState'>['state']> = {}): ExtMsg<'updateIrisState'>['state'] => ({
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

		expect(result.current.messages).toEqual([]);
		expect(result.current.currentSessionId).toBeNull();
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

	it('hasReceivedInitialIrisState flips to true on first setIrisState and stays true afterwards', () => {
		const { result } = renderHook(() => useChatStore());

		expect(result.current.hasReceivedInitialIrisState).toBe(false);

		act(() => {
			result.current.setIrisState(makeIrisState());
		});

		expect(result.current.hasReceivedInitialIrisState).toBe(true);

		// A later snapshot must not reset the flag: resetting would
		// re-trigger the cold-mount skeleton on every navigation.
		act(() => {
			result.current.setIrisState(makeIrisState({ currentSessionId: 900 }));
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

	it('applyLoadedMessages replaces the transcript wholesale', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1' }));
			result.current.addMessage(makeMessage({ localId: 'msg-2' }));
		});

		act(() => {
			result.current.applyLoadedMessages(901, []);
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

	it('loadedSessionId starts as null and applyLoadedMessages records the conversation it hydrated', () => {
		const { result } = renderHook(() => useChatStore());

		expect(result.current.loadedSessionId).toBeNull();

		act(() => {
			result.current.applyLoadedMessages(900, [
				{ id: 1, localId: 'a', role: 'user', content: 'Hi', timestamp: 1, helpful: null, status: 'sent' },
			]);
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.loadedSessionId).toBe(900);
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

	it('setIrisState mirrors the tracked exercises and courses for the pickers', () => {
		const { result } = renderHook(() => useChatStore());
		const irisState = makeIrisState({
			exercises: [{ id: 42, title: 'Sorting Algorithms', courseId: 10 }],
			courses: [{ id: 10, title: 'Algorithms' }],
		});

		act(() => {
			result.current.setIrisState(irisState);
		});

		expect(result.current.exercises).toHaveLength(1);
		expect(result.current.courses).toHaveLength(1);
	});

	it('resetTransientChatUi clears the run UI and streaming state', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setIrisState(makeIrisState({ currentSessionId: 900 }));
			result.current.applyRunUi({
				sessionId: 900, revision: 1, draft: { runId: 'A', text: 'partial' },
				activities: [makeActivity()], waiting: true, runState: 'RUNNING',
			});
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
			result.current.setIrisState(makeIrisState({ currentSessionId: 900 }));
			result.current.addMessage(makeMessage({ localId: 'msg-1' }));
			result.current.applyRunUi({
				sessionId: 900, revision: 1, draft: { runId: 'A', text: 'partial' },
				activities: [makeActivity()], waiting: true, runState: 'RUNNING',
			});
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

	it('resetTransientChatUi clears the run UI (draft, activities, run state, revision)', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setIrisState(makeIrisState({ currentSessionId: 900 }));
			const activity: IrisActivityDTO = { id: 'a1', kind: 'TOOL', name: 'search', state: 'RUNNING' };
			result.current.applyRunUi({
				sessionId: 900, revision: 3, draft: { runId: 'A', text: 'partial' },
				activities: [activity],
				waiting: true, runState: 'RUNNING',
			});
		});

		act(() => {
			result.current.resetTransientChatUi();
		});

		expect(result.current.liveDraft).toBeNull();
		expect(result.current.activities).toEqual([]);
		expect(result.current.runState).toBeNull();
		expect(result.current.runError).toBeNull();
		expect(result.current.lastRunUiRevision).toBe(0);
	});

	describe('streaming and commits', () => {
		const OPEN = 900;
		const projection = (over: Partial<IrisRunUiProjection> = {}): IrisRunUiProjection => ({
			sessionId: OPEN, revision: 1, draft: null, activities: [],
			waiting: false, runState: null, ...over,
		});
		const msg = (id: number | undefined, content: string): ChatMessage => ({
			id, localId: `l${id ?? 'x'}`, role: 'assistant', content, timestamp: 0, status: 'sent',
		});

		beforeEach(() => {
			useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: OPEN }));
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
			useChatStore.getState().applyRunUi(projection({ revision: 5, draft: { runId: 'A', text: 'hi' } }));
			expect(useChatStore.getState().liveDraft?.text).toBe('hi');
			useChatStore.getState().applyRunUi(projection({ revision: 4, draft: { runId: 'A', text: 'stale' } }));
			expect(useChatStore.getState().liveDraft?.text).toBe('hi');
		});

		it('rejects a projection for another conversation', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 9, sessionId: 901, draft: { runId: 'A', text: 'x' } }));
			expect(useChatStore.getState().liveDraft).toBeNull();
		});

		it('applies a commit atomically: message present, draft cleared, one update', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 1, draft: { runId: 'A', text: 'partial' } }));
			useChatStore.getState().applyCommit(msg(3, 'final'), projection({ revision: 2 }), OPEN);
			expect(useChatStore.getState().messages).toHaveLength(1);
			expect(useChatStore.getState().liveDraft).toBeNull();
		});

		it('inserts a projection-less bubble without touching run state', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 1, waiting: true }));
			useChatStore.getState().applyCommit(msg(4, 'error'), undefined, OPEN);
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().messages).toHaveLength(1);
		});

		it('drops a projection-less bubble from a conversation we already left', () => {
			useChatStore.getState().applyCommit(msg(5, 'stale'), undefined, 901);
			expect(useChatStore.getState().messages).toHaveLength(0);
		});

		it('applies the message but rejects a stale-revision projection, leaving run-UI fields untouched', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 5, draft: { runId: 'A', text: 'live' }, waiting: true }));
			useChatStore.getState().applyCommit(msg(6, 'final'), projection({ revision: 5 }), OPEN);

			expect(useChatStore.getState().messages.some((m) => m.id === 6 && m.content === 'final')).toBe(true);
			expect(useChatStore.getState().liveDraft).toEqual({ runId: 'A', text: 'live' });
			expect(useChatStore.getState().runState).toBeNull();
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().lastRunUiRevision).toBe(5);
		});

		it('applies the message but rejects a projection scoped to another conversation, leaving run-UI fields untouched', () => {
			useChatStore.getState().applyRunUi(projection({ revision: 1, draft: { runId: 'A', text: 'live' }, waiting: true }));
			useChatStore.getState().applyCommit(msg(7, 'final'), projection({ revision: 2, sessionId: 901 }), OPEN);

			expect(useChatStore.getState().messages.some((m) => m.id === 7 && m.content === 'final')).toBe(true);
			expect(useChatStore.getState().liveDraft).toEqual({ runId: 'A', text: 'live' });
			expect(useChatStore.getState().streaming.isStreaming).toBe(true);
			expect(useChatStore.getState().lastRunUiRevision).toBe(1);
		});
	});

	describe('mergeLoadedMessages', () => {
		it('merges history into the live list, preserving an optimistic user bubble already stamped with an id', () => {
			useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 900 }));
			useChatStore.getState().addMessage({
				id: 2, localId: 'optimistic-b', role: 'user', content: 'my question', timestamp: 1, status: 'sent',
			});

			useChatStore.getState().mergeLoadedMessages(900, [
				{ id: 2, localId: 'history-y', role: 'user', content: 'my question', timestamp: 1 },
				{ id: 3, localId: 'history-z', role: 'assistant', content: 'answer', timestamp: 2 },
			]);

			const messages = useChatStore.getState().messages;
			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({ id: 2, localId: 'optimistic-b', status: 'sent' });
			expect(messages[1]).toMatchObject({ id: 3, localId: 'history-z', content: 'answer' });
		});

		it('is ignored when the sessionId is not the open conversation', () => {
			useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 900 }));
			useChatStore.getState().addMessage({
				id: 2, localId: 'optimistic-b', role: 'user', content: 'my question', timestamp: 1, status: 'sent',
			});

			useChatStore.getState().mergeLoadedMessages(901, [
				{ id: 2, localId: 'history-y', role: 'user', content: 'my question', timestamp: 1 },
				{ id: 3, localId: 'history-z', role: 'assistant', content: 'answer', timestamp: 2 },
			]);

			const messages = useChatStore.getState().messages;
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({ id: 2, localId: 'optimistic-b' });
		});
	});

	describe('confirmSentMessage', () => {
		it('stamps the matching optimistic user bubble with the server id and status sent', () => {
			useChatStore.getState().addMessage({ localId: 'pending-c', role: 'user', content: 'pending question', timestamp: 1, status: 'sending' });

			useChatStore.getState().confirmSentMessage('pending-c', 42);

			const message = useChatStore.getState().messages.find((m) => m.localId === 'pending-c');
			expect(message?.id).toBe(42);
			expect(message?.status).toBe('sent');
		});

		it('is a no-op when no bubble matches the given localId', () => {
			useChatStore.getState().addMessage({ localId: 'pending-d', role: 'user', content: 'pending question', timestamp: 1, status: 'sending' });

			useChatStore.getState().confirmSentMessage('does-not-exist', 42);

			const message = useChatStore.getState().messages.find((m) => m.localId === 'pending-d');
			expect(message?.id).toBeUndefined();
			expect(message?.status).toBe('sending');
		});

		it('is a no-op when the matching localId belongs to a non-user message', () => {
			useChatStore.getState().addMessage({ localId: 'asst-x', role: 'assistant', content: 'assistant reply', timestamp: 1 });

			useChatStore.getState().confirmSentMessage('asst-x', 42);

			const message = useChatStore.getState().messages.find((m) => m.localId === 'asst-x');
			expect(message?.id).toBeUndefined();
		});
	});

	// The store mirrors ONE server conversation. These tests pin that surface
	// in isolation, driven directly through setIrisState and the actions.
	describe('conversation mirror', () => {
		describe('header/picker fields (courseId, courseTitle, conversationTitle, displayMessageCount, workspaceExerciseId)', () => {
			it('setIrisState mirrors courseId, defaulting to null when the wire omits it', () => {
				useChatStore.getState().setIrisState(makeIrisState({ courseId: 42 }));
				expect(useChatStore.getState().courseId).toBe(42);

				useChatStore.getState().setIrisState(makeIrisState());
				expect(useChatStore.getState().courseId).toBeNull();
			});

			it('setIrisState mirrors courseTitle, defaulting to null when the wire omits it', () => {
				useChatStore.getState().setIrisState(makeIrisState({ courseTitle: 'Algorithms' }));
				expect(useChatStore.getState().courseTitle).toBe('Algorithms');

				useChatStore.getState().setIrisState(makeIrisState());
				expect(useChatStore.getState().courseTitle).toBeNull();
			});

			it('setIrisState mirrors conversationTitle, defaulting to null when the wire omits it', () => {
				useChatStore.getState().setIrisState(makeIrisState({ conversationTitle: 'BFS help' }));
				expect(useChatStore.getState().conversationTitle).toBe('BFS help');

				useChatStore.getState().setIrisState(makeIrisState());
				expect(useChatStore.getState().conversationTitle).toBeNull();
			});

			it('setIrisState mirrors displayMessageCount, defaulting to 0 when the wire omits it', () => {
				useChatStore.getState().setIrisState(makeIrisState({ displayMessageCount: 5 }));
				expect(useChatStore.getState().displayMessageCount).toBe(5);

				useChatStore.getState().setIrisState(makeIrisState());
				expect(useChatStore.getState().displayMessageCount).toBe(0);
			});

			it('setIrisState mirrors workspaceExerciseId, defaulting to null when the wire omits it', () => {
				useChatStore.getState().setIrisState(makeIrisState({ workspaceExerciseId: 99 }));
				expect(useChatStore.getState().workspaceExerciseId).toBe(99);

				useChatStore.getState().setIrisState(makeIrisState());
				expect(useChatStore.getState().workspaceExerciseId).toBeNull();
			});
		});

		describe('addMessage session guard', () => {
			it('drops an addMessage for a session that is not open', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().addMessage(makeMessage({ localId: 'msg-x' }), 3);

				expect(useChatStore.getState().messages).toHaveLength(0);
			});

			it('accepts an addMessage whose sessionId matches currentSessionId', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().addMessage(makeMessage({ localId: 'msg-y' }), 7);

				expect(useChatStore.getState().messages).toHaveLength(1);
			});

			it('is inert (no drop) when no sessionId is supplied, even with a currentSessionId set', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().addMessage(makeMessage({ localId: 'msg-z' }));

				expect(useChatStore.getState().messages).toHaveLength(1);
			});
		});

		it('accepts and stores a contextSwap-role message, the persisted transcript-divider row', () => {
			useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

			useChatStore.getState().addMessage(
				{ localId: 'ctx-1', role: 'contextSwap', content: 'Topic set to BFS', timestamp: 1 },
				7,
			);

			expect(useChatStore.getState().messages[0].role).toBe('contextSwap');
		});

		it('clears the notice on any navigation (the next setIrisState)', () => {
			useChatStore.getState().showNotice({ text: 'Switched to a different conversation.' });
			expect(useChatStore.getState().notice).toEqual({ text: 'Switched to a different conversation.' });

			useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 9 }));

			expect(useChatStore.getState().notice).toBeNull();
		});

		it('keeps the composer text when a send reports an unknown outcome', () => {
			useChatStore.getState().setComposerText('hallo');
			useChatStore.getState().addMessage(makeMessage({ localId: 'l1', role: 'user', status: 'sending' }));

			useChatStore.getState().markMessageFailed('l1', 'Unknown error', 'unknown');

			expect(useChatStore.getState().composerText).toBe('hallo');
		});

		describe('selectCanChangeTopic (derived, not a stored field)', () => {
			it('disables the picker while contentState is unknown', () => {
				useChatStore.getState().setIrisState(makeIrisState({ contentState: 'unknown' }));

				expect(selectCanChangeTopic(useChatStore.getState())).toBe(false);
			});

			it('disables the picker while a send is in flight', () => {
				useChatStore.getState().setIrisState(makeIrisState({ contentState: 'empty', sendInFlight: true }));

				expect(selectCanChangeTopic(useChatStore.getState())).toBe(false);
			});

			it('disables the picker while a navigation is in flight', () => {
				useChatStore.getState().setIrisState(makeIrisState({ contentState: 'empty', navigationInFlight: true }));

				expect(selectCanChangeTopic(useChatStore.getState())).toBe(false);
			});

			it('enables the picker once content state is known and nothing is in flight', () => {
				useChatStore.getState().setIrisState(makeIrisState({ contentState: 'empty' }));

				expect(selectCanChangeTopic(useChatStore.getState())).toBe(true);
			});
		});

		describe('every guard keys on the open conversation', () => {
			const projection = (over: Partial<IrisRunUiProjection> = {}): IrisRunUiProjection => ({
				sessionId: 7, revision: 1, draft: null, activities: [],
				waiting: false, runState: null, ...over,
			});

			it('applyRunUi drops a projection whose sessionId does not match currentSessionId', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().applyRunUi(
					projection({ revision: 9, sessionId: 3, draft: { runId: 'A', text: 'x' } }),
				);

				expect(useChatStore.getState().liveDraft).toBeNull();
			});

			it('applyRunUi accepts a projection whose sessionId matches currentSessionId', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().applyRunUi(
					projection({ revision: 9, sessionId: 7, draft: { runId: 'A', text: 'x' } }),
				);

				expect(useChatStore.getState().liveDraft?.text).toBe('x');
			});

			it('applyCommit drops a message whose sessionId does not match currentSessionId', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().applyCommit(
					{ id: 1, localId: 'l1', role: 'assistant', content: 'final', timestamp: 0, status: 'sent' },
					undefined,
					3,
				);

				expect(useChatStore.getState().messages).toHaveLength(0);
			});

			it('applyCommit accepts a message whose sessionId matches currentSessionId', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().applyCommit(
					{ id: 1, localId: 'l1', role: 'assistant', content: 'final', timestamp: 0, status: 'sent' },
					undefined,
					7,
				);

				expect(useChatStore.getState().messages).toHaveLength(1);
			});

			it('mergeLoadedMessages drops a merge whose sessionId does not match currentSessionId', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().mergeLoadedMessages(3, [
					{ id: 1, localId: 'h1', role: 'assistant', content: 'answer', timestamp: 1 },
				]);

				expect(useChatStore.getState().messages).toHaveLength(0);
			});

			it('mergeLoadedMessages accepts a merge whose sessionId matches currentSessionId', () => {
				useChatStore.getState().setIrisState(makeIrisState({ currentSessionId: 7 }));

				useChatStore.getState().mergeLoadedMessages(7, [
					{ id: 1, localId: 'h1', role: 'assistant', content: 'answer', timestamp: 1 },
				]);

				expect(useChatStore.getState().messages).toHaveLength(1);
			});
		});
	});
});
