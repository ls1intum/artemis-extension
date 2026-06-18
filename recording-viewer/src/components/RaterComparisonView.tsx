import { useEffect, useMemo, useRef, useState } from 'react';
import { STRUGGLE_LABELS } from '../types';
import { formatOffset } from '../utils/format';
import { SessionChartOverlay } from './SessionChartOverlay';
import {
    toStruggleSeries, buildStepSegments, computeDivergenceSegments,
    RANKED_LEVELS, type Mark, type RaterLaneInput,
} from '../utils/raterComparison';

const LEVEL_LABEL: Record<string, string> = Object.fromEntries(STRUGGLE_LABELS.map(l => [l.value, l.label]));
const SEVERITY_COLOR: Record<string, string> = Object.fromEntries(STRUGGLE_LABELS.map(l => [l.value, l.color]));

const OVERLAY_PLOT_H = 150;
const OVERLAY_PAD_TOP = 12;
const OVERLAY_PAD_BOTTOM = 12;
const STACK_ROW_H = 28;
const STACK_SEG_PAD = 4;

interface TooltipState { left: number; top: number; lines: string[]; }

interface Props {
    researcherLanes: RaterLaneInput[];
    xDomain: [number, number];
    sessionStartTime: number;
    videoTimeRef?: React.RefObject<number>;
    onSeekVideo?: (timestamp: number) => void;
}

export function RaterComparisonView({ researcherLanes, xDomain, sessionStartTime, videoTimeRef, onSeekVideo }: Props) {
    const [mode, setMode] = useState<'overlaid' | 'stacked'>('overlaid');
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const plotRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = plotRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const e of entries) setWidth(e.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const series = useMemo(() => toStruggleSeries(researcherLanes), [researcherLanes]);
    // App's xDomain is OFFSET space (timestamp - sessionStartTime); marks carry ABSOLUTE
    // timestamps (needed for onSeekVideo). Convert the domain to absolute so both live in
    // one space for positioning, step segments, and divergence.
    const domainAbs = useMemo<[number, number]>(
        () => [xDomain[0] + sessionStartTime, xDomain[1] + sessionStartTime],
        [xDomain, sessionStartTime],
    );
    const divergence = useMemo(() => computeDivergenceSegments(series, domainAbs), [series, domainAbs]);

    const [da0, da1] = domainAbs;
    const span = da1 - da0;
    const xScale = (t: number) => (span > 0 ? ((t - da0) / span) * width : 0);
    const plotH = mode === 'overlaid' ? OVERLAY_PLOT_H : Math.max(STACK_ROW_H, series.length * STACK_ROW_H);

    const yForRank = (rank: number) => {
        const innerH = OVERLAY_PLOT_H - OVERLAY_PAD_TOP - OVERLAY_PAD_BOTTOM;
        return OVERLAY_PAD_TOP + (1 - rank / (RANKED_LEVELS.length - 1)) * innerH;
    };
    const tipLines = (rater: string, label: string, t: number, text: string) =>
        [rater, label, `+${formatOffset(t - sessionStartTime)}`, ...(text ? [text] : [])];
    const showTip = (e: React.MouseEvent, lines: string[]) => {
        const rect = plotRef.current?.getBoundingClientRect();
        if (!rect) return;
        setTooltip({ left: e.clientX - rect.left + 12, top: e.clientY - rect.top + 12, lines });
    };
    const hideTip = () => setTooltip(null);

    if (series.length === 0) {
        return (
            <div className="rater-compare">
                <div className="rater-compare-empty">No struggle ratings to compare yet.</div>
            </div>
        );
    }

    const stepPath = (marks: Mark[]): string => {
        let d = `M ${xScale(marks[0].t)} ${yForRank(marks[0].rank)}`;
        let prevY = yForRank(marks[0].rank);
        for (let i = 1; i < marks.length; i++) {
            const x = xScale(marks[i].t);
            const y = yForRank(marks[i].rank);
            d += ` L ${x} ${prevY} L ${x} ${y}`;
            prevY = y;
        }
        d += ` L ${xScale(da1)} ${prevY}`;
        return d;
    };

    return (
        <div className="rater-compare">
            <div className="rater-compare-header">
                <div className="view-toggle">
                    <button className={`view-toggle-btn ${mode === 'overlaid' ? 'active' : ''}`} onClick={() => setMode('overlaid')}>Overlaid</button>
                    <button className={`view-toggle-btn ${mode === 'stacked' ? 'active' : ''}`} onClick={() => setMode('stacked')}>Stacked</button>
                </div>
                <div className="rater-compare-legend">
                    {series.map(s => (
                        <span key={s.raterId} className="rater-legend-item">
                            <span className="rater-legend-swatch" style={{ background: s.color }} />{s.raterName}
                        </span>
                    ))}
                </div>
            </div>

            <div className="rater-compare-grid">
                <div
                    className="rater-compare-labels"
                    style={mode === 'overlaid'
                        ? { height: OVERLAY_PLOT_H, padding: `${OVERLAY_PAD_TOP}px 0 ${OVERLAY_PAD_BOTTOM}px` }
                        : undefined}
                >
                    {mode === 'overlaid'
                        ? [...RANKED_LEVELS].reverse().map(lvl => (
                            <div key={lvl} className="rater-level-label">{LEVEL_LABEL[lvl]}</div>
                          ))
                        : series.map(s => (
                            <div key={s.raterId} className="rater-row-label" style={{ height: STACK_ROW_H }}>
                                <span className="rater-legend-swatch" style={{ background: s.color }} />{s.raterName}
                            </div>
                          ))}
                </div>

                <div className="rater-compare-plot" ref={plotRef}>
                    <svg width="100%" height={plotH} style={{ display: 'block' }}>
                        {divergence.map(([s, e], i) => (
                            <rect key={`div-${i}`} x={xScale(s)} y={0} width={Math.max(0, xScale(e) - xScale(s))} height={plotH} fill="rgba(239,68,68,0.14)" />
                        ))}

                        {mode === 'overlaid' && (
                            <>
                                {RANKED_LEVELS.map((lvl, r) => (
                                    <line key={lvl} x1={0} x2={width} y1={yForRank(r)} y2={yForRank(r)} stroke="#2a2a3a" strokeWidth={1} />
                                ))}
                                {series.map(s => (
                                    <g key={s.raterId}>
                                        <path d={stepPath(s.marks)} fill="none" stroke={s.color} strokeWidth={2} />
                                        {s.marks.map(m => (
                                            <circle
                                                key={m.id} cx={xScale(m.t)} cy={yForRank(m.rank)} r={4}
                                                fill={s.color} stroke="#1e1e2e" strokeWidth={1.5}
                                                style={{ cursor: onSeekVideo ? 'pointer' : 'default' }}
                                                onMouseEnter={ev => showTip(ev, tipLines(s.raterName, LEVEL_LABEL[m.label], m.t, m.text))}
                                                onMouseMove={ev => showTip(ev, tipLines(s.raterName, LEVEL_LABEL[m.label], m.t, m.text))}
                                                onMouseLeave={hideTip}
                                                onClick={() => onSeekVideo?.(m.t)}
                                            />
                                        ))}
                                    </g>
                                ))}
                            </>
                        )}

                        {mode === 'stacked' && series.map((s, k) => {
                            const y0 = k * STACK_ROW_H;
                            return (
                                <g key={s.raterId}>
                                    {buildStepSegments(s.marks, da1).map(seg => {
                                        const x = xScale(seg.startT);
                                        return (
                                            <rect
                                                key={seg.mark.id} x={x} y={y0 + STACK_SEG_PAD}
                                                width={Math.max(0, xScale(seg.endT) - x)} height={STACK_ROW_H - 2 * STACK_SEG_PAD}
                                                rx={2} fill={SEVERITY_COLOR[seg.label]}
                                                style={{ cursor: onSeekVideo ? 'pointer' : 'default' }}
                                                onMouseEnter={ev => showTip(ev, tipLines(s.raterName, LEVEL_LABEL[seg.label], seg.startT, seg.mark.text))}
                                                onMouseMove={ev => showTip(ev, tipLines(s.raterName, LEVEL_LABEL[seg.label], seg.startT, seg.mark.text))}
                                                onMouseLeave={hideTip}
                                                onClick={() => onSeekVideo?.(seg.mark.t)}
                                            />
                                        );
                                    })}
                                </g>
                            );
                        })}
                    </svg>

                    {width > 0 && (
                        <SessionChartOverlay
                            xDomain={xDomain}
                            topOffset={0}
                            videoTimeRef={videoTimeRef}
                            sessionStartTime={sessionStartTime}
                        />
                    )}
                    {tooltip && (
                        <div className="rater-compare-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
                            {tooltip.lines.map((l, i) => <div key={i}>{l}</div>)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
