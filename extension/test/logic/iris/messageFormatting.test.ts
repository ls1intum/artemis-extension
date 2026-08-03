import { describe, expect, it } from 'vitest';

import type { IrisChatMessage } from '@shared/types/apiResponses';

import { toWireMessages } from '@extension/services/iris/conversation/messageFormatting';

/**
 * `toWireMessages` is the only thing between a persisted Artemis message and
 * the transcript the student reads, and it is reached from BOTH transcript
 * producers (`_deliverTranscript`'s load and merge modes). `isIrisActivity`
 * has its own unit tests; what is pinned here is the WIRING: that the filter
 * is actually applied and that `final` survives the mapping.
 */

const activity = (over: Record<string, unknown> = {}) => ({
    id: 'a1', name: 'file_lookup', kind: 'TOOL', state: 'FINISHED', ...over,
});

const assistant = (over: Partial<IrisChatMessage> = {}): IrisChatMessage => ({
    id: 7,
    sender: 'LLM',
    content: [{ type: 'text', textContent: 'because' }],
    sentAt: '2025-01-01T00:00:00Z',
    ...over,
} as IrisChatMessage);

describe('toWireMessages', () => {
    it('carries well-formed activities through and drops malformed ones', () => {
        const rows = toWireMessages([assistant({
            activities: [
                activity(),
                activity({ id: 'a2', kind: 'NOT_A_KIND' }),
                activity({ id: 'a3', state: 'NOT_A_STATE' }),
                { nonsense: true },
                null,
            ],
        } as Partial<IrisChatMessage>)]);

        expect(rows).toHaveLength(1);
        // Only the well-formed one survives; without the filter the webview
        // renders activity rows with no name or state.
        expect(rows[0].activities?.map((a) => a.id)).toEqual(['a1']);
    });

    it('leaves activities undefined when the message carries none, and when the field is not an array', () => {
        expect(toWireMessages([assistant()])[0].activities).toBeUndefined();
        expect(toWireMessages([assistant({ activities: 'nope' } as never)])[0].activities).toBeUndefined();
    });

    it('passes `final: false` through, so an intermediate message keeps the run alive', () => {
        // `false` is what suppresses the feedback controls and tells the
        // webview the run has not ended. Dropping it finalizes the run early.
        expect(toWireMessages([assistant({ final: false })])[0].final).toBe(false);
    });

    it('normalises a non-boolean `final` to undefined rather than forwarding it', () => {
        expect(toWireMessages([assistant({ final: 'yes' } as never)])[0].final).toBeUndefined();
        expect(toWireMessages([assistant({ final: true })])[0].final).toBe(true);
    });

    it('maps sender, id, content and timestamp onto the wire row', () => {
        const rows = toWireMessages([
            assistant({ id: 1, sender: 'USER', content: [{ type: 'text', textContent: 'why?' }] }),
            assistant({ id: 2 }),
        ]);

        expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
        expect(rows.map((r) => r.id)).toEqual([1, 2]);
        expect(rows[0].content).toBe('why?');
        expect(rows[0].timestamp).toBe(Date.parse('2025-01-01T00:00:00Z'));
    });

    it('returns an empty list for undefined input', () => {
        expect(toWireMessages(undefined)).toEqual([]);
    });
});
