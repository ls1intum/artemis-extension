import { describe, it, expect } from 'vitest';
import type { Annotation } from '../src/types';
import {
    STRUGGLE_RANK, RANKED_LEVELS, isStruggleLabel,
    toStruggleSeries, buildStepSegments, computeDivergenceSegments,
} from '../src/utils/raterComparison';

function ann(id: string, t: number, label: string): Annotation {
    return { id, timestamp: t, label: label as Annotation['label'], text: '', createdAt: t };
}

describe('rank constants', () => {
    it('orders confident..blocked 0..4', () => {
        expect(RANKED_LEVELS).toEqual(['confident', 'light-struggle', 'medium-struggle', 'high-struggle', 'blocked']);
        expect(STRUGGLE_RANK.confident).toBe(0);
        expect(STRUGGLE_RANK.blocked).toBe(4);
    });
    it('isStruggleLabel accepts struggle levels, rejects context/empty', () => {
        expect(isStruggleLabel('high-struggle')).toBe(true);
        expect(isStruggleLabel('reading')).toBe(false);
        expect(isStruggleLabel('')).toBe(false);
        expect(isStruggleLabel(undefined)).toBe(false);
    });
});

describe('toStruggleSeries', () => {
    it('filters non-struggle labels, sorts by time, drops empty raters', () => {
        const lanes = [
            { raterId: 'r_a', raterName: 'Alice', annotations: [
                ann('a2', 1500, 'blocked'), ann('a1', 1100, 'confident'), ann('a3', 1300, 'reading'),
            ] },
            { raterId: 'r_b', raterName: 'Bob', annotations: [ann('b1', 1200, 'idle')] }, // context only -> dropped
        ];
        const series = toStruggleSeries(lanes);
        expect(series).toHaveLength(1);
        expect(series[0].raterId).toBe('r_a');
        expect(series[0].marks.map(m => m.id)).toEqual(['a1', 'a2']); // sorted, context dropped
        expect(series[0].marks.map(m => m.rank)).toEqual([0, 4]);
        expect(typeof series[0].color).toBe('string');
    });
});

describe('buildStepSegments', () => {
    it('each mark holds until the next; last holds to domainEnd', () => {
        const series = toStruggleSeries([{ raterId: 'r_a', raterName: 'Alice', annotations: [
            ann('a1', 1100, 'confident'), ann('a2', 1500, 'blocked'),
        ] }]);
        const segs = buildStepSegments(series[0].marks, 2000);
        expect(segs).toEqual([
            { startT: 1100, endT: 1500, rank: 0, label: 'confident', mark: series[0].marks[0] },
            { startT: 1500, endT: 2000, rank: 4, label: 'blocked', mark: series[0].marks[1] },
        ]);
    });
});

describe('computeDivergenceSegments', () => {
    const domain: [number, number] = [1000, 2000];
    it('returns nothing when raters agree', () => {
        const series = toStruggleSeries([
            { raterId: 'r_a', raterName: 'A', annotations: [ann('a1', 1100, 'confident')] },
            { raterId: 'r_b', raterName: 'B', annotations: [ann('b1', 1100, 'light-struggle')] }, // spread 1 < 2
        ]);
        expect(computeDivergenceSegments(series, domain)).toEqual([]);
    });
    it('flags intervals where two raters are >=2 levels apart, merging adjacents', () => {
        const series = toStruggleSeries([
            { raterId: 'r_a', raterName: 'A', annotations: [ann('a1', 1100, 'confident'), ann('a2', 1500, 'blocked')] },
            { raterId: 'r_b', raterName: 'B', annotations: [ann('b1', 1200, 'medium-struggle')] },
        ]);
        // [1200,1500): A=0,B=2 spread2; [1500,2000): A=4,B=2 spread2 -> merged [1200,2000]
        expect(computeDivergenceSegments(series, domain)).toEqual([[1200, 2000]]);
    });
    it('needs at least two raters with a value', () => {
        const series = toStruggleSeries([
            { raterId: 'r_a', raterName: 'A', annotations: [ann('a1', 1100, 'confident'), ann('a2', 1500, 'blocked')] },
        ]);
        expect(computeDivergenceSegments(series, domain)).toEqual([]);
    });
    it('carries a pre-domain mark into the first interval', () => {
        const series = toStruggleSeries([
            { raterId: 'r_a', raterName: 'A', annotations: [ann('a1', 900, 'confident')] }, // before domain[0]
            { raterId: 'r_b', raterName: 'B', annotations: [ann('b1', 1100, 'blocked')] },
        ]);
        // [1000,1100): only A has a value -> none; [1100,2000): A=0 (carried), B=4 -> diverge
        expect(computeDivergenceSegments(series, domain)).toEqual([[1100, 2000]]);
    });
    it('counts a mark exactly at domain[0]', () => {
        const series = toStruggleSeries([
            { raterId: 'r_a', raterName: 'A', annotations: [ann('a1', 1000, 'confident')] },
            { raterId: 'r_b', raterName: 'B', annotations: [ann('b1', 1000, 'blocked')] },
        ]);
        expect(computeDivergenceSegments(series, domain)).toEqual([[1000, 2000]]);
    });
    it('a mark exactly at domain[1] opens no new interval', () => {
        const series = toStruggleSeries([
            { raterId: 'r_a', raterName: 'A', annotations: [ann('a1', 1100, 'confident'), ann('a2', 2000, 'blocked')] },
            { raterId: 'r_b', raterName: 'B', annotations: [ann('b1', 1100, 'confident')] },
        ]);
        // both agree (confident) through (1100,2000); the 2000 mark is at the edge -> no interval after it
        expect(computeDivergenceSegments(series, domain)).toEqual([]);
    });
});
