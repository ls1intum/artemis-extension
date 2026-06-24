/**
 * Severity S(t) (spec §1, v3 2-feature substrate): equal-weighted core mean
 * (f_typing, f_gap) plus capped context bonuses. The v2 N4 feature was dropped,
 * so the mean is over 2 features, not 3. Weights are frozen engineering choices
 * motivated by near-equal mixed-model betas; see constants.ts.
 */
import { SPEC } from '@extension/services/struggle/config';

export function severityFrom(
    core: { fTyping: number; fGap: number },
    bonuses: { fFb: 0 | 1; fA8: 0 | 1; fN2: 0 | 1 },
): { sBase: number; s: number } {
    const sBase = (core.fTyping + core.fGap) / 2;
    const s = Math.min(1, sBase + SPEC.W_FB * bonuses.fFb + SPEC.W_A8 * bonuses.fA8 + SPEC.W_N2 * bonuses.fN2);
    return { sBase, s };
}
