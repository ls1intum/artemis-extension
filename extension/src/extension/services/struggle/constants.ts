// extension/src/extension/services/struggle/constants.ts
/**
 * Frozen Engine-v2 parameters (ENGINE_V2_SPEC.md Rev 3.1; derived_params.json
 * v2_spec_constants, frozen 2026-06-12 on the derivation set P2/P4/P5/P6/P8/P10).
 * NOTHING here may be re-tuned — the held-out evaluation (episode F1 0.42 vs
 * 0.00 for v1) is only valid for exactly these values.
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
    /** f_n4 = clip(ratio/10, 0, 1); N4 state at ratio >= 10. Feature/sign [D] (F2 rho=+0.35 6/6; beats A10 6/6). Value 10 + the /10 divisor ENG: a-priori Task-Vorgabe, D4 only confirmed it (recall 0.52, no sweep), did not produce it; same 10 serves as state-threshold AND severity-norm divisor, D4 validated only the binary use. */
    N4_RATIO_THRESH: 10,
    /** TS state: typing_rate < 5/min. Signal [D] (A5 rho -0.37, 6/6); value 5 = ENG (closest ABS grid budget to REL-z's 26 among coarse label-free grid {5,10,15,20}, but a poor match: 57 vs 26, ~2.2x overshoot; no grid point truly matches). D4 in-sample: recall 0.74 with precision 0.29-0.73, ~8-10 alerts/h */
    TS_TYPING_THRESH_PER_MIN: 5,
    /** A8 region persistence: >= 80 % of changes of the last 5 min in one method, >= 30 changes. [D] weak (F1 enrichment 1.10, CI [0.89,1.35] crosses 1, 5/6 TN; lead NEGATIVE -197.9 s = flags ongoing, not incipient; loose collapses to 0.98). 300/30/0.8 hand-set, no sweep. [L] dropped: no paper defines this same-method edit-persistence construct (Jadud=compilation pairs, Watson=error-resolution-time); conceptual analogy only, parameters not from literature. */
    A8_WINDOW_S: 300,
    A8_MIN_CHANGES: 30,
    A8_SHARE: 0.8,
    /** N2: error > 3 lines from cursor, continuously active > 60 s. ENG (both values: 3 a-priori, no sweep; 60 s has zero analysis); feature direction weak-conditional [D] (S5 primary endpoint Cliff's d 0.14, 4/6, fails 5/6 bar, CI crosses 0) */
    N2_DIST_LINES: 3,
    N2_MIN_ACTIVE_S: 60,
    /** Severity bonuses. ENG (weights); spread tracks S1 pre-onset strength (f_fb d=1.29 +6/6), NOT MM betas (where f_fb beta 0.166 is the lowest of the 3; A8/N2 not in MM); A8/N2 kept small per their weak/conditional support; no weight-sensitivity check exists */
    W_FB: 0.25,
    W_A8: 0.15,
    W_N2: 0.10,
    /** V(t) half-lives. hl=120 [D] descriptive (S3), value 120 ENG; fast 30 s after improved build: pattern [D+L] (S3 ~36 s 6/6; convergent w/ EQ/RED reset, Jadud/Becker), value 30 ENG (rounded down from 36 s) */
    HL_DEFAULT_S: 120,
    HL_FAST_S: 30,
    FAST_DECAY_MAX_S: 120,
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
    /** theta_full, grid-argmax over episode-F1 {0.5, 0.6, 0.7} on the derivation set (median F1 0.4396 vs 0.5->0.4279 / 0.7->0.4037). [D] but margin-fragile: 0.6-vs-0.5 only 0.0117 over n=6, pooled F1 tied 0.44 across all three theta; held-out run tests 0.6 only. Coarse grid. */
    THETA_FULL: 0.6,
    /** FM bad deltas (failed_count > 0). Definitional taxonomy: the deterministic
     * complement of {improved} among failed builds (no sub-label discrimination ran).
     * [L] Pu 2025 (build-feedback as intervention point, exec-error 67%/0%); [D] only as
     * descriptive umbrella -- the in-sample S1 support is the STATE (build_in_flight d=1.18,
     * feedback_view +6/6), NOT delta-label membership (all per-delta shares < 5/6). */
    FM_DELTAS_BAD: ['worse', 'same-count', 'identical-set'] as const,
    /** N1 long-insert threshold (PASTE_LONG_MIN_CHARS = 11, i.e. inserted text >= 11 chars); lives in sensing/collectors/paste.ts. Hardcoded engineering cutoff, NOT in derived_params.json. ENG (value); boundary use [L] (Pu 2025 multi-line); F3 found no severity signal. */
} as const;

/** Boundary types in audit priority order (spec §3: FM > FM+ > E4 > N1 > STATE). ENG */
export const BOUNDARY_PRIORITY = ['FM', 'FM_PLUS', 'E4', 'N1', 'STATE'] as const;
export type BoundaryType = typeof BOUNDARY_PRIORITY[number];

/**
 * Intake debounces mirroring the recorder (ObservationRegistry.SELECTION_DEBOUNCE_MS /
 * VISIBLE_RANGE_DEBOUNCE_MS): the frozen feature derivations ran on the recorder's
 * debounced streams, so the live engine must see the same stream shape. struggle/
 * must not import recording/ (clean bundle), hence the duplicated values; a unit
 * parity test asserts equality (test/unit/services/struggle/debounceParity.test.ts).
 */
export const SELECTION_DEBOUNCE_MS = 200;
export const VISIBLE_RANGE_DEBOUNCE_MS = 300;
