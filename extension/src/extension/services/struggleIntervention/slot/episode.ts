/** Monotonic generation counter, bumped on semantic episode transitions only. */
export type SlotGeneration = number;

/** Intervention level (matches the wire values for `action`, minus 'silent'). */
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
 * Novelty ("is this episode still new to Pyris") is NOT modeled on the episode: the orchestrator
 * owns it in its `_continuedEpisodeIds` set, keyed by episodeId, because episode objects are cloned
 * across the request lifecycle (take/replace/escalate). The wire `isNew` flag is derived from that
 * set at send time, and the slot debug snapshot re-derives it the same way.
 */
export interface Episode {
    episodeId: string;
    hints: EpisodeHint[];
    createdAtMs: number;
    /** The programming-exercise id this episode belongs to, captured at creation so a teardown after an
     *  exercise switch still writes/cancels under the OWNING exercise, not the newly-opened one (#350). */
    exerciseId?: number;
}

/** Create a fresh episode. `idgen` is injected so tests can be deterministic. */
export function newEpisode(now: number, idgen: () => string, exerciseId?: number): Episode {
    return { episodeId: idgen(), hints: [], createdAtMs: now, exerciseId };
}

/** Immutably append a hint to the episode. */
export function addHint(ep: Episode, hint: EpisodeHint): Episode {
    return { ...ep, hints: [...ep.hints, hint] };
}
