import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '../../../src/views/webview/react/stores/useChatStore';
import type { ChatMessage, ChatContext, ReferencedFilesData } from '../../../src/views/webview/react/views/IrisChat/types';
import type { ExtMsg } from '../../../src/shared/messageContracts';

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
	recentExercises: [],
	recentCourses: [],
	allExercises: [],
	allCourses: [],
	...overrides,
});

describe('useChatStore', () => {
	it('initializes with empty state', () => {
		const { result } = renderHook(() => useChatStore());

		expect(result.current.context).toBeNull();
		expect(result.current.messages).toEqual([]);
		expect(result.current.sessions).toEqual([]);
		expect(result.current.streaming.isStreaming).toBe(false);
		expect(result.current.streaming.messageLocalId).toBeNull();
		expect(result.current.streaming.visibleChunks).toEqual([]);
		expect(result.current.isLoading).toBe(false);
		expect(result.current.isWebSocketConnected).toBe(false);
		expect(result.current.disabledMessage).toBeNull();
		expect(result.current.isNoAiDetected).toBe(false);
		expect(result.current.referencedFiles).toBeNull();
		expect(result.current.showDiagnostics).toBe(false);
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

	it('setMessages replaces all messages', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'old-1' }));
		});

		const newMessages = [
			makeMessage({ localId: 'new-1', content: 'New message 1' }),
			makeMessage({ localId: 'new-2', content: 'New message 2' }),
		];

		act(() => {
			result.current.setMessages(newMessages);
		});

		expect(result.current.messages).toHaveLength(2);
		expect(result.current.messages[0].localId).toBe('new-1');
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

	it('updateMessageContent updates content of the matching localId message', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1', content: 'Original content' }));
		});

		act(() => {
			result.current.updateMessageContent('msg-1', 'Updated content');
		});

		expect(result.current.messages[0].content).toBe('Updated content');
	});

	it('updateMessageContent does not affect other messages', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1', content: 'First' }));
			result.current.addMessage(makeMessage({ localId: 'msg-2', content: 'Second' }));
		});

		act(() => {
			result.current.updateMessageContent('msg-1', 'Modified');
		});

		expect(result.current.messages[1].content).toBe('Second');
	});

	it('setMessageStatus updates status of the matching localId message', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1', status: 'sending' }));
		});

		act(() => {
			result.current.setMessageStatus('msg-1', 'sent');
		});

		expect(result.current.messages[0].status).toBe('sent');
	});

	it('setMessageStatus sets error status with error message', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1' }));
		});

		act(() => {
			result.current.setMessageStatus('msg-1', 'error', 'Network timeout');
		});

		expect(result.current.messages[0].status).toBe('error');
		expect(result.current.messages[0].errorMessage).toBe('Network timeout');
	});

	it('startStreaming sets isStreaming true and initializes streaming state', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.startStreaming('stream-msg-1');
		});

		expect(result.current.streaming.isStreaming).toBe(true);
		expect(result.current.streaming.messageLocalId).toBe('stream-msg-1');
		expect(result.current.streaming.visibleChunks).toEqual([]);
	});

	it('appendStreamChunk adds chunk to visibleChunks', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.startStreaming('stream-msg-1');
		});

		act(() => {
			result.current.appendStreamChunk('Hello');
		});

		expect(result.current.streaming.visibleChunks).toHaveLength(1);
		expect(result.current.streaming.visibleChunks[0]).toBe('Hello');
	});

	it('appendStreamChunk accumulates multiple chunks', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.startStreaming('stream-msg-1');
			result.current.appendStreamChunk('Hello');
			result.current.appendStreamChunk(' World');
			result.current.appendStreamChunk('!');
		});

		expect(result.current.streaming.visibleChunks).toEqual(['Hello', ' World', '!']);
	});

	it('finishStreaming clears streaming state and updates message content', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'stream-msg-1', content: '' }));
			result.current.startStreaming('stream-msg-1');
			result.current.appendStreamChunk('Complete answer');
		});

		act(() => {
			result.current.finishStreaming('Complete answer');
		});

		expect(result.current.streaming.isStreaming).toBe(false);
		expect(result.current.streaming.messageLocalId).toBeNull();
		expect(result.current.streaming.visibleChunks).toEqual([]);
		expect(result.current.messages[0].content).toBe('Complete answer');
	});

	it('finishStreaming leaves messages unchanged when no active streaming message', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.addMessage(makeMessage({ localId: 'msg-1', content: 'Original' }));
		});

		act(() => {
			result.current.finishStreaming('Should not apply');
		});

		expect(result.current.messages[0].content).toBe('Original');
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

	it('setWebSocketConnected updates isWebSocketConnected', () => {
		const { result } = renderHook(() => useChatStore());

		act(() => {
			result.current.setWebSocketConnected(true);
		});

		expect(result.current.isWebSocketConnected).toBe(true);
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
			recentExercises: [{ id: 42, title: 'Sorting Algorithms', courseId: 10 }],
			recentCourses: [{ id: 10, title: 'Algorithms' }],
			allExercises: [{ id: 42, title: 'Sorting Algorithms', courseId: 10 }],
			allCourses: [{ id: 10, title: 'Algorithms' }],
		});

		act(() => {
			result.current.setIrisState(irisState);
		});

		expect(result.current.activeSessionId).toBe('session-abc');
		expect(result.current.sessions).toHaveLength(1);
		expect(result.current.context?.type).toBe('exercise');
		expect(result.current.context?.id).toBe(42);
		expect(result.current.recentExercises).toHaveLength(1);
		expect(result.current.recentCourses).toHaveLength(1);
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
			recentExercises: [{ id: 42, title: 'Exercise', courseId: 10 }],
			allExercises: [],
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
});
