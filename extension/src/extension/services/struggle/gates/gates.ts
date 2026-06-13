// extension/src/extension/services/struggle/gates/gates.ts
/**
 * Surviving gates (spec §4); B1/N3/N9 deliberately NOT included. These are the
 * three predicates the alert state machine applies IN ITS FIXED ORDER —
 * the order lives in alerting/alertStateMachine.ts, not here.
 */
import type { BoundaryType } from '@extension/services/struggle/constants';
import { SPEC } from '@extension/services/struggle/constants';

/** B2 (soft, fail-open): no alert while typing fluently. null = no data = open. */
export function isFluentTyping(typingRate: number | null): boolean {
    return typingRate !== null && typingRate >= SPEC.B2_TYPING_PER_MIN;
}

/** B4 grace filter: inside the grace window only FM/FM+ survive (the feedback
 *  moment itself is the canonical intervention point; spec §4). */
export function applyGraceFilter(present: readonly BoundaryType[]): BoundaryType[] {
    return present.filter(k => k === 'FM' || k === 'FM_PLUS');
}

/** D1 warmup: inside warmup only FM/E4 break through (N16 conflict resolution). */
export function survivesWarmup(present: readonly BoundaryType[]): boolean {
    return present.some(k => k === 'FM' || k === 'E4');
}
