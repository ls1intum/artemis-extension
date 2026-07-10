/** Boundary codenames — the engine's edit-path set (constants.ts) plus the wire-only 'TPS'
 *  for the discrete test-stagnation path. Mirrored by the Pyris BoundaryType literal. */
export type BoundaryType = 'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE' | 'TPS';

export type StruggleAction = 'silent' | 'ambient' | 'active';

export interface StruggleSignal {
    alert: {
        tSessionS: number;
        primaryBoundary: BoundaryType;
        boundaryTypes: BoundaryType[];
        /** The decision signal sBase at the firing tick. */
        severity: number;
        /** 'armed'/'e6' for edit-path alerts; 'discrete' for the add-on path (TPS). */
        path: 'armed' | 'e6' | 'discrete';
        inWarmup: boolean;
        inGrace: boolean;
    };
    /** last ≤12 ticks, oldest→newest; s is the severity sBase at tick t
     *  (the same signal the alert's `severity` reports at the firing tick). */
    trajectory: Array<{ t: number; s: number }>;
    sessionSeconds: number;
}

/** Body of POST /api/iris/chat/exercises/{exerciseId}/struggle-intervention (Plan 2 IrisStruggleInterventionRequestDTO). exerciseId is the path key. */
export interface StruggleInterventionRequest {
    struggleSignal: StruggleSignal;
    uncommittedFiles: Record<string, string>;
    // C3: slot-continuity fields (camelCase keys, snake enum values per Global Constraints)
    /** Discriminator for the Pyris pipeline mode. */
    intent: 'decide' | 'confirm_close' | 'help_request';
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
    /**
     * Client's current proactive-help level for this exercise (Off/Less/More, spec §12.2), mapped to the
     * server's Pull/Push vocabulary: `less` -> `pull`, `more` -> `push`. Optional so old servers ignore it;
     * `off` never reaches a POST (gated upstream), so only `pull`/`push` are ever sent.
     */
    proactivityMode?: 'pull' | 'push';
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
