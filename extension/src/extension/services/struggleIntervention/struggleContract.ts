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
    // C3: slot-continuity fields (camelCase keys, snake enum values per Global Constraints)
    /** Discriminator for the Pyris pipeline mode. */
    intent: 'decide' | 'confirm_close';
    /** Client-tracked episode, always present (never null). isNew=true until the first accepted POST. */
    episode: {
        episodeId: string;
        isNew: boolean;
        hints: Array<{ level: string; text: string; atSessionS: number }>;
    };
    /** Required for confirm_close; absent for decide. */
    confirmReason?: 'progress' | 'parked_progress';
    /** Per-POST scoped-cancel uuid; forwarded to Artemis so the exact job can be cancelled by token. */
    requestToken: string;
}

/** 202 response body of the trigger (Plan 2 StruggleInterventionAcceptedDTO). */
export interface StruggleInterventionAccepted {
    accepted: boolean;
    /** True only when proactive is off for this course (§13) — distinct from an in-flight `accepted:false`. */
    courseDisabled?: boolean;
    exerciseId: number;
    jobId?: string | null;
}

/**
 * Outcome of the trigger POST (spec §9/§11/§13). `accepted` → enqueued, await the websocket decision; `course-off`
 * → proactive is disabled for this course (§13), so the client pauses proactive for the session with NO no-AI lamp;
 * `unavailable` → the endpoint is missing (404 — old/feature-less Artemis), so the client degrades to the no-AI lamp
 * (spec §11); `failed` → a transient 4xx/5xx/network error → treat as silent.
 */
export type StruggleEgressResult = 'accepted' | 'course-off' | 'unavailable' | 'failed';

/** Per-user struggle event on /user/topic/iris/struggle-intervention (Plan 2 StruggleInterventionEventDTO). */
export interface StruggleInterventionEvent {
    exerciseId: number;
    /** Frame kind discriminator (C4). Absent on old servers -> backwards-compat ambient/active path. */
    kind?: 'decide' | 'confirm_close';
    /** Episode id echoed back by the server; present for all new-style frames (C4). */
    episodeId?: string;
    /** Decide-frame action. Required for kind='decide'; absent for confirm_close. */
    action?: 'silent' | 'ambient' | 'active';
    message?: string;
    sessionId?: number;
    /** Saved IrisMessage id for the persisted proactive message (spec §7.2/§8). Set for ambient and active after
     *  unify-persistence; lets a later slice target the exact message (open/reveal/dismiss).
     *  Also present on confirm_close (close/offer row). */
    messageId?: number;
    /** Server-computed Pyris confidence, forwarded by Plan 2 (Task 4b 5-component DTO) for the client eval log (§12). */
    confidence?: number;
    /** Inline anchor + cue (spec §4/§8). All optional; present only when the gate localized the nudge to one line. */
    anchorFile?: string;
    anchorLine?: number;
    inlineHint?: string;
    // confirm_close fields (C4):
    /** True when Pyris agreed to close the episode (DELIVERED resolved -> free + fold; PARKED resolved -> discard). */
    resolved?: boolean;
    /** Closing sentence text (persisted via chat-ws; present when resolved=true + closing row was written). */
    closingSentence?: string;
    /** Human-readable episode label for the fold praise line (NOT persisted; only in this control message). */
    episodeLabel?: string;
}
