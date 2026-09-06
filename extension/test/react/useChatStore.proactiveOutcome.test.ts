import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@webview/stores/useChatStore';

describe('useChatStore.setProactiveOutcome', () => {
    beforeEach(() => {
        useChatStore.setState({ messages: [] });
    });

    it('patches proactiveOutcome on the matching message by id', () => {
        useChatStore.setState({
            messages: [
                { id: 1, localId: 'a', role: 'assistant', content: 'x', timestamp: 0, origin: 'proactive' },
                { id: 2, localId: 'b', role: 'assistant', content: 'y', timestamp: 0, origin: 'proactive' },
            ],
        });
        useChatStore.getState().setProactiveOutcome(2, 'DISMISSED');
        const msgs = useChatStore.getState().messages;
        expect(msgs.find((m) => m.id === 1)?.proactiveOutcome).toBeUndefined();
        expect(msgs.find((m) => m.id === 2)?.proactiveOutcome).toBe('DISMISSED');
    });
});
