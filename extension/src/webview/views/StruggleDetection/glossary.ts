/**
 * Glossary module: single source of truth for every label, code, and tooltip
 * used in the live engine view. Every symbol rendered in the UI must read its
 * displayed text from here so wording never drifts.
 *
 * Enforcement: `GLOSSARY` is typed as `Record<GlossaryKey, ...>`, so a missing
 * key is a compile error.
 */
// Webview (browser) code must read shared shapes from @shared, never from the
// extension-host layer. The shared LiveDecisionTrace mirrors the engine's
// EditTraceReason / BoundaryType unions exactly (kept in lock-step by the
// boundary-type parity guard), so these are the authoritative wire types here.
import type { BoundaryType, LiveDecisionTrace } from '@shared/messageContracts';

/** Decision-reason union, as carried on the wire (mirrors the engine's EditTraceReason). */
export type EditTraceReason = LiveDecisionTrace['reason'];

/**
 * Union of every key that the live view needs a label/tooltip for:
 *   - boundary codes (FM, FM_PLUS, E4, N1, STATE)
 *   - decision reasons (EditTraceReason)
 *   - the discrete trigger (test-stagnation)
 *   - metric names (urgency, s, v, theta, fastDecay)
 */
export type GlossaryKey =
    | BoundaryType
    | EditTraceReason
    | 'test-stagnation'
    | 'urgency'
    | 's'
    | 'v'
    | 'theta'
    | 'fastDecay';

export interface GlossaryEntry {
    /** Fully spelled-out primary text shown in the UI. For numbers, includes unit and range. */
    readonly text: string;
    /** Small internal code, shown only as a secondary developer tag. */
    readonly code: string;
    /** Extra detail shown on hover/focus. */
    readonly tooltip?: string;
    /** Short label for the decision-gate pipeline list (set only on the six gate reasons). */
    readonly gate?: string;
    /** Very short label for compact UI (the decision-flow pipeline stage boxes); boundaries only. */
    readonly short?: string;
}

/**
 * Exhaustive glossary. Because this is `Record<GlossaryKey, ...>`, TypeScript
 * will refuse to compile if any key from the union is missing.
 *
 * FM+ semantics (verified against signals/buildDelta.ts):
 *   isFMPlus = delta === 'improved' && hasFailed
 *   i.e. the build improved (fewer failing tests than the previous run) but
 *   still has at least one failing test. The spec's glossary table says "worse
 *   than the one before", which contradicts the code; the code is authoritative.
 *
 * STATE semantics (verified against signals/featureWindow.ts + boundaries/boundaryTracker.ts):
 *   tsState = typingRate < 5 keystrokes/min (TS_TYPING_THRESH_PER_MIN)
 *   STATE is present at every tick where tsState is true AND the tick is past the
 *   warmup period. It represents very low typing activity, not a discrete pause event.
 */
export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
    // ── Boundaries ──────────────────────────────────────────────────────────

    FM: {
        text: 'A build or test run just failed',
        code: 'FM',
        short: 'Build failed',
        tooltip: 'The canonical moment to offer help. Fires on compile errors, on a first build with failures, or on builds whose failure set is unchanged or larger.',
    },

    FM_PLUS: {
        text: 'A build just improved but still has failing tests',
        code: 'FM+',
        short: 'Build improved',
        tooltip: 'Fewer tests are failing than in the previous run, but at least one test is still failing. The student made progress yet still needs support.',
    },

    E4: {
        text: 'A terminal command just finished running',
        code: 'E4',
        short: 'Terminal finished',
        tooltip: 'For example, a manually started run or script execution outside the Artemis build pipeline.',
    },

    N1: {
        text: 'A large or multi-line paste was just detected',
        code: 'N1',
        short: 'Large paste',
        tooltip: 'A paste of 11 or more characters was inserted at once, which may indicate copying from an external source.',
    },

    STATE: {
        text: 'Typing rate is very low right now (fewer than 5 keystrokes per minute)',
        code: 'STATE',
        short: 'Low typing rate',
        tooltip: 'Present at every tick (after warm-up) where the 1-minute rolling typing rate stays below 5 keystrokes/min. Indicates prolonged low activity, idle, or stuck.',
    },

    // ── Decision reasons (EditTraceReason) ──────────────────────────────────

    fired: {
        text: 'An alert fired this tick: the engine decided to nudge',
        code: 'fired',
        tooltip: 'Urgency was above the threshold, a boundary was pending, and no gate suppressed the alert.',
    },

    'no-candidate': {
        text: 'No boundary event was pending this tick, so no nudge was possible',
        code: 'no-candidate',
        tooltip: 'The engine only alerts at boundary moments (FM, FM+, E4, N1, STATE). Without a pending boundary there is nothing to alert on.',
    },

    'b2-fluent-typing': {
        text: 'Not nudging because you are typing fluently right now',
        code: 'B2',
        gate: 'Fluent typing',
        tooltip: 'The B2 gate suppresses alerts when typing speed is at or above 20 keystrokes/min. Fail-open: if the typing rate is unknown, this gate does not block.',
    },

    'b4-grace-filter': {
        text: 'Not nudging: inside the short grace window just after a failed build, where only build-related moments may nudge',
        code: 'B4',
        gate: 'Post-build grace window',
        tooltip: 'After a bad build result, non-FM/FM+ boundaries are suppressed for ~33 s so the FM moment itself is the primary intervention point.',
    },

    'd1-warmup': {
        text: 'Not nudging: still in the exercise warm-up period, where only a build that failed without improving, or a finished terminal run, may nudge',
        code: 'D1',
        gate: 'Exercise warm-up',
        tooltip: 'For the first 8 minutes of a session the engine stays quiet on most signals. FM and E4 boundaries can break through warmup.',
    },

    'below-threshold': {
        text: 'Not nudging: urgency has not reached the alert threshold yet',
        code: 'below-threshold',
        gate: 'Urgency below threshold',
        tooltip: 'Urgency (S_base) is below the θ = 0.70 threshold. The student is not struggling enough yet for a nudge to be warranted.',
    },

    cooldown: {
        text: 'Not nudging: cooling down after a recent nudge',
        code: 'cooldown',
        gate: 'Cooldown after a nudge',
        tooltip: 'A minimum of 120 s must pass between alerts to avoid over-interrupting. The engine waits out the cooldown before re-alerting.',
    },

    'not-rearmed': {
        text: 'Not nudging yet: urgency has not stayed above the threshold long enough',
        code: 'not-rearmed',
        gate: 'Re-arm hysteresis',
        tooltip: 'Hysteresis / over-θ-span gate (E6): after the cooldown expires the engine requires the urgency to stay elevated before re-arming for a new alert. Prevents hair-trigger re-alerting.',
    },

    // ── Discrete trigger ────────────────────────────────────────────────────

    'test-stagnation': {
        text: 'Tests are stuck: no new high in the passing-test count across several builds (staying flat, regressing, or failing the build all count)',
        code: 'test-stagnation',
        tooltip: 'Fires when N consecutive builds fail to beat the best passing-test count seen so far (default N = 3); staying flat, regressing, or failing the build all count as no progress. Bypasses warm-up; only the cooldown gate applies.',
    },

    // ── Metrics ─────────────────────────────────────────────────────────────

    urgency: {
        text: 'Current struggle severity right now, 0.00–1.00 (0 = none … 1 = severe)',
        code: 'urgency',
        tooltip: 'S_base: the live threshold signal for this single 10-second moment, computed as the average of the typing-deficit score and the longest-gap score. The alert threshold θ is checked against exactly this number.',
    },

    s: {
        text: 'Raw per-moment severity signal, 0.00–1.00',
        code: 's',
        tooltip: 'The unsmoothed severity that feeds the smoothed level V(t) below. Includes bonus weight for active feedback errors, A8 method-persistence, and N2 distant-error signals.',
    },

    v: {
        text: 'Smoothed struggle level over time with memory and decay, 0.00–1.00',
        code: 'v',
        tooltip: 'V(t): severity carried across time with exponential decay (half-life 120 s; 30 s after an improved build). Shown for context: the alert threshold does NOT use this value.',
    },

    theta: {
        text: 'Alert threshold: urgency must reach or exceed this before a nudge is considered (currently 0.70)',
        code: 'theta',
        tooltip: 'θ = 0.70, frozen from the v3 grid search. Drawn as a horizontal line on the urgency curve.',
    },

    fastDecay: {
        text: 'Recent-improvement damping is currently active',
        code: 'fastDecay',
        tooltip: 'After a build that improved the result, V(t) decays faster (half-life 30 s instead of 120 s) for up to 120 s. The urgency curve will drop more quickly during this window.',
    },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the fully spelled-out text for an `EditTraceReason`.
 * Useful for rendering the decision-trace panel without having to index GLOSSARY directly.
 */
export function reasonText(reason: EditTraceReason): string {
    return GLOSSARY[reason].text;
}

/**
 * Returns `{ text, code }` for a `BoundaryType` code.
 * Useful for boundary marker tooltips on the urgency curve.
 */
export function boundaryText(code: BoundaryType): { text: string; code: string } {
    const entry = GLOSSARY[code];
    return { text: entry.text, code: entry.code };
}

/**
 * Returns the fully spelled-out text for a discrete trigger.
 * Currently only `'test-stagnation'` exists.
 */
export function discreteText(trigger: 'test-stagnation'): string {
    return GLOSSARY[trigger].text;
}
