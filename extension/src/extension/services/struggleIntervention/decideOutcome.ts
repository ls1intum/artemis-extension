export interface OutcomeInputs {
    optedIn: boolean;
    inFlight: boolean;
    hasExercise: boolean;
    /** A `.noai` marker file in the workspace forces the deterministic no-AI path (spec §9). */
    noaiMarker: boolean;
    /** Iris/the feature is reachable; a prior 404 (feature missing / old server) flips this off (spec §9, §11). */
    serverAvailable: boolean;
}

export type Outcome = 'silent' | 'post' | 'skip';

/**
 * Pure gating for an alert (spec §9/§10/§11). The silent path (no surface, ZERO egress, logged) is
 * entered when ANY of the three §9 triggers holds: no proactive-egress opt-in, a `.noai` marker, or the server
 * being unavailable. Otherwise POST to the exercise-keyed endpoint unless a request is already in flight or
 * there is no active exercise to key on. NO session is required: the server materializes it only on `active`.
 * The per-session ACTIVE cap is deliberately NOT applied here. It gates the intrusive `active` surfacing AFTER
 * the server decides (`ambient` must stay looser, spec §10). Request rate is bounded by the in-flight guard.
 */
export function decideOutcome(i: OutcomeInputs): Outcome {
    if (!i.optedIn || i.noaiMarker || !i.serverAvailable) {
        return 'silent';
    }
    if (i.inFlight || !i.hasExercise) {
        return 'skip';
    }
    return 'post';
}
