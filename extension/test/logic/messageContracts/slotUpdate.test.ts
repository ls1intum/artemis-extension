import { describe, expect, it } from 'vitest';

import type { EpisodeHistoryEntry, SlotDebugSnapshot } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

describe('StruggleSlotUpdate contract', () => {
    it('exposes the enum value', () => {
        expect(ExtensionMsg.StruggleSlotUpdate).toBe('struggleSlotUpdate');
    });
    it('types compose into a well-formed payload', () => {
        const snapshot: SlotDebugSnapshot = {
            nowMs: 1000, state: 'delivered', level: 'active', episodeId: 'ep-1', generation: 3,
            episodeAgeMs: 500, hintCount: 2, isNew: false, inSession: true,
            watchdog: { armed: true, staleDeadlineMs: 2000 },
            inFlight: { intent: 'confirm_close', localToken: 7, episodeId: 'ep-1', generation: 3, requestToken: 'rt-abc' },
            owed: { confirmClose: false }, pendingOutcomes: 0, awaitingEvidence: false,
            suppression: {
                serverAvailable: true, courseProactiveOff: false, studentProactiveOn: true,
            },
        };
        const episodes: EpisodeHistoryEntry[] = [
            { episodeId: 'ep-0', peakLevel: 'ambient', outcome: 'DISCARDED', hintCount: 1, durationMs: 20_000, startedAtMs: 0 },
        ];
        const msg = { type: ExtensionMsg.StruggleSlotUpdate, snapshot, episodes };
        expect(msg.snapshot.state).toBe('delivered');
        expect(msg.episodes[0].outcome).toBe('DISCARDED');
    });
});
