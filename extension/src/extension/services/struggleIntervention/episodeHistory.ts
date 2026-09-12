import type { EpisodeHistoryEntry, EpisodeOutcomeLabel } from '@shared/messageContracts';

import type { Episode } from './slot/episode';

/**
 * The session-only ring buffer of terminal episodes, behind the dev dashboard's
 * history panel.
 *
 * Its own unit because it is the one piece of orchestrator state with no bearing
 * on any decision: nothing reads it back, every write is append-only, and the cap
 * is the whole invariant. Keeping it on the service meant an array, a static cap
 * and a derivation sitting among the slot machinery they have nothing to do with.
 */
export class EpisodeHistory {
    private static readonly CAP = 20;
    private _entries: EpisodeHistoryEntry[] = [];

    /** Newest last. Returned as-is: callers only read, and copying every dashboard poll is waste. */
    get entries(): readonly EpisodeHistoryEntry[] {
        return this._entries;
    }

    /** Append a terminal episode; derives peakLevel + duration from the episode. */
    record(episode: Episode, outcome: EpisodeOutcomeLabel, nowMs: number): void {
        const peakLevel: 'ambient' | 'active' = episode.hints.some(h => h.level === 'active') ? 'active' : 'ambient';
        this._entries.push({
            episodeId: episode.episodeId,
            peakLevel,
            outcome,
            hintCount: episode.hints.length,
            durationMs: nowMs - episode.createdAtMs,
            startedAtMs: episode.createdAtMs,
        });
        if (this._entries.length > EpisodeHistory.CAP) {
            this._entries.shift();
        }
    }
}
