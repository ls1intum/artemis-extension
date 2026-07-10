import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';

import type { StruggleSignal } from './struggleContract';

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Build the wire StruggleSignal from a fired alert and the recent tick buffer (oldest->newest). The
 * alert's own tick is the latest buffered one (the tick fires synchronously just before the alert in
 * the same engine tick); it feeds only `sessionSeconds`.
 *
 * Edit-path alerts carry their boundary/path fields onto the wire directly. A discrete alert (the
 * test-stagnation add-on) is not boundary-shaped, so it maps to the wire-only 'TPS' boundary with
 * path='discrete'; its `urgency` (sBase at the firing tick) is carried as `severity` for telemetry
 * (the discrete decision did not threshold on it), and `inGrace` is always false (the discrete path
 * bypasses B4).
 */
export function buildStruggleSignal(alert: AlertRecord, ticks: readonly TickRecord[]): StruggleSignal {
    const alertTick = ticks.length > 0 ? ticks[ticks.length - 1] : undefined;
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
        trajectory: ticks.slice(-12).map(tk => ({ t: tk.t, s: round2(tk.sBase) })),
        sessionSeconds: alertTick?.t ?? alert.t,
    };
}
