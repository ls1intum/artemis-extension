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
    /** f_typing = clip(1 - rate/20, 0, 1). [D+L] (F2 rho=-0.37 6/6; absolute scale vs Estey declared [D]) */
    TYPING_ANCHOR_PER_MIN: 20,
    /** f_gap = clip(gap/40, 0, 1). [D+L] (F2 rho=+0.37 6/6); constant 40 ENG */
    GAP_NORM_S: 40,
    /** f_n4 = clip(ratio/10, 0, 1); N4 state at ratio >= 10. [D] (F2 rho=+0.35 6/6; threshold from D4) */
    N4_RATIO_THRESH: 10,
    /** TS state: typing_rate < 5/min. [D] (D4 TS recall 0.74) */
    TS_TYPING_THRESH_PER_MIN: 5,
    /** A8 region persistence: >= 80 % of changes of the last 5 min in one method, >= 30 changes. [D+L] weak */
    A8_WINDOW_S: 300,
    A8_MIN_CHANGES: 30,
    A8_SHARE: 0.8,
    /** N2: error > 3 lines from cursor, continuously active > 60 s. [D] weak */
    N2_DIST_LINES: 3,
    N2_MIN_ACTIVE_S: 60,
    /** Severity bonuses. ENG (weights), motivated by near-equal MM betas [D] */
    W_FB: 0.25,
    W_A8: 0.15,
    W_N2: 0.10,
    /** V(t) half-lives. hl=120 [D] descriptive (S3), value ENG; fast 30 s after improved build [D+L] (S3: ~36 s) */
    HL_DEFAULT_S: 120,
    HL_FAST_S: 30,
    FAST_DECAY_MAX_S: 120,
    /** D1 warmup; FM/E4 break through. [L] ENG (tested value with cost 0 on derivation set) */
    WARMUP_S: 480,
    /** B2 soft gate: no alert while typing_rate >= 20/min (fail-open). [D+L] (F4 uplift +0.31 at 4/6) */
    B2_TYPING_PER_MIN: 20,
    /** Alert state machine. ENG (sparsity literature-motivated); E6 interval need [D] from D4 */
    COOLDOWN_S: 120,
    HYSTERESIS: 0.1,
    REALERT_S: 120,
    /** B4 grace after a bad-build result; suppresses FOLLOWING non-FM boundaries only. Value = F3 median [D] */
    GRACE_S: 32.94,
    /** theta_full, frozen via episode-F1 grid {0.5, 0.6, 0.7} on the derivation set (median F1 0.4396). [D] */
    THETA_FULL: 0.6,
    /** FM bad deltas (failed_count > 0). [D+L] */
    FM_DELTAS_BAD: ['worse', 'same-count', 'identical-set'] as const,
    /** N1 long-insert threshold ("Textlaenge > 10"); lives in sensing/collectors/paste.ts as PASTE_LONG_MIN_CHARS. */
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
