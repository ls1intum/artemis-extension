/**
 * Severity S(t) (spec §1): equal-weighted core mean plus capped context
 * bonuses. Weights are frozen engineering choices motivated by near-equal
 * mixed-model betas; see constants.ts.
 */
import { SPEC } from '@extension/services/struggle/constants';

export function severityFrom(
    core: { fTyping: number; fGap: number; fN4: number },
    bonuses: { fFb: 0 | 1; fA8: 0 | 1; fN2: 0 | 1 },
): { sBase: number; s: number } {
    const sBase = (core.fTyping + core.fGap + core.fN4) / 3;
    const s = Math.min(1, sBase + SPEC.W_FB * bonuses.fFb + SPEC.W_A8 * bonuses.fA8 + SPEC.W_N2 * bonuses.fN2);
    return { sBase, s };
}
