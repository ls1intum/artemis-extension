import { SPEC } from '@extension/services/struggle/config';
import type { AlertRecord, FeatureVector, TickRecord } from '@extension/services/struggle/types';

import type { ComponentName, StruggleSignal } from './struggleContract';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Each component's raw value + its contribution to severity s (core fX/2, bonus W_X·fX).
 *  v3's equal-weighted core is (fTyping+fGap)/2 (the N4 feature was dropped, so it is a /2 mean,
 *  NOT the v2 /3), so each core component contributes fX/2 — using the old /3 here understates
 *  typing+gap relative to the bonus weights and can mis-rank `dominantComponents`. The `n4`
 *  component is never emitted (the wire `ComponentName` keeps it for backward compatibility). */
function componentContributions(f: FeatureVector): Array<{ name: ComponentName; value: number; contribution: number }> {
    return [
        { name: 'typing', value: f.fTyping, contribution: f.fTyping / 2 },
        { name: 'gap', value: f.fGap, contribution: f.fGap / 2 },
        { name: 'feedbackViewing', value: f.fFb, contribution: SPEC.W_FB * f.fFb },
        { name: 'regionPersistence', value: f.fA8, contribution: SPEC.W_A8 * f.fA8 },
        { name: 'errorDistance', value: f.fN2, contribution: SPEC.W_N2 * f.fN2 },
    ];
}

/**
 * Build the wire StruggleSignal from a fired alert and the recent tick buffer (oldest->newest). The
 * alert's own FeatureVector is the latest buffered tick (the tick fires synchronously just before the
 * alert in the same engine tick). Returns the 3 highest-contribution components with their raw values.
 *
 * Edit-path alerts carry their boundary/path fields onto the wire directly. A discrete alert (the
 * test-stagnation add-on) is not boundary-shaped, so it maps to the wire-only 'TPS' boundary with
 * path='discrete'; its `urgency` (sBase at the firing tick) is carried as `severity` for telemetry
 * (the discrete decision did not threshold on it), and `inGrace` is always false (the discrete path
 * bypasses B4).
 */
export function buildStruggleSignal(alert: AlertRecord, ticks: readonly TickRecord[]): StruggleSignal {
    const alertTick = ticks.length > 0 ? ticks[ticks.length - 1] : undefined;
    const dominantComponents = alertTick
        ? componentContributions(alertTick.features)
            .filter(c => c.contribution > 0)
            .sort((a, b) => b.contribution - a.contribution)
            .slice(0, 3)
            .map(c => ({ name: c.name, value: round2(c.value) }))
        : [];
    const alertBlock = alert.kind === 'edit'
        ? {
            tSessionS: alert.t,
            primaryBoundary: alert.primary,
            boundaryTypes: [...alert.types],
            // The decision signal sBase at the firing tick.
            severity: round2(alert.urgency),
            path: alert.path,
            inWarmup: alert.inWarmup,
            inGrace: alert.inGrace,
        }
        : {
            tSessionS: alert.t,
            primaryBoundary: 'TPS' as const,
            boundaryTypes: ['TPS' as const],
            severity: round2(alert.urgency),
            path: 'discrete' as const,
            inWarmup: alert.inWarmup,
            inGrace: false,
        };
    return {
        alert: alertBlock,
        trajectory: ticks.slice(-12).map(tk => ({ t: tk.t, s: round2(tk.s) })),
        dominantComponents,
        sessionSeconds: alertTick?.t ?? alert.t,
    };
}
