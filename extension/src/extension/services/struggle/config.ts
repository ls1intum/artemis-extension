// extension/src/extension/services/struggle/config.ts
/**
 * The ONE struggle-detection config, split by MUTABILITY into two exports:
 *
 *  - `SPEC` (frozen, `as const`): the validated detector surface. Golden-pinned;
 *    NOTHING here may be re-tuned — the held-out F1 + golden parity are valid only
 *    for exactly these values, INCLUDING the "🔧 ENG" ones (not-data-derived is NOT
 *    safe-to-change). Changing any SPEC value invalidates the evaluation.
 *  - `TUNING` (mutable defaults): the version-tunable layer — Tier-2 delivery
 *    throttle (downstream of the recorded/golden alert path) and the Tier-3
 *    add-on knobs (no golden to break). Tuning these CANNOT affect goldens or the
 *    held-out F1.
 *
 * The frozen/tunable boundary IS the verifiable boundary: `SPEC` feeds the
 * golden-pinned decision; `TUNING` feeds the downstream throttle + the unevaluated
 * add-ons. Both live here so every number is visible in one place.
 *
 * Evidence tags ([D] own study data, [L] literature, [D+L] both, ENG declared
 * engineering choice) follow the spec.
 */
export const SPEC = {
    /** Score tick interval; first tick at t = 10 s, never at 0. ENG */
    TICK_S: 10,
    /** Rolling feature window. ENG */
    WINDOW_S: 60,
    /** effective_window_s = max(10, min(60, t)). ENG */
    MIN_EFFECTIVE_WINDOW_S: 10,
    /** f_typing = clip(1 - rate/20, 0, 1). Direction [D] (F2 A5 rho=-0.37 6/6); divisor 20 ENG (like GAP_NORM_S below: maps unvalidated D2 split 10.5 to mid-scale 0.475; C1 grid {5,10,15,20} rates ABS<20 worst, T*=5 wins; Estey uses relative baselines -> declared departure, not support) */
    TYPING_ANCHOR_PER_MIN: 20,
    /** f_gap = clip(gap/40, 0, 1). [D+L] (F2 rho=+0.37 6/6); constant 40 ENG */
    GAP_NORM_S: 40,
    /** TS state: typing_rate < 5/min. Signal [D] (A5 rho -0.37, 6/6); value 5 = ENG (closest ABS grid budget to REL-z's 26 among coarse label-free grid {5,10,15,20}, but a poor match: 57 vs 26, ~2.2x overshoot; no grid point truly matches). D4 in-sample: recall 0.74 with precision 0.29-0.73, ~8-10 alerts/h */
    TS_TYPING_THRESH_PER_MIN: 5,
    /** D1 warmup; FM/E4 break through. [L] ENG (non-primary X=8min sweep arm chosen over the pre-registered primary X=5min/300s; cost 0 structurally guaranteed - 0 true alerts in first 8min, 4/6 TN) */
    WARMUP_S: 480,
    /** B2 soft gate: no alert while typing_rate >= 20/min (fail-open). [L]+ENG (fail-open timing gate from Pu 2025 / Nakada & Miura 2024; absolute 20/min cut is ENG. F4's +0.31 uplift at 4/6 was measured on a PERSON-RELATIVE typing-z>1 gate, not this absolute cut; F4 never swept an absolute threshold and F2 C1 rejected the relative rule 0/6 -> directional only) */
    B2_TYPING_PER_MIN: 20,
    /** Alert state machine. Mechanism ENG (sparsity literature-motivated, Horvitz 1999/Amershi 2019);
     * E6 re-alert NEED [D] from D4 (R1/R5: states persist through/until onset; D4 writes the 120 s
     * interval as an example "z. B. alle 120 s"). The values 120/0.1 are ENG, inherited verbatim from
     * v1 and never grid-searched; only theta was tuned. REALERT_S = COOLDOWN_S (= 120) by inheritance. */
    COOLDOWN_S: 120,
    HYSTERESIS: 0.1,
    REALERT_S: 120, // = COOLDOWN_S
    /** B4 grace after a bad-build result; suppresses FOLLOWING non-FM boundaries only. [D+L]: gate concept [L] (Assistance Dilemma, Koedinger & Aleven 2007, Dong 2021 - pause before intervening); value 32.94 = F3 median [D], low-confidence (median of n=5 per-TN medians, spread 6.2-77.1 s, LOO 22.35-38.08 s, pooled 15.1 s) */
    GRACE_S: 32.94,
    /** theta_full for the v3 2-feature substrate (typing+gap), frozen at 0.7
     *  (derived_params.json v3). Dropping the N4 feature makes the equal-weighted
     *  core mean a /2 (not /3) average, lifting the score band, so the episode-F1
     *  optimal threshold shifts up from the v2 3-feature value of 0.6. [D]
     *  grid-argmax over {0.5,0.6,0.7}; coarse grid, margin-fragile (the v2 spread
     *  was within 0.012 over n=6). */
    THETA_FULL: 0.7,
    /** FM bad deltas (failed_count > 0). Definitional taxonomy: the deterministic
     * complement of {improved} among failed builds (no sub-label discrimination ran).
     * [L] Pu 2025 (build-feedback as intervention point, exec-error 67%/0%); [D] only as
     * descriptive umbrella -- the in-sample S1 support is the STATE (build_in_flight d=1.18,
     * feedback_view +6/6), NOT delta-label membership (all per-delta shares < 5/6). */
    FM_DELTAS_BAD: ['worse', 'same-count', 'identical-set'] as const,
    /** N1 paste derivation (lives in sensing/collectors/paste.ts): clipboard-confirmed paste
     * of >= 2 lines, [L] Pu 2025 verbatim ("User pastes code that's more than 1 line", their
     * most effective trigger at 73.1%); no char minimum ([D] recorder-confirmed study pastes:
     * median 9 chars, 56% <= 11). F3 found no severity signal (boundary only).
     * DEVIATION 2026-07-02 (documented SPEC-freeze exception, approved): until then the rule
     * was `inserted length >= 11 chars OR multi-line heuristic`, mirroring the study
     * pipeline's paste_events derivation. The 11-char branch was an ENG artifact of the old
     * recorder only seeing multi-line paste triggers, and mostly caught completion false
     * positives (IntelliSense/Copilot inserts >= 11 chars). Retired; goldens are unaffected
     * (the asserted exact-replay mode INJECTS the reference's paste times - the live
     * derivation is not on the golden-pinned path). */
} as const;

/** Boundary types in audit priority order (spec §3: FM > E4 > N1 > STATE). ENG */
export const BOUNDARY_PRIORITY = ['FM', 'E4', 'N1', 'STATE'] as const;
export type BoundaryType = typeof BOUNDARY_PRIORITY[number];

/**
 * Tier-2 delivery throttle (ThrottledAlertSink), delivery-only, keyed by the
 * student's proactive-help level (Off/Less/More, spec §12.2). `Off` never reaches
 * the throttle (proactivity is gated upstream), so only `less`/`more` matter here.
 * `minDeliveryGapS` is a hard floor BETWEEN DELIVERIES and MUST NOT be conflated
 * with the SPEC detector cooldown (a Schicht-3 decision guard, 120 s). The layers
 * deliberately do NOT overlap: `more` has no delivery gap of its own (0) — the
 * decision-layer cooldown is the only spacing, the throttle contributes only the
 * session budget; `less` adds real extra spacing (600 s > COOLDOWN_S, so it bites).
 * Read LIVE on every `deliver()` call (not captured once), so a mid-session level
 * change takes effect immediately. All ENG (engineering defaults, no study data on
 * delivery cadence). */
export const THROTTLE_BY_LEVEL = {
    less: { maxAlertsPerSession: 5, minDeliveryGapS: 600 },
    more: { maxAlertsPerSession: 10, minDeliveryGapS: 0 },
};

/**
 * Version-tunable layer (MUTABLE, deliberately NOT `as const`). None of these
 * feed the golden-pinned decision — they are the unevaluated Tier-3 add-on knobs
 * (the Tier-2 delivery throttle lives in {@link THROTTLE_BY_LEVEL} above). All ENG
 * (engineering defaults), safe to re-tune per version without touching held-out F1
 * or golden parity. The user-facing controls are the proactive-egress consent and
 * the Off/Less/More level (#352), not knobs here.
 */
export const TUNING = {
    /** Tier-3 add-on (Test-Stagnation): no-progress streak length N (a build is
     *  no-progress when passed tests don't reach a new high, incl. failed builds)
     *  + production enable. No golden to break. ENG */
    testStagnationN: 3,
    enableTestStagnation: true,
    /**
     * Slot continuity knobs (spec §5 / §9 "idle watchdog + re-arm"). All ENG (provisional
     * engineering defaults; no study sweep exists yet).
     *
     * idleAbandonMs  [ENG] continuous-idle silent-free backstop. A delivered hint's slot stays
     *                occupied while the student is idle (which blocks re-hints via reconcile's
     *                `suppress`); after this much CONTINUOUS idle (reset by any progress) the
     *                slot frees silently as ABANDONED, so a walked-away slot still terminates.
     * reArmSBase     [ENG] sBase threshold the new severity must exceed for the slot to re-arm
     *                after a resolve (prevents immediate re-trigger on low-grade signals).
     * reArmHoldMs    [ENG] minimum continuous below-threshold hold before a progress-close edge
     *                (RECOVERED) fires (prevents sub-second re-trigger on fast build cycles).
     */
    slot: {
        idleAbandonMs: 600_000,     // [ENG] continuous-idle silent-free backstop (~10 min)
        warnLeadMs: 60_000,         // [ENG] Moment-3 presence-check lead before idle-abandon force-free
        reArmSBase: 0.6,            // [ENG]
        reArmHoldMs: 30_000,        // [ENG]
    },
};
