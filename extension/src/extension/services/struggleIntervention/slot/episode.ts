/** Monotonic generation counter, bumped on semantic episode transitions only. */
export type SlotGeneration = number;

/** Intervention level — matches the wire values for `action` (minus 'silent'). */
export type Level = 'ambient' | 'active';

/** A single proactive hint shown during an episode (initial or escalation). */
export interface EpisodeHint {
    level: Level;
    text: string;
    /** Session-relative timestamp in seconds when the hint was issued. */
    atSessionS: number;
}

/**
 * Client-side episode tracking.
 *
 * `isNew` is true from creation until the FIRST accepted outbound request of ANY intent
 * for this episode (C3 in the slot spec), then flipped via markContinuation.
 */
export interface Episode {
    episodeId: string;
    isNew: boolean;
    hints: EpisodeHint[];
    createdAtMs: number;
}

/** Create a fresh episode. `idgen` is injected so tests can be deterministic. */
export function newEpisode(now: number, idgen: () => string): Episode {
    return { episodeId: idgen(), isNew: true, hints: [], createdAtMs: now };
}

/** Immutably append a hint to the episode. */
export function addHint(ep: Episode, hint: EpisodeHint): Episode {
    return { ...ep, hints: [...ep.hints, hint] };
}

/** Immutably mark the episode as no longer new (after the first accepted outbound request). */
export function markContinuation(ep: Episode): Episode {
    return { ...ep, isNew: false };
}

/** Project the episode into the shape sent on every outbound request (drops createdAtMs). */
export function toRequestEpisode(ep: Episode): { episodeId: string; isNew: boolean; hints: EpisodeHint[] } {
    return { episodeId: ep.episodeId, isNew: ep.isNew, hints: ep.hints };
}
