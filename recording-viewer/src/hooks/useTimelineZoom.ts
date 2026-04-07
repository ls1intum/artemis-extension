import { useEffect, useRef } from 'react';

interface UseTimelineZoomOptions {
    containerRef: React.RefObject<HTMLElement | null>;
    xDomain: [number, number];
    fullXDomain?: [number, number];
    svgWidth: number;
    onZoomChange?: (domain: [number, number] | null) => void;
}

/**
 * Attaches a non-passive wheel listener to `containerRef` so that
 * Ctrl+Scroll / trackpad-pinch zooms the timeline instead of the browser page.
 */
export function useTimelineZoom({ containerRef, xDomain, fullXDomain, svgWidth, onZoomChange }: UseTimelineZoomOptions) {
    const latestRef = useRef({ onZoomChange, fullXDomain, svgWidth, xDomain });
    useEffect(() => {
        latestRef.current = { onZoomChange, fullXDomain, svgWidth, xDomain };
    }, [onZoomChange, fullXDomain, svgWidth, xDomain]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleWheel = (e: WheelEvent) => {
            const { onZoomChange: zoomCb, xDomain: domain, fullXDomain: full, svgWidth: width } = latestRef.current;
            if (!zoomCb) return;
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();

            const rect = el.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const [min, max] = domain;
            const range = max - min;
            if (range <= 0 || width <= 0) return;

            const frac = mouseX / width;
            const cursorOffset = min + frac * range;

            const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            const newRange = range * zoomFactor;

            const bounds = full ?? domain;
            const fullRange = bounds[1] - bounds[0];
            if (newRange >= fullRange) {
                zoomCb(null);
                return;
            }

            if (newRange < 2000) return;

            let newMin = cursorOffset - frac * newRange;
            let newMax = cursorOffset + (1 - frac) * newRange;

            if (newMin < bounds[0]) {
                newMin = bounds[0];
                newMax = newMin + newRange;
            }
            if (newMax > bounds[1]) {
                newMax = bounds[1];
                newMin = newMax - newRange;
            }

            zoomCb([Math.max(bounds[0], newMin), Math.min(bounds[1], newMax)]);
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [containerRef]);
}
