import type { Annotation, StruggleLevel } from '../types';
import { raterLaneColor } from './raterColor';

export const RANKED_LEVELS: StruggleLevel[] = [
    'confident', 'light-struggle', 'medium-struggle', 'high-struggle', 'blocked',
];

export const STRUGGLE_RANK: Record<StruggleLevel, number> = {
    'confident': 0, 'light-struggle': 1, 'medium-struggle': 2, 'high-struggle': 3, 'blocked': 4,
};

const STRUGGLE_SET = new Set<string>(RANKED_LEVELS);

export function isStruggleLabel(label: string | undefined): label is StruggleLevel {
    return label != null && STRUGGLE_SET.has(label);
}

export interface Mark {
    id: string;
    t: number;          // absolute timestamp (ms)
    rank: number;       // 0..4
    label: StruggleLevel;
    text: string;
}

export interface RaterSeries {
    raterId: string;
    raterName: string;
    color: string;      // rater color (raterLaneColor)
    marks: Mark[];      // ascending by t
}

export interface RaterLaneInput {
    raterId: string;
    raterName: string;
    annotations: Annotation[];
}

export function toStruggleSeries(lanes: RaterLaneInput[]): RaterSeries[] {
    const out: RaterSeries[] = [];
    for (const lane of lanes) {
        const marks: Mark[] = [];
        for (const a of lane.annotations) {
            if (!isStruggleLabel(a.label)) continue;
            marks.push({ id: a.id, t: a.timestamp, rank: STRUGGLE_RANK[a.label], label: a.label, text: a.text ?? '' });
        }
        if (marks.length === 0) continue;
        marks.sort((x, y) => x.t - y.t);
        out.push({ raterId: lane.raterId, raterName: lane.raterName, color: raterLaneColor(lane.raterId), marks });
    }
    return out;
}

export interface Segment {
    startT: number;
    endT: number;
    rank: number;
    label: StruggleLevel;
    mark: Mark;
}

/** Each mark spans [mark.t, nextMark.t); the last spans [lastMark.t, domainEnd]. */
export function buildStepSegments(marks: Mark[], domainEnd: number): Segment[] {
    const segs: Segment[] = [];
    for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        const endT = i + 1 < marks.length ? marks[i + 1].t : domainEnd;
        segs.push({ startT: m.t, endT, rank: m.rank, label: m.label, mark: m });
    }
    return segs;
}

export const DIVERGENCE_THRESHOLD = 2;

/** Time intervals where >=2 raters' current (step-held) ranks span >= threshold levels. */
export function computeDivergenceSegments(
    series: RaterSeries[],
    domain: [number, number],
    threshold: number = DIVERGENCE_THRESHOLD,
): Array<[number, number]> {
    const pointSet = new Set<number>([domain[0]]);
    for (const s of series) for (const m of s.marks) {
        if (m.t > domain[0] && m.t < domain[1]) pointSet.add(m.t);
    }
    const points = [...pointSet].sort((a, b) => a - b);
    points.push(domain[1]);

    const raw: Array<[number, number]> = [];
    for (let i = 0; i + 1 < points.length; i++) {
        const start = points[i];
        const end = points[i + 1];
        if (end <= start) continue;
        const ranks: number[] = [];
        for (const s of series) {
            let cur: number | null = null;
            for (const m of s.marks) {
                if (m.t <= start) cur = m.rank; else break;
            }
            if (cur != null) ranks.push(cur);
        }
        if (ranks.length >= 2 && Math.max(...ranks) - Math.min(...ranks) >= threshold) {
            raw.push([start, end]);
        }
    }
    const merged: Array<[number, number]> = [];
    for (const [s, e] of raw) {
        const last = merged[merged.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else merged.push([s, e]);
    }
    return merged;
}
