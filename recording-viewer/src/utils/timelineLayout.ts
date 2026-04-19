import type { Annotation, EventType, RecordedEvent } from '../types';

export const LANE_HEIGHT = 28;
export const LABEL_WIDTH = 140;
export const AXIS_HEIGHT = 28;
export const DOT_RADIUS = 4;
export const DOT_RADIUS_DENSE = 6;
export const DENSE_THRESHOLD = 3;
export const ANNOTATION_GROUP_PX = 5;
export const ANNOTATION_HIT_PX = 4;

export interface Bin {
    x: number;
    count: number;
    breakdown: Map<EventType, number>;
    firstTimestamp: number;
    events: RecordedEvent[];
}

export interface AnnotationGroup {
    x: number;
    annotations: Annotation[];
}

export interface DotHit {
    bin: Bin;
    type: EventType;
    key: string;
}

export interface AnnotationHit {
    group: AnnotationGroup;
    key: string;
}

export function timeToX(
    timestamp: number,
    sessionStartTime: number,
    xDomain: [number, number],
    timelineWidth: number,
): number {
    const offset = timestamp - sessionStartTime;
    const [min, max] = xDomain;
    const range = max - min;
    if (range <= 0) return 0;
    return ((offset - min) / range) * timelineWidth;
}

export function buildBins(
    events: RecordedEvent[],
    type: EventType,
    sessionStartTime: number,
    xDomain: [number, number],
    timelineWidth: number,
): Bin[] {
    const filtered = events.filter(e => e.type === type);
    if (filtered.length === 0 || timelineWidth <= 0) return [];

    const binMap = new Map<number, Bin>();
    for (const e of filtered) {
        const px = Math.round(timeToX(e.timestamp, sessionStartTime, xDomain, timelineWidth));
        const existing = binMap.get(px);
        if (existing) {
            existing.count++;
            existing.breakdown.set(type, (existing.breakdown.get(type) ?? 0) + 1);
            existing.events.push(e);
            if (e.timestamp < existing.firstTimestamp) existing.firstTimestamp = e.timestamp;
        } else {
            const breakdown = new Map<EventType, number>();
            breakdown.set(type, 1);
            binMap.set(px, { x: px, count: 1, breakdown, firstTimestamp: e.timestamp, events: [e] });
        }
    }
    return [...binMap.values()];
}

export function buildAnnotationGroups(
    annotations: Annotation[],
    sessionStartTime: number,
    xDomain: [number, number],
    timelineWidth: number,
): AnnotationGroup[] {
    if (timelineWidth <= 0) return [];
    const groups: AnnotationGroup[] = [];
    const sorted = [...annotations].sort((a, b) => a.timestamp - b.timestamp);
    for (const a of sorted) {
        const x = timeToX(a.timestamp, sessionStartTime, xDomain, timelineWidth);
        const existing = groups.find(g => Math.abs(g.x - x) < ANNOTATION_GROUP_PX);
        if (existing) {
            existing.annotations.push(a);
        } else {
            groups.push({ x, annotations: [a] });
        }
    }
    return groups;
}

export function generateTicks(xDomain: [number, number], timelineWidth: number): number[] {
    const [min, max] = xDomain;
    const range = max - min;
    if (range <= 0 || timelineWidth <= 0) return [];

    const approxTickCount = Math.max(2, Math.floor(timelineWidth / 80));
    const rawInterval = range / approxTickCount;

    const niceIntervals = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000];
    let interval = niceIntervals[niceIntervals.length - 1];
    for (const ni of niceIntervals) {
        if (ni >= rawInterval) { interval = ni; break; }
    }

    const ticks: number[] = [];
    const start = Math.ceil(min / interval) * interval;
    for (let t = start; t <= max; t += interval) {
        ticks.push(t);
    }
    return ticks;
}

export function hitTestDot(
    x: number,
    y: number,
    visibleLanes: readonly EventType[],
    laneBins: Map<EventType, Bin[]>,
): DotHit | null {
    const totalLaneHeight = visibleLanes.length * LANE_HEIGHT;
    if (y < 0 || y >= totalLaneHeight) return null;

    const laneIdx = Math.floor(y / LANE_HEIGHT);
    if (laneIdx < 0 || laneIdx >= visibleLanes.length) return null;

    const type = visibleLanes[laneIdx];
    const bins = laneBins.get(type);
    if (!bins || bins.length === 0) return null;

    const cy = laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
    const dy = y - cy;
    if (Math.abs(dy) > DOT_RADIUS_DENSE) return null;

    let best: Bin | null = null;
    let bestD2 = Infinity;
    for (const bin of bins) {
        const r = bin.count >= DENSE_THRESHOLD ? DOT_RADIUS_DENSE : DOT_RADIUS;
        const dx = x - bin.x;
        if (Math.abs(dx) > r) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestD2) {
            bestD2 = d2;
            best = bin;
        }
    }
    if (!best) return null;
    return { bin: best, type, key: `${type}:${best.x}:${best.firstTimestamp}` };
}

export function hitTestAnnotation(
    x: number,
    y: number,
    visibleLanes: readonly EventType[],
    annotationGroups: AnnotationGroup[],
): AnnotationHit | null {
    const totalLaneHeight = visibleLanes.length * LANE_HEIGHT;
    if (y < 0 || y > totalLaneHeight) return null;

    let best: AnnotationGroup | null = null;
    let bestDx = Infinity;
    for (const group of annotationGroups) {
        const dx = Math.abs(x - group.x);
        if (dx <= ANNOTATION_HIT_PX && dx < bestDx) {
            bestDx = dx;
            best = group;
        }
    }
    if (!best) return null;
    const firstId = best.annotations[0]?.id ?? 'empty';
    return { group: best, key: `annot:${best.x}:${firstId}` };
}

export function xToTime(
    x: number,
    sessionStartTime: number,
    xDomain: [number, number],
    timelineWidth: number,
): number | null {
    const [min, max] = xDomain;
    const range = max - min;
    if (range <= 0 || timelineWidth <= 0) return null;
    const offset = (x / timelineWidth) * range + min;
    return sessionStartTime + offset;
}
