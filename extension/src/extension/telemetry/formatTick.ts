// extension/src/extension/telemetry/formatTick.ts
import type { StruggleDebugSnapshot } from '@shared/messageContracts';

import { SPEC } from '@extension/services/struggle/config';
import type { TickRecord } from '@extension/services/struggle/types';

/** boolean → '1'/'0' for a compact, greppable gate flag. */
const flag = (on: boolean): string => (on ? '1' : '0');

/**
 * Phase B tail for the per-tick line: the timers/counters that need ms anchors the tick alone does
 * not carry (delivery throttle, B4 grace, fN2). All "remaining" values are derived here from the
 * snapshot's absolute anchors against its own `nowMs`, so the log matches what the dashboard renders.
 */
function phaseBSegment(snap: StruggleDebugSnapshot): string {
    const now = snap.nowMs;
    const tr = snap.throttle;
    let throttle: string;
    if (tr === null) {
        throttle = 'throttle[n/a]';
    }
    else {
        // ceil for "time remaining" (shows 1 until truly elapsed) — matches the dashboard's mmss/ceil.
        const gap = tr.lastDeliveryMs === null
            ? '–'
            : `${Math.max(0, Math.ceil(tr.minDeliveryGapS - (now - tr.lastDeliveryMs) / 1000))}s`;
        throttle = `throttle[sess=${tr.deliveredThisSession}/${tr.maxAlertsPerSession} gap=${gap}]`;
    }
    const grace = snap.lastFmBadMs === null
        ? '–'
        : `${Math.max(0, Math.ceil(snap.caps.graceS - (now - snap.lastFmBadMs) / 1000))}s`;
    return ` | ${throttle} grace=${grace} fN2=${snap.fN2Active ? 'active' : 'clear'}`;
}

/**
 * One compact, greppable developer-mode line for a single engine tick. It carries enough to
 * reconstruct WHY an alert did/did not fire from the [Struggle] channel ALONE (the primary debug
 * surface today): the urgency-vs-θ decision + reason, the full severity decomposition (urgency =
 * sBase = (fTyping + fGap) / 2; `s` adds the capped fb/a8/n2 bonuses, which only lift telemetry,
 * never urgency), the boundary set, every gate's live condition, and the warmup/cooldown countdowns
 * that are derivable from the tick itself. (Phase B appends the throttle, B4-grace, and fN2 timers
 * once the debug-snapshot plumbing lands — those need ms anchors the tick does not carry.)
 *
 * Pass the optional debug `snap` (Phase B) to append the throttle, B4-grace, and fN2 timers that
 * need ms anchors the tick alone does not carry; omit it for the Phase-A-only line.
 *
 * Pure + vscode-free so it is unit-testable and so the clean Open VSX build (which aliases the
 * `@telemetry` entry to ./noop and never reaches this module) stays leak-free.
 */
export function formatTick(t: TickRecord, snap?: StruggleDebugSnapshot): string {
    const d = t.decisionTrace;
    const f = t.features;
    const g = d.gates;

    // Decision + why it landed there: the edit-path suppression reason, or the discrete trigger.
    let outcome: string = d.outcome;
    if (d.outcome === 'suppressed') {
        outcome += ` (${d.reason})`;
    }
    else if (d.outcome === 'fired-discrete' && d.discreteTrigger) {
        outcome += ` (${d.discreteTrigger})`;
    }

    const boundaries = d.boundariesPresent.length > 0 ? d.boundariesPresent.join('+') : '–';
    const typing = d.typingRate === null ? '–' : `${Math.round(d.typingRate)}`;

    // Severity decomposition. urgency thresholds on sBase = (fTyping + fGap) / 2; the fb/a8/n2 bonuses
    // only lift `s` (telemetry), never the urgency the decision reads.
    const sev = `sev[typ=${f.fTyping.toFixed(2)} gap=${f.fGap.toFixed(2)}`
        + ` fb=${f.fFb.toFixed(2)} a8=${f.fA8.toFixed(2)} n2=${f.fN2.toFixed(2)}]`;

    // Every gate's live condition (1 = engaged/blocking). B2 fluent-typing, B4 grace, D1 warmup,
    // urgency-below-θ, post-alert cooldown, machine-not-rearmed.
    const gates = `gates[B2:${flag(g.fluentTyping)} B4:${flag(g.grace)} warmup:${flag(g.warmup)}`
        + ` below:${flag(g.belowThreshold)} cd:${flag(g.cooldown)} rearm:${flag(g.notRearmed)}]`;

    // Countdowns derivable from the tick alone (10 s granularity). Cooldown is only meaningful once an
    // alert has fired (secondsSinceLastAlert is +Inf until then).
    const warmupLeft = Math.max(0, SPEC.WARMUP_S - t.t);
    const cooldownLeft = Number.isFinite(d.secondsSinceLastAlert)
        ? `${Math.max(0, Math.ceil(SPEC.COOLDOWN_S - d.secondsSinceLastAlert))}s`
        : '–';

    return `tick t=${t.t}s urgency=${d.urgency.toFixed(2)}/θ${d.theta.toFixed(2)} → ${outcome}`
        + ` | sBase=${t.sBase.toFixed(2)} s=${t.s.toFixed(2)} ${sev}`
        + ` | typing=${typing}/min gap=${f.longestGapS.toFixed(0)}s/${SPEC.GAP_NORM_S} win=${f.effectiveWindowS}s`
        + ` | boundaries=[${boundaries}]`
        + ` | ${gates}`
        + ` | warmup=${warmupLeft}s cd=${cooldownLeft}`
        + (snap ? phaseBSegment(snap) : '');
}
