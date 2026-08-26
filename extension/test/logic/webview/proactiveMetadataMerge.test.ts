import { describe, expect, it } from 'vitest';

import { transcriptMessage } from '@extension/services/iris/conversation/messageFormatting';
import { mergeHistory } from '@webview/stores/mergeHistory';
import type { ChatMessage } from '@webview/views/IrisChat/types';
import { toChatMessage } from '@webview/views/IrisChat/useIrisInboundMessages';

/**
 * A reconnect merge must not blank a live proactive bubble.
 *
 * `mergeHistory` merges as `{ ...prev, ...inc }`, and a spread copies own
 * properties INCLUDING ones set to `undefined`. The three arms that share
 * `toChatMessage` carry different field sets, so mapping the proactive fields
 * unconditionally would clear an episode's identity on every reconnect. These
 * tests pin both halves of that: what the producer actually sends, and what the
 * merge does with it.
 */

const liveBubble: ChatMessage = {
    id: 7,
    localId: 'live',
    role: 'assistant',
    content: 'Try naming the loop variable for what it holds.',
    timestamp: 1,
    origin: 'proactive',
    proactiveEpisodeId: 'ep-1',
    offer: { offerId: 'off-1', moment: 'stuck' },
};

describe('proactive metadata across a reconnect merge', () => {
    it('sends none of the proactive fields on the merge wire', () => {
        // The premise the guard rests on. If this ever changes, the mapper below
        // can stop guarding - and until it does, an unguarded spread is a wipe.
        const detail = {
            sessionId: 3,
            messages: [{ id: 7, sender: 'LLM', content: 'Try naming the loop variable.', sentAt: '2026-01-01T00:00:00Z' }],
        } as unknown as Parameters<typeof transcriptMessage>[0];

        const [row] = (transcriptMessage(detail, 'merge') as { messages: Record<string, unknown>[] }).messages;

        expect(row).not.toHaveProperty('origin');
        expect(row).not.toHaveProperty('proactiveOutcome');
        expect(row).not.toHaveProperty('proactiveEpisodeId');
        expect(row).not.toHaveProperty('offer');
    });

    it('omits an absent field rather than mapping it to undefined', () => {
        const mapped = toChatMessage({
            id: 7, role: 'assistant', content: 'x', timestamp: 1,
        } as Parameters<typeof toChatMessage>[0]);

        // `in`, not `=== undefined`: the distinction between "absent" and
        // "present and undefined" IS the fix, and only `in` can see it.
        expect('origin' in mapped).toBe(false);
        expect('proactiveOutcome' in mapped).toBe(false);
        expect('proactiveEpisodeId' in mapped).toBe(false);
        expect('offer' in mapped).toBe(false);
    });

    it('keeps a live bubble’s episode identity and offer marker through the merge', () => {
        const incoming = toChatMessage({
            id: 7, role: 'assistant', content: 'Try naming the loop variable.', timestamp: 1,
        } as Parameters<typeof toChatMessage>[0]);

        const [merged] = mergeHistory([liveBubble], [incoming]);

        expect(merged.origin).toBe('proactive');
        expect(merged.proactiveEpisodeId).toBe('ep-1');
        expect(merged.offer).toEqual({ offerId: 'off-1', moment: 'stuck' });
        // The server row is still authoritative for the persisted fields.
        expect(merged.content).toBe('Try naming the loop variable.');
        expect(merged.localId).toBe('live');
    });

    it('still lets a server-supplied outcome through', () => {
        // The guard skips absent fields only. A field the host DOES send must win,
        // or a dismissed hint would never settle.
        const incoming = toChatMessage({
            id: 7, role: 'assistant', content: 'x', timestamp: 1, proactiveOutcome: 'DISMISSED',
        } as Parameters<typeof toChatMessage>[0]);

        const [merged] = mergeHistory([liveBubble], [incoming]);

        expect(merged.proactiveOutcome).toBe('DISMISSED');
        expect(merged.proactiveEpisodeId).toBe('ep-1');
    });
});
