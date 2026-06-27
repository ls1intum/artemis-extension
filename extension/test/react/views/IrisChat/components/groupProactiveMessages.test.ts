import { describe, expect, it } from 'vitest';

import { groupProactiveMessages } from '@webview/views/IrisChat/components/groupProactiveMessages';
import type { ChatMessage } from '@webview/views/IrisChat/types';

function msg(localId: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        localId,
        role: 'assistant',
        content: `content-${localId}`,
        timestamp: 0,
        ...overrides,
    };
}
const user = (localId: string): ChatMessage => msg(localId, { role: 'user' });
const proactive = (localId: string): ChatMessage => msg(localId, { role: 'assistant', origin: 'proactive' });

describe('groupProactiveMessages', () => {
    it('keeps non-proactive messages as singles', () => {
        const items = groupProactiveMessages([user('u1'), msg('a1')]);
        expect(items).toEqual([
            { kind: 'single', message: expect.objectContaining({ localId: 'u1' }) },
            { kind: 'single', message: expect.objectContaining({ localId: 'a1' }) },
        ]);
    });

    it('leaves a lone proactive message as a single (no collapse)', () => {
        const items = groupProactiveMessages([proactive('p1')]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ kind: 'single' });
    });

    it('collapses a run of consecutive proactive messages into latest + earlier', () => {
        const items = groupProactiveMessages([proactive('p1'), proactive('p2'), proactive('p3')]);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            kind: 'proactive-run',
            earlier: [
                expect.objectContaining({ localId: 'p1' }),
                expect.objectContaining({ localId: 'p2' }),
            ],
            latest: expect.objectContaining({ localId: 'p3' }),
        });
    });

    it('a student turn between proactive messages breaks the run', () => {
        const items = groupProactiveMessages([proactive('p1'), user('u1'), proactive('p2')]);
        expect(items.map((i) => i.kind)).toEqual(['single', 'single', 'single']);
    });

    it('groups only the consecutive run, leaving surrounding messages as singles', () => {
        const items = groupProactiveMessages([user('u1'), proactive('p1'), proactive('p2'), msg('a1')]);
        expect(items).toHaveLength(3);
        expect(items[0]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'u1' }) });
        expect(items[1]).toMatchObject({ kind: 'proactive-run', latest: expect.objectContaining({ localId: 'p2' }) });
        expect(items[2]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'a1' }) });
    });

    it('does not mutate the input array', () => {
        const input = [proactive('p1'), proactive('p2')];
        const copy = [...input];
        groupProactiveMessages(input);
        expect(input).toEqual(copy);
    });
});
