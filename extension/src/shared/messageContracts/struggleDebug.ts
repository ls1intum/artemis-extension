/**
 * Struggle-detection debug + live-tick data model.
 *
 * These are the engine's own telemetry shapes, not UI messages: they travel to
 * the developer-only StruggleDetection view and nowhere else. They live apart
 * from `extensionMessages.ts` so the ordinary extension->webview protocol is
 * not read through 175 lines of engine internals.
 */

// ---------------------------------------------------------------------------
// Shared boundary union (mirrors engine's BOUNDARY_PRIORITY order)
// ---------------------------------------------------------------------------

export const BOUNDARY_TYPES = ['FM', 'E4', 'N1', 'STATE'] as const;
export type BoundaryType = typeof BOUNDARY_TYPES[number];

// ---------------------------------------------------------------------------
// Live-tick wire types (extension → struggle-detection webview)
// ---------------------------------------------------------------------------

export interface LiveDecisionTrace {
    outcome: 'fired-edit' | 'fired-discrete' | 'suppressed';
    reason: 'fired' | 'no-candidate' | 'b2-fluent-typing' | 'b4-grace-filter'
        | 'd1-warmup' | 'below-threshold' | 'cooldown' | 'not-rearmed';
    discreteTrigger: 'test-stagnation' | null;
    urgency: number;
    theta: number;
    typingRate: number | null;
    boundariesPresent: BoundaryType[];
    /** Infinity serialised as null (not JSON-safe). */
    secondsSinceLastAlert: number | null;
    inWarmup: boolean;
    graceActive: boolean;
    /** Live per-gate conditions for the developer gate view (mirrors the engine's
     *  GateConditions; each flag = that gate's blocking condition currently holds). */
    gates: {
        fluentTyping: boolean;
        grace: boolean;
        warmup: boolean;
        belowThreshold: boolean;
        cooldown: boolean;
        notRearmed: boolean;
    };
}

export interface LiveTick {
    /** Session-relative seconds. */
    t: number;
    /** S_base urgency score. */
    urgency: number;
    theta: number;
    boundariesPreGate: BoundaryType[];
    alertKind: 'edit' | 'discrete' | null;
    alertPrimary: BoundaryType | null;
    decisionTrace: LiveDecisionTrace;
}

// ---------------------------------------------------------------------------
// Struggle debug snapshot (dev timers/counters dashboard + Phase B log)
// ---------------------------------------------------------------------------

/** Raw Tier-2 delivery-throttle state (counters + absolute ms timestamps) PLUS the
 *  currently-active per-level caps (THROTTLE_BY_LEVEL, ENG) it is being enforced
 *  against. The caps live here (not in {@link StruggleDebugCaps}) because they are
 *  read live per delivery and can change mid-session on a proactive-level flip; the
 *  consumer computes every "remaining" locally against the snapshot's `nowMs`, so
 *  this stays pure state with no derived countdowns baked in. */
export interface StruggleThrottleState {
    /** Alerts DELIVERED so far this session (vs maxAlertsPerSession below). */
    deliveredThisSession: number;
    /** Absolute ms timestamps of delivered alerts this session. */
    deliveredAtMs: number[];
    /** Absolute ms of the most recent delivery, or null if none yet (the min-gap floor). */
    lastDeliveryMs: number | null;
    /** ACTIVE per-session delivery cap for the current proactive-help level. */
    maxAlertsPerSession: number;
    /** ACTIVE hard floor (seconds) between deliveries for the current level. */
    minDeliveryGapS: number;
}

/** SPEC caps echoed once so the client computes "remaining" without re-importing config.
 *  The Tier-2 delivery-throttle caps are NOT here (they are level-dependent and live on
 *  {@link StruggleThrottleState} instead, read live from the sink). */
export interface StruggleDebugCaps {
    warmupS: number;
    cooldownS: number;
    graceS: number;
    gapNormS: number;
}

/**
 * Latest-only engine STATE for the dev timers/counters dashboard and the Phase B
 * per-tick log. NOT a history series, and deliberately SEPARATE from the per-tick
 * {@link LiveTick} (never widen that). Every "remaining" value is derived by the
 * consumer from these absolute ms anchors + {@link StruggleDebugCaps}, against a
 * local 1 s clock offset-corrected by `nowMs`, so the 10 s emission cadence still
 * yields smooth per-second countdowns.
 */
export interface StruggleDebugSnapshot {
    /** Whether an exercise session is currently active. When false, all anchors below are stale
     *  (a previous session's or zero) and the dashboard must show "no active session" instead of timers. */
    sessionActive: boolean;
    /** Engine clock at snapshot-build time (ms); the client's offset reference. */
    nowMs: number;
    /** Session start (ms); the warmup anchor. */
    sessionStartMs: number;
    /** Last engine alert (ms); the cooldown anchor. null if none fired yet. */
    lastAlertMs: number | null;
    /** Last bad-build that armed the B4 grace window (ms); the grace anchor. null if none. */
    lastFmBadMs: number | null;
    /** Delivery-throttle state, or null when the sink does not expose it. */
    throttle: StruggleThrottleState | null;
    /** Effective feature window at the last tick: max(10, min(60, sessionSeconds)). */
    effectiveWindowS: number;
    /** Longest pause in the last window (s), shown against caps.gapNormS. */
    longestGapS: number;
    /** Latest tick's decision trace (outcome / reason / per-gate booleans / urgency / theta /
     *  boundaries): the SAME shape the live feed emits, reused here so the developer
     *  decision-flow pipeline renders from the init snapshot. `null` when no session is active
     *  or before the first tick (`_lastTick` persists across sessions; do not show it stale). */
    decisionTrace: LiveDecisionTrace | null;
    /** Test-stagnation add-on state (discrete path): current no-progress streak vs N. `null`
     *  when no session is active (the tracker is only recreated on start, so an unconditional
     *  read would leak the previous session's streak). */
    testStagnation: { enabled: boolean; streak: number; n: number } | null;
    caps: StruggleDebugCaps;
}

/**
 * In-flight request state for a slot (decision or confirm-close).
 */
export interface SlotInFlightDebug {
    intent: 'decide' | 'confirm_close' | 'help_request';
    localToken: number;
    episodeId: string;
    generation: number;
    requestToken: string;
}

/**
 * Snapshot of a slot's current state (assignment, deliverables, inflight requests).
 */
export interface SlotDebugSnapshot {
    nowMs: number;
    state: 'free' | 'parked' | 'delivered';
    level: 'ambient' | 'active' | null;
    episodeId: string | null;
    generation: number;
    episodeAgeMs: number | null;
    hintCount: number;
    isNew: boolean;
    inSession: boolean;
    watchdog: { armed: boolean; staleDeadlineMs: number | null };
    inFlight: SlotInFlightDebug | null;
    owed: { confirmClose: boolean };
    pendingOutcomes: number;
    /** Idle-abandon evidence gate: true = no new decide POSTs until fresh student activity. */
    awaitingEvidence: boolean;
    /** The "why is it silent" state: session latches and the student toggle. */
    suppression: {
        /** false -> POSTs stopped, local fallback templates on the lamp. */
        serverAvailable: boolean;
        /** Session latch: course-level proactive disabled (404/course-off reply). */
        courseProactiveOff: boolean;
        /** Durable single remembered student toggle (issue #341), independent of the active exercise. */
        studentProactiveOn: boolean;
    };
}

/**
 * Label describing how an episode completed.
 */
export type EpisodeOutcomeLabel = 'DISMISSED' | 'RECOVERED' | 'ABANDONED' | 'DISCARDED' | 'INTERRUPTED';

/**
 * History entry for a completed episode within a session.
 */
export interface EpisodeHistoryEntry {
    episodeId: string;
    peakLevel: 'ambient' | 'active';
    outcome: EpisodeOutcomeLabel;
    hintCount: number;
    durationMs: number;
    startedAtMs: number;
}
