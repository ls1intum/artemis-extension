import type { EventType } from '../types';
import { ALL_LABELS } from '../types';
import { MARKER_COLORS } from '../constants';
import { formatOffset } from './format';
import {
    AXIS_HEIGHT,
    DENSE_THRESHOLD,
    DOT_RADIUS,
    DOT_RADIUS_DENSE,
    LANE_HEIGHT,
    type AnnotationGroup,
    type Bin,
} from './timelineLayout';

export interface CanvasTheme {
    border: string;
    textMuted: string;
    mono: string;
}

export function readCanvasTheme(rootEl: HTMLElement = document.documentElement): CanvasTheme {
    const style = getComputedStyle(rootEl);
    return {
        border: (style.getPropertyValue('--border') || '#333').trim(),
        textMuted: (style.getPropertyValue('--text-muted') || '#888').trim(),
        mono: (style.getPropertyValue('--mono') || 'ui-monospace, monospace').trim(),
    };
}

export interface DrawParams {
    ctx: CanvasRenderingContext2D;
    timelineWidth: number;
    visibleLanes: readonly EventType[];
    laneBins: Map<EventType, Bin[]>;
    annotationGroups: AnnotationGroup[];
    ticks: number[];
    xDomain: [number, number];
    hoveredDotKey: string | null;
    hoveredAnnotKey: string | null;
    theme: CanvasTheme;
}

export function drawTimeline(params: DrawParams): void {
    const { ctx, timelineWidth, visibleLanes } = params;
    const totalLaneHeight = visibleLanes.length * LANE_HEIGHT;
    const totalHeight = totalLaneHeight + AXIS_HEIGHT;

    ctx.clearRect(0, 0, timelineWidth, totalHeight);

    drawLaneBackgrounds(params);
    drawLaneSeparators(params);
    drawAnnotationLines(params);
    drawDots(params);
    drawAxis(params);
}

function drawLaneBackgrounds({ ctx, timelineWidth, visibleLanes }: DrawParams): void {
    ctx.save();
    for (let i = 0; i < visibleLanes.length; i++) {
        if (i % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.02)';
            ctx.fillRect(0, i * LANE_HEIGHT, timelineWidth, LANE_HEIGHT);
        }
    }
    ctx.restore();
}

function drawLaneSeparators({ ctx, timelineWidth, visibleLanes, theme }: DrawParams): void {
    ctx.save();
    ctx.strokeStyle = theme.border;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < visibleLanes.length; i++) {
        const y = (i + 1) * LANE_HEIGHT + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(timelineWidth, y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawAnnotationLines({ ctx, visibleLanes, annotationGroups }: DrawParams): void {
    if (annotationGroups.length === 0) return;
    const totalLaneHeight = visibleLanes.length * LANE_HEIGHT;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.7;
    for (const group of annotationGroups) {
        const firstLabel = group.annotations.find(a => a.label)?.label;
        const color = firstLabel
            ? ALL_LABELS.find(l => l.value === firstLabel)?.color ?? '#38bdf8'
            : '#38bdf8';
        ctx.strokeStyle = color;
        ctx.beginPath();
        const x = Math.round(group.x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, totalLaneHeight);
        ctx.stroke();
    }
    ctx.restore();
}

function drawDots({ ctx, visibleLanes, laneBins, hoveredDotKey }: DrawParams): void {
    ctx.save();
    for (let laneIdx = 0; laneIdx < visibleLanes.length; laneIdx++) {
        const type = visibleLanes[laneIdx];
        const bins = laneBins.get(type);
        if (!bins || bins.length === 0) continue;
        const cy = laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
        const color = MARKER_COLORS[type];
        for (const bin of bins) {
            const isDense = bin.count >= DENSE_THRESHOLD;
            const r = isDense ? DOT_RADIUS_DENSE : DOT_RADIUS;
            const key = `${type}:${bin.x}:${bin.firstTimestamp}`;
            const isHovered = key === hoveredDotKey;

            ctx.globalAlpha = isDense ? 1 : 0.85;
            ctx.fillStyle = isHovered ? brighten(color) : color;
            ctx.beginPath();
            ctx.arc(bin.x, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawAxis({ ctx, timelineWidth, visibleLanes, ticks, xDomain, theme }: DrawParams): void {
    const totalLaneHeight = visibleLanes.length * LANE_HEIGHT;
    ctx.save();

    ctx.strokeStyle = theme.border;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, totalLaneHeight + 0.5);
    ctx.lineTo(timelineWidth, totalLaneHeight + 0.5);
    ctx.stroke();

    const [xMin, xMax] = xDomain;
    const range = xMax - xMin;
    if (range > 0 && ticks.length > 0) {
        ctx.strokeStyle = theme.textMuted;
        ctx.fillStyle = theme.textMuted;
        ctx.globalAlpha = 0.5;
        ctx.font = `11px ${theme.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.beginPath();
        for (const t of ticks) {
            const x = Math.round(((t - xMin) / range) * timelineWidth) + 0.5;
            ctx.moveTo(x, totalLaneHeight);
            ctx.lineTo(x, totalLaneHeight + 5);
        }
        ctx.stroke();

        // Labels drawn with globalAlpha restored higher for readability.
        ctx.globalAlpha = 0.85;
        for (const t of ticks) {
            const x = ((t - xMin) / range) * timelineWidth;
            ctx.fillText(formatOffset(t), x, totalLaneHeight + 18);
        }
    }

    ctx.restore();
}

function brighten(hexOrRgb: string): string {
    // Cheap visual lift. For hex like #rrggbb, blend toward white by ~30%.
    if (hexOrRgb.startsWith('#') && (hexOrRgb.length === 7 || hexOrRgb.length === 4)) {
        let r: number, g: number, b: number;
        if (hexOrRgb.length === 4) {
            r = parseInt(hexOrRgb[1] + hexOrRgb[1], 16);
            g = parseInt(hexOrRgb[2] + hexOrRgb[2], 16);
            b = parseInt(hexOrRgb[3] + hexOrRgb[3], 16);
        } else {
            r = parseInt(hexOrRgb.slice(1, 3), 16);
            g = parseInt(hexOrRgb.slice(3, 5), 16);
            b = parseInt(hexOrRgb.slice(5, 7), 16);
        }
        r = Math.min(255, Math.round(r + (255 - r) * 0.3));
        g = Math.min(255, Math.round(g + (255 - g) * 0.3));
        b = Math.min(255, Math.round(b + (255 - b) * 0.3));
        return `rgb(${r}, ${g}, ${b})`;
    }
    return hexOrRgb;
}
