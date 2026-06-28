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

/** Human label per suppressing-gate reason, for the "gated: X" text. */
const GATE_LABEL: Record<string, string> = {
    'b2-fluent-typing': 'fluent typing',
    'b4-grace-filter': 'grace window',
    'd1-warmup': 'warm-up',
    'cooldown': 'cooldown',
    'not-rearmed': 're-arm',
};

/** Status-bar presentation for a tick. `background` is a theme-key hint the view maps to a
 *  vscode.ThemeColor (kept vscode-free so this stays unit-testable). */
export interface AlertBarDisplay {
    text: string;
    tooltip: string;
    background: 'error' | 'warning' | null;
}

/** Seconds → "M:SS" (ceil, so a countdown stays at 1 until it truly hits 0). */
function mmss(totalSeconds: number): string {
    const s = Math.max(0, Math.ceil(totalSeconds));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/**
 * Build the status-bar text/tooltip/background for a classified tick + the warm-up countdown.
 *
 * firing/gated text is NEVER altered by warm-up: real FM/E4 alerts break through the warm-up gate
 * and must stay visible. Only the 'armed' branch swaps to a "warm-up M:SS" readout while
 * `warmupRemainingS > 0`, and every tooltip notes the warm-up time remaining while it lasts.
 * The countdown is driven by tick time (warmupS − tick.t), not wall-clock, so it never reads 0:00
 * before the engine's first post-warm-up tick.
 */
export function formatAlertBar(state: AlertBarState, warmupRemainingS: number): AlertBarDisplay {
    const u = state.urgency.toFixed(2);
    const th = state.theta.toFixed(2);
    const inWarmup = warmupRemainingS > 0;
    const warmupNote = inWarmup ? ` Warm-up: ${mmss(warmupRemainingS)} remaining (only FM/E4 alerts break through).` : '';
    const click = ' Click to open the live engine view.';
    switch (state.kind) {
        case 'firing':
            return {
                text: '$(megaphone) Struggle alert',
                background: 'error',
                tooltip: `An alert is firing right now (urgency ${u}, θ ${th}). The student would be nudged.${warmupNote}${click}`,
            };
        case 'gated': {
            const gate = (state.gateReason && GATE_LABEL[state.gateReason]) || 'a gate';
            return {
                text: `$(shield) Alert gated: ${gate}`,
                background: 'warning',
                tooltip: `The engine would alert (urgency ${u}, θ ${th}) but the ${gate} gate is holding it back.${warmupNote}${click}`,
            };
        }
        case 'armed':
        default:
            if (inWarmup) {
                return {
                    text: `$(pulse) Struggle: warm-up ${mmss(warmupRemainingS)}`,
                    background: null,
                    tooltip: `Struggle engine warming up: ${mmss(warmupRemainingS)} remaining (only FM/E4 alerts break through). Urgency ${u} (alert at θ ${th}).${click}`,
                };
            }
            return {
                text: `$(pulse) Struggle: ${u}`,
                background: null,
                tooltip: `Struggle engine monitoring. Urgency ${u} (alert at θ ${th}).${click}`,
            };
    }
}
