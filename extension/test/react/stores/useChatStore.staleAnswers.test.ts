import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';

describe('useChatStore staleAnswers', () => {
    beforeEach(() => {
        useChatStore.setState({ staleAnswers: new Map() });
    });

    it('records a quick-reply answer by messageId', () => {
        useChatStore.getState().setStaleAnswer(42, 'solved');
        expect(useChatStore.getState().staleAnswers.get(42)).toBe('solved');
    });

    it('last write wins for the same messageId', () => {
        useChatStore.getState().setStaleAnswer(7, 'still-on-it');
        useChatStore.getState().setStaleAnswer(7, 'solved');
        expect(useChatStore.getState().staleAnswers.get(7)).toBe('solved');
    });
});
