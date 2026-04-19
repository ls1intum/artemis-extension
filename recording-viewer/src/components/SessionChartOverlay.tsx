import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
    xDomain: [number, number];
    zoomedRange?: [number, number];
    videoTimeRef?: React.RefObject<number>;
    sessionStartTime: number;
}

/**
 * Sibling DOM overlay for SessionLineChart. Renders the live zoom rectangle
 * and the video playhead as absolutely positioned div elements so they can
 * update at rAF rate without triggering a recharts rerender.
 *
 * Assumes the same plot-area bounds as the recharts LineChart inside the
 * same container: full container width horizontally, top margin 10px
 * (matches `margin={{ top: 10, right: 0, left: 0, bottom: 0 }}` in
 * SessionLineChart). If that chart layout changes, adjust `CHART_TOP_OFFSET`.
 */
const CHART_TOP_OFFSET = 10;

export function SessionChartOverlay({ xDomain, zoomedRange, videoTimeRef, sessionStartTime }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) setWidth(entry.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (!videoTimeRef || !playheadRef.current) return;
        let raf: number;
        const tick = () => {
            const el = playheadRef.current;
            if (!el) return;
            const ts = videoTimeRef.current;
            const [min, max] = xDomain;
            const range = max - min;
            // Hide while geometry is uninitialised, the domain is degenerate,
            // or the video has not yet started. This matches the old recharts
            // ReferenceLine behavior, which skipped render while ts was 0.
            if (ts <= 0 || range <= 0 || width <= 0) {
                el.style.display = 'none';
            } else {
                const x = ((ts - sessionStartTime - min) / range) * width;
                if (x < 0 || x > width) {
                    el.style.display = 'none';
                } else {
                    el.style.display = 'block';
                    el.style.transform = `translateX(${x}px)`;
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [videoTimeRef, sessionStartTime, xDomain, width]);

    const zoomStyle = useMemo<React.CSSProperties | null>(() => {
        if (!zoomedRange || width <= 0) return null;
        const [min, max] = xDomain;
        const range = max - min;
        if (range <= 0) return null;
        const x1 = ((zoomedRange[0] - min) / range) * width;
        const x2 = ((zoomedRange[1] - min) / range) * width;
        return { left: x1, width: Math.max(0, x2 - x1) };
    }, [zoomedRange, xDomain, width]);

    return (
        <div
            ref={containerRef}
            className="session-chart-overlay"
            style={{
                position: 'absolute',
                top: CHART_TOP_OFFSET,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: 'none',
                overflow: 'hidden',
            }}
        >
            {zoomStyle && <div className="session-zoom-rect" style={zoomStyle} />}
            {videoTimeRef && (
                <div
                    ref={playheadRef}
                    className="session-playhead-line"
                    style={{ display: 'none' }}
                />
            )}
        </div>
    );
}
