import { describe, expect, it } from 'vitest';

import type { AlertRecord, FeatureVector, TickRecord } from '@extension/services/struggle/types';
import { buildStruggleSignal } from '@extension/services/struggleIntervention/buildStruggleSignal';
import { emptyDecisionTrace, tickRecord } from '@test/__shared__/tickRecordFixture';

function features(over: Partial<FeatureVector>): FeatureVector {
    return {
        t: 0, effectiveWindowS: 10, nOneCharInserts: 0, typingRate: 0, longestGapS: 0,
        fTyping: 0, fGap: 0, tsState: false, ...over,
    };
}
function tick(t: number, sBase: number, f: FeatureVector): TickRecord {
    return { t, ts: t * 1000, features: f, sBase, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace };
}

describe('buildStruggleSignal', () => {
    it('maps alert + ticks to the wire signal', () => {
        const f = features({ fTyping: 0.9, fGap: 0.3 });
        const ticks: TickRecord[] = [tick(520, 0.5, features({})), tick(530, 0.7, f)];
        const alert: AlertRecord = { kind: 'edit', t: 530, ts: 530000, urgency: 0.72, typesPreGate: ['FM'], types: ['FM', 'STATE'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false };

        const sig = buildStruggleSignal(alert, ticks);

        expect(sig.alert.tSessionS).toBe(530);
        expect(sig.alert.primaryBoundary).toBe('FM');
        expect(sig.alert.boundaryTypes).toEqual(['FM', 'STATE']);
        expect(sig.alert.severity).toBeCloseTo(0.72, 2);
        expect(sig.trajectory).toHaveLength(2);
        expect(sig.trajectory[0]).toMatchObject({ t: 520 });
        expect(sig.sessionSeconds).toBe(530);
    });

    it('tolerates an empty tick buffer (sessionSeconds from alert)', () => {
        const alert: AlertRecord = { kind: 'edit', t: 100, ts: 100000, urgency: 0.5, typesPreGate: ['N1'], types: ['N1'], primary: 'N1', path: 'armed', inWarmup: true, inGrace: false };
        const sig = buildStruggleSignal(alert, []);
        expect(sig.trajectory).toEqual([]);
        expect(sig.sessionSeconds).toBe(100);
    });

    it('maps a discrete test-stagnation alert to the TPS wire boundary with path=discrete', () => {
        const f = features({ fTyping: 0.6, fGap: 0.2 });
        const ticks: TickRecord[] = [tick(520, 0.3, features({})), tick(530, 0.4, f)];
        const alert: AlertRecord = { kind: 'discrete', t: 530, ts: 530000, urgency: 0.41, trigger: 'test-stagnation', inWarmup: true };

        const sig = buildStruggleSignal(alert, ticks);

        expect(sig.alert.primaryBoundary).toBe('TPS');
        expect(sig.alert.boundaryTypes).toEqual(['TPS']);
        // urgency (sBase at the firing tick) is carried as severity for telemetry.
        expect(sig.alert.severity).toBeCloseTo(0.41, 2);
        expect(sig.alert.path).toBe('discrete');
        expect(sig.alert.inWarmup).toBe(true);
        // The discrete path bypasses B4, so inGrace is always false on the wire.
        expect(sig.alert.inGrace).toBe(false);
        // Trajectory comes from the tick buffer exactly as for edit alerts.
        expect(sig.trajectory).toHaveLength(2);
        expect(sig.sessionSeconds).toBe(530);
    });

    it('trajectory carries rounded sBase', () => {
        const ticks: TickRecord[] = [
            tickRecord({ t: 10, sBase: 0.4 }),
            tickRecord({ t: 20, sBase: 0.512 }),
        ];
        const alert: AlertRecord = { kind: 'edit', t: 20, ts: 20000, urgency: 0.512, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false };

        const sig = buildStruggleSignal(alert, ticks);

        expect(sig.trajectory).toEqual([
            { t: 10, s: 0.4 },
            { t: 20, s: 0.51 },
        ]);
    });
});
