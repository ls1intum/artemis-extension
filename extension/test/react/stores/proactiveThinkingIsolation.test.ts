import { beforeEach, describe, expect, it } from 'vitest';

import type { IrisRunUiProjection } from '@shared/messageContracts';

import { useChatStore } from '@webview/stores/useChatStore';

/**
 * `proactiveThinking` is host-owned: only `setProactiveThinking` may write it. The whole point of
 * giving it its own field instead of reusing `streaming.isStreaming` is that the run UI's many
 * writers -- a run projection, a history load, a transcript clear, a websocket disconnect -- must
 * not be able to clear it out from under the host. This suite is what keeps that true.
 */
describe('proactiveThinking isolation from the run UI', () => {
	const projection = (revision: number, waiting: boolean): IrisRunUiProjection => ({
		sessionId: 1,
		revision,
		waiting,
		draft: null,
		activities: [],
		runState: waiting ? 'IN_PROGRESS' : 'DONE',
		error: undefined,
	} as unknown as IrisRunUiProjection);

	beforeEach(() => {
		useChatStore.setState({ currentSessionId: 1 });
		useChatStore.getState().setProactiveThinking(true);
	});

	it('applyRunUi does not clear it', () => {
		useChatStore.getState().applyRunUi(projection(5, false));
		expect(useChatStore.getState().streaming.isStreaming).toBe(false);
		expect(useChatStore.getState().proactiveThinking).toBe(true);
	});

	it('applyCommit does not clear it', () => {
		useChatStore.getState().applyCommit(
			{ localId: 'm1', role: 'assistant', content: 'hi', timestamp: 0 },
			projection(6, false),
			1,
		);
		expect(useChatStore.getState().proactiveThinking).toBe(true);
	});

	it('resetTransientChatUi does not clear it', () => {
		useChatStore.getState().resetTransientChatUi();
		expect(useChatStore.getState().streaming.isStreaming).toBe(false);
		expect(useChatStore.getState().proactiveThinking).toBe(true);
	});

	it('clearMessages does not clear it', () => {
		useChatStore.getState().clearMessages();
		expect(useChatStore.getState().proactiveThinking).toBe(true);
	});

	it('applyLoadedMessages does not clear it', () => {
		useChatStore.getState().applyLoadedMessages(1, []);
		expect(useChatStore.getState().proactiveThinking).toBe(true);
	});

	it('setWebSocketStatus does not clear it', () => {
		useChatStore.getState().setWebSocketStatus('disconnected');
		expect(useChatStore.getState().proactiveThinking).toBe(true);
	});

	it('setIrisState does not clear it', () => {
		useChatStore.getState().setIrisState({
			exercises: [], courses: [], displayMessageCount: 0,
		} as never);
		expect(useChatStore.getState().proactiveThinking).toBe(true);
	});

	it('the host can turn it off, which is the only way it goes off', () => {
		useChatStore.getState().setProactiveThinking(false);
		expect(useChatStore.getState().proactiveThinking).toBe(false);
	});
});
