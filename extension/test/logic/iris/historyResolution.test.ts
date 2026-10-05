import { describe, expect, it } from 'vitest';

import type { IrisChatMessage } from '@shared/types/apiResponses';

import { historyResolvesRun } from '@extension/services/iris/chat/historyResolution';
import { toWireMessages } from '@extension/services/iris/conversation/messageFormatting';

describe('historyResolvesRun', () => {
    it('true when a final assistant message is newer than the baseline', () => {
        expect(historyResolvesRun([{ id: 12, role: 'assistant' }], 11)).toBe(true);
    });
    it('false when the only newer assistant message is intermediate (final:false)', () => {
        expect(historyResolvesRun([{ id: 12, role: 'assistant', final: false }], 11)).toBe(false);
    });
    it('false when the newest assistant message is not past the baseline', () => {
        expect(historyResolvesRun([{ id: 11, role: 'assistant' }], 11)).toBe(false);
    });
    it('false when the newer message is a user message', () => {
        expect(historyResolvesRun([{ id: 12, role: 'user' }], 11)).toBe(false);
    });
    it('treats final:true and final:undefined as terminal', () => {
        expect(historyResolvesRun([{ id: 12, role: 'assistant', final: true }], 11)).toBe(true);
        expect(historyResolvesRun([{ id: 12, role: 'assistant', final: undefined }], 11)).toBe(true);
    });

    it('a point-out marker persisted before the answer does not resolve the run, the answer does', () => {
        // Recovery reads the projected history. Artemis writes the COMMAND row
        // between the student's message and the answer, so if it projected as
        // an assistant row it would end the run before the answer exists.
        const user: IrisChatMessage = { id: 10, sender: 'USER', content: [{ type: 'text', textContent: 'show me' }] };
        const marker: IrisChatMessage = {
            id: 11,
            sender: 'COMMAND',
            content: [{ type: 'json', attributes: { type: 'pointOut', parameters: { lectureUnitId: 42, page: 3 } } }],
        };
        const answer: IrisChatMessage = { id: 12, sender: 'LLM', content: [{ type: 'text', textContent: 'slide 3' }] };

        expect(historyResolvesRun(toWireMessages([user, marker]), 10)).toBe(false);
        expect(historyResolvesRun(toWireMessages([user, marker, answer]), 10)).toBe(true);
    });
});
