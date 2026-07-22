import { describe, expect, it } from 'vitest';
import { historyResolvesRun } from '@extension/services/iris/chat/historyResolution';

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
});
