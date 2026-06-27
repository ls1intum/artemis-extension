/** Boundary codenames — identical to the engine (constants.ts) and the server enum. */
export type BoundaryType = 'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE';

/** Interpretable severity-driver names (spec §5.1), derived from engine feature fields. */
export type ComponentName = 'feedbackViewing' | 'regionPersistence' | 'errorDistance' | 'typing' | 'gap' | 'n4';

export type StruggleAction = 'silent' | 'ambient' | 'active';

export interface StruggleSignal {
    alert: {
        tSessionS: number;
        primaryBoundary: BoundaryType;
        boundaryTypes: BoundaryType[];
        severity: number;
        path: 'armed' | 'e6';
        inWarmup: boolean;
        inGrace: boolean;
    };
    /** last ≤12 ticks, oldest→newest */
    trajectory: Array<{ t: number; s: number; v: number }>;
    dominantComponents: Array<{ name: ComponentName; value: number }>;
    sessionSeconds: number;
}

/** Body of POST /api/iris/chat/exercises/{exerciseId}/struggle-intervention (Plan 2 IrisStruggleInterventionRequestDTO). exerciseId is the path key. */
export interface StruggleInterventionRequest {
    struggleSignal: StruggleSignal;
    uncommittedFiles: Record<string, string>;
}

/** 202 response body of the trigger (Plan 2 StruggleInterventionAcceptedDTO). */
export interface StruggleInterventionAccepted {
    accepted: boolean;
    exerciseId: number;
    jobId?: string | null;
}

/**
 * Outcome of the trigger POST (spec §9/§11). `accepted` → enqueued, await the websocket decision; `unavailable`
 * → the endpoint is missing (404 — old/feature-less Artemis), so the client degrades to the no-AI lamp for the
 * session (spec §11: "no-AI lamp remains"); `failed` → a transient 4xx/5xx/network error → treat as silent.
 */
export type StruggleEgressResult = 'accepted' | 'unavailable' | 'failed';

/** Per-user struggle event on /user/topic/iris/struggle-intervention (Plan 2 StruggleInterventionEventDTO). */
export interface StruggleInterventionEvent {
    exerciseId: number;
    action: 'ambient' | 'active';
    message?: string;
    sessionId?: number;
    /** Saved IrisMessage id for the persisted proactive message (spec §7.2/§8). Set for ambient and active after
     *  unify-persistence; lets a later slice target the exact message (open/reveal/dismiss). */
    messageId?: number;
    /** Server-computed Pyris confidence, forwarded by Plan 2 (Task 4b 5-component DTO) for the client eval log (§12). */
    confidence?: number;
    /** Inline anchor + cue (spec §4/§8). All optional; present only when the gate localized the nudge to one line. */
    anchorFile?: string;
    anchorLine?: number;
    inlineHint?: string;
}
