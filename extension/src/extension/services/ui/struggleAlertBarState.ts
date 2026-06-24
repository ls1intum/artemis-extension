import type { TickRecord } from '@extension/services/struggle/types';

export type AlertBarKind = 'firing' | 'gated' | 'armed';

export interface AlertBarState {
    kind: AlertBarKind;
    /** Live decision-signal urgency (S_base) for this tick. */
    urgency: number;
    /** Alert threshold θ for this tick. */
    theta: number;
    /** Suppressing-gate reason code; present only when kind === 'gated'. */
    gateReason?: string;
}

/**
 * Decision reasons that suppress an otherwise-ready alert. These only become the
 * decisive reason once a boundary moment exists, so reaching one means "there was
 * a trigger moment, but this gate held the nudge back". `below-threshold` and
 * `no-candidate` are deliberately excluded: the first means urgency was too low
 * (not a would-fire), the second means there was no trigger at all.
 */
const SUPPRESSING_GATES = new Set<string>([
    'b2-fluent-typing', 'b4-grace-filter', 'd1-warmup', 'cooldown', 'not-rearmed',
]);

/**
 * Classify a tick for the developer alert status bar:
 *  - 'firing': the engine produced a real alert this tick (all gates passed).
 *  - 'gated':  urgency is already at/above θ at a boundary moment, but a gate held
 *              the nudge back, so it WOULD have fired.
 *  - 'armed':  neither (calm, below threshold, or no boundary candidate).
 *
 * Reads only fields already on every TickRecord; no engine change required.
 */
export function computeAlertBarState(tick: TickRecord): AlertBarState {
    const theta = tick.decisionTrace.theta;
    const urgency = tick.sBase;
    if (tick.alert !== null) {
        return { kind: 'firing', urgency, theta };
    }
    if (urgency >= theta && SUPPRESSING_GATES.has(tick.decisionTrace.reason)) {
        return { kind: 'gated', urgency, theta, gateReason: tick.decisionTrace.reason };
    }
    return { kind: 'armed', urgency, theta };
}
