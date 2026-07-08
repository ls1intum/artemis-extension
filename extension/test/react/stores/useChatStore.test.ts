import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ExtMsg } from '@shared/messageContracts';

import { useChatStore } from '@webview/stores/useChatStore';
import type { ChatMessage, IrisStageDTO, ReferencedFilesData } from '@webview/views/IrisChat/types';

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

const makeStage = (overrides: Partial<IrisStageDTO> = {}): IrisStageDTO => ({
	name: 'thinking',
	weight: 10,
	state: 'IN_PROGRESS',
	message: 'Thinking hard',
	internal: false,
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

	it('addMessage deduplicates by id: second call with same id is a no-op', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'optimistic-1', id: 42, content: 'Optimistic bubble' }));
		});
		act(() => {
			// Simulate the chat-ws row arriving with the same Artemis id
			result.current.addMessage(makeMessage({ localId: 'ws-row-1', id: 42, content: 'Server row' }));
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.messages[0].localId).toBe('optimistic-1');
	});

	it('addMessage does NOT dedup when ids are different', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-a', id: 1, content: 'First' }));
			result.current.addMessage(makeMessage({ localId: 'msg-b', id: 2, content: 'Second' }));
		});

		expect(result.current.messages).toHaveLength(2);
	});

	it('addMessage does NOT dedup when id is undefined', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			// Two optimistic messages without a server id both append
			result.current.addMessage(makeMessage({ localId: 'opt-1', id: undefined, content: 'First optimistic' }));
			result.current.addMessage(makeMessage({ localId: 'opt-2', id: undefined, content: 'Second optimistic' }));
		});

		expect(result.current.messages).toHaveLength(2);
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

	it('initializes with empty irisStages', () => {
		const { result } = renderHook(() => useChatStore());
		expect(result.current.irisStages).toEqual([]);
	});

	it('setIrisStages replaces the stages array', () => {
		const { result } = renderHook(() => useChatStore());
		const stages = [makeStage({ name: 'thinking' }), makeStage({ name: 'analyzing', state: 'NOT_STARTED' })];

		act(() => {
			result.current.setIrisStages(stages);
		});

		expect(result.current.irisStages).toHaveLength(2);
		expect(result.current.irisStages[0].name).toBe('thinking');
		expect(result.current.irisStages[1].state).toBe('NOT_STARTED');
	});

	it('setIrisStages replaces previous stages', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setIrisStages([makeStage({ name: 'old' })]);
		});

		act(() => {
			result.current.setIrisStages([makeStage({ name: 'new' })]);
		});

		expect(result.current.irisStages).toHaveLength(1);
		expect(result.current.irisStages[0].name).toBe('new');
	});

	it('resetTransientChatUi clears irisStages and streaming state', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setIrisStages([makeStage()]);
			result.current.startStreaming();
		});

		act(() => {
			result.current.resetTransientChatUi();
		});

		expect(result.current.irisStages).toEqual([]);
		expect(result.current.streaming.isStreaming).toBe(false);
	});

	it('resetTransientChatUi does not clear messages', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1' }));
			result.current.setIrisStages([makeStage()]);
		});

		act(() => {
			result.current.resetTransientChatUi();
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.irisStages).toEqual([]);
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

	it('clearMessages also clears irisStages', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1' }));
			result.current.setIrisStages([makeStage()]);
		});

		act(() => {
			result.current.clearMessages();
		});

		expect(result.current.messages).toEqual([]);
		expect(result.current.irisStages).toEqual([]);
	});

	// ---------------------------------------------------------------------------
	// C4: suppressedIds + removeMessageById (stale-row suppression)
	// ---------------------------------------------------------------------------

	describe('suppressedIds', () => {
		it('starts empty', () => {
			const { result } = renderHook(() => useChatStore());
			expect(result.current.suppressedIds.size).toBe(0);
		});

		it('addMessage skips a row whose id is in suppressedIds', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => { result.current.removeMessageById(42); });
			act(() => {
				result.current.addMessage(makeMessage({ localId: 'ws-1', id: 42, content: 'Stale row' }));
			});

			expect(result.current.messages).toHaveLength(0);
		});

		it('clearMessages resets suppressedIds', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => { result.current.removeMessageById(99); });
			act(() => { result.current.clearMessages(); });

			expect(result.current.suppressedIds.size).toBe(0);
			// After clear, a message with that id can be inserted again
			act(() => {
				result.current.addMessage(makeMessage({ localId: 'fresh-1', id: 99, content: 'Fresh row' }));
			});
			expect(result.current.messages).toHaveLength(1);
		});
	});

	describe('removeMessageById', () => {
		it('removes the row if present by numeric id', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({ localId: 'a', id: 10 }));
				result.current.addMessage(makeMessage({ localId: 'b', id: 20 }));
			});

			act(() => { result.current.removeMessageById(10); });

			expect(result.current.messages).toHaveLength(1);
			expect(result.current.messages[0].localId).toBe('b');
		});

		it('is a no-op on the messages array when id is not present', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => { result.current.addMessage(makeMessage({ localId: 'a', id: 5 })); });
			act(() => { result.current.removeMessageById(999); });

			expect(result.current.messages).toHaveLength(1);
		});

		it('records the id in suppressedIds even when no matching row is present', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => { result.current.removeMessageById(77); });

			expect(result.current.suppressedIds.has(77)).toBe(true);
		});

		it('STALE-ROW SUPPRESSION arrival order 1: row first, then removeMessageById -> zero rows', () => {
			const { result } = renderHook(() => useChatStore());

			// Row arrives via chat-ws before the control frame drop
			act(() => {
				result.current.addMessage(makeMessage({ localId: 'ws-1', id: 55, content: 'Stale hint' }));
			});
			expect(result.current.messages).toHaveLength(1);

			// Control frame is dropped -> remove + suppress
			act(() => { result.current.removeMessageById(55); });

			expect(result.current.messages).toHaveLength(0);
			expect(result.current.suppressedIds.has(55)).toBe(true);
		});

		it('STALE-ROW SUPPRESSION arrival order 2: removeMessageById first, then chat-ws row -> zero rows', () => {
			const { result } = renderHook(() => useChatStore());

			// Control frame drop arrives before the chat-ws row
			act(() => { result.current.removeMessageById(66); });

			// Chat-ws row arrives later
			act(() => {
				result.current.addMessage(makeMessage({ localId: 'ws-2', id: 66, content: 'Stale hint' }));
			});

			expect(result.current.messages).toHaveLength(0);
			expect(result.current.suppressedIds.has(66)).toBe(true);
		});
	});

	describe('resolveOffer', () => {
		it('marks the offer as answered on the message with the matching offerId', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({
					localId: 'p-1', id: 1, role: 'assistant', origin: 'proactive',
					offer: { offerId: 'offer-1', moment: 'stuck' },
				}));
			});

			act(() => { result.current.resolveOffer('offer-1', 'accept'); });

			expect(result.current.messages[0].offer?.answered).toBe('accept');
		});

		it('is a no-op when no message has a matching offerId', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => {
				result.current.addMessage(makeMessage({
					localId: 'p-1', id: 1, role: 'assistant', origin: 'proactive',
					offer: { offerId: 'offer-1', moment: 'stuck' },
				}));
			});

			act(() => { result.current.resolveOffer('offer-does-not-exist', 'decline'); });

			expect(result.current.messages[0].offer?.answered).toBeUndefined();
		});
	});

	describe('setLiveEpisode (host-authoritative live-episode frame)', () => {
		it('replaces the live set with the given episode id', () => {
			const { result } = renderHook(() => useChatStore());

			// A previously registered live episode (via addMessage) is superseded wholesale
			act(() => {
				result.current.addMessage(makeMessage({
					localId: 'p-1', id: 1, role: 'assistant', origin: 'proactive', proactiveEpisodeId: 'ep-old',
				}));
			});
			expect(result.current.liveEpisodeIds.has('ep-old')).toBe(true);

			act(() => { result.current.setLiveEpisode('ep-new'); });

			expect(result.current.liveEpisodeIds.has('ep-new')).toBe(true);
			expect(result.current.liveEpisodeIds.has('ep-old')).toBe(false);

			act(() => { result.current.clearMessages(); });
			act(() => { result.current.setLiveEpisode(null); });
		});

		it('setLiveEpisode(null) clears the live set', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => { result.current.setLiveEpisode('ep-live'); });
			expect(result.current.liveEpisodeIds.has('ep-live')).toBe(true);

			act(() => { result.current.setLiveEpisode(null); });
			expect(result.current.liveEpisodeIds.size).toBe(0);
		});

		it('clearMessages preserves liveEpisodeIds (liveness is slot state, not session state)', () => {
			const { result } = renderHook(() => useChatStore());

			act(() => { result.current.setLiveEpisode('ep-live'); });
			act(() => { result.current.clearMessages(); });

			// Switching sessions (clearMessages) must not forget which episode is live,
			// otherwise switching back re-folds the live episode as "Earlier hint".
			expect(result.current.liveEpisodeIds.has('ep-live')).toBe(true);

			act(() => { result.current.setLiveEpisode(null); });
		});
	});
});
