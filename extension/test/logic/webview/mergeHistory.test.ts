import { describe, expect, it } from 'vitest';

import { mergeHistory } from '@webview/stores/mergeHistory';
import type { ChatMessage } from '@webview/views/IrisChat/types';

function msg(over: Partial<ChatMessage> & { localId: string }): ChatMessage {
    return {
        role: 'assistant',
        content: 'x',
        timestamp: 0,
        ...over,
    };
}

describe('mergeHistory', () => {
    it('merges a persisted history snapshot into the live list without duplicating or reordering', () => {
        const existing: ChatMessage[] = [
            msg({ id: 1, role: 'assistant', content: 'old answer', localId: 'a' }),
            msg({ id: 2, role: 'user', content: 'my question', localId: 'b', status: 'sent' }),
            msg({ role: 'assistant', content: 'Error: x', localId: 'e' }),
        ];
        const incoming: ChatMessage[] = [
            msg({ id: 1, role: 'assistant', content: 'old answer', localId: 'x' }),
            msg({ id: 2, role: 'user', content: 'my question', localId: 'y' }),
            msg({ id: 3, role: 'assistant', content: 'the recovered answer', localId: 'z' }),
        ];

        const result = mergeHistory(existing, incoming);

        expect(result.map((m) => m.id)).toEqual([1, 2, 3, undefined]);

        // Matched bubbles keep their live localId and status.
        expect(result[0].localId).toBe('a');
        expect(result[1].localId).toBe('b');
        expect(result[1].status).toBe('sent');

        expect(result[2].id).toBe(3);
        expect(result[2].content).toBe('the recovered answer');
        expect(result[2].localId).toBe('z');

        // The error bubble (no id) is kept, appended after the canonical history.
        expect(result[3].localId).toBe('e');

        // No duplicate of the user bubble.
        expect(result.filter((m) => m.id === 2)).toHaveLength(1);
    });

    it('keeps an existing bubble whose id is absent from the incoming history, in its original order', () => {
        const existing: ChatMessage[] = [
            msg({ id: 1, role: 'assistant', content: 'a1', localId: 'a' }),
            msg({ id: 99, role: 'assistant', content: 'orphaned', localId: 'orphan' }),
        ];
        const incoming: ChatMessage[] = [
            msg({ id: 1, role: 'assistant', content: 'a1', localId: 'x' }),
        ];

        const result = mergeHistory(existing, incoming);

        expect(result.map((m) => m.localId)).toEqual(['a', 'orphan']);
    });

    it('returns the incoming history unchanged when there is no existing state', () => {
        const incoming: ChatMessage[] = [
            msg({ id: 1, role: 'assistant', content: 'a1', localId: 'x' }),
        ];

        const result = mergeHistory([], incoming);

        expect(result).toEqual(incoming);
    });
});
