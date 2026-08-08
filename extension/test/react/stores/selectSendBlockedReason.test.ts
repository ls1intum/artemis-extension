import { describe, expect, it } from 'vitest';

import { selectSendBlockedReason } from '@webview/stores/useChatStore';

const IDLE = {
	sendInFlight: false,
	navigationInFlight: false,
	streaming: { isStreaming: false },
};

describe('selectSendBlockedReason', () => {
	it('is undefined when nothing blocks a send', () => {
		expect(selectSendBlockedReason(IDLE)).toBeUndefined();
	});

	it('names the host lock', () => {
		expect(selectSendBlockedReason({ ...IDLE, sendInFlight: true }))
			.toBe('Iris is still answering');
	});

	it('names navigation', () => {
		expect(selectSendBlockedReason({ ...IDLE, navigationInFlight: true }))
			.toBe('The conversation is still loading');
	});

	it('names the local run before the host has taken its lock', () => {
		expect(selectSendBlockedReason({ ...IDLE, streaming: { isStreaming: true } }))
			.toBe('Iris is still answering');
	});

	it('ranks navigation above the local run, as the host does', () => {
		// Reachable during snapshot races. The host tests sendInFlight, then
		// navigationInFlight, and rejects this one for navigation, so the
		// student must read the navigation sentence.
		expect(selectSendBlockedReason({
			...IDLE,
			navigationInFlight: true,
			streaming: { isStreaming: true },
		})).toBe('The conversation is still loading');
	});

	it('ranks the host lock above navigation, as the host does', () => {
		expect(selectSendBlockedReason({
			...IDLE,
			sendInFlight: true,
			navigationInFlight: true,
		})).toBe('Iris is still answering');
	});
});
