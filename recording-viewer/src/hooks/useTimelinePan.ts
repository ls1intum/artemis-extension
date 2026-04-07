import { useEffect, useRef, useCallback } from 'react';

interface UseTimelinePanOptions {
    xDomain: [number, number];
    fullXDomain?: [number, number];
    svgWidth: number;
    onZoomChange?: (domain: [number, number] | null) => void;
    /** Pixels to subtract from the left of the container before mapping to the time domain */
    leftOffset?: number;
}

/**
 * Returns a mouseDown handler to attach to a timeline container.
 * While dragging, the visible xDomain is panned horizontally.
 * Global mousemove/mouseup listeners ensure dragging works even outside the element.
 */
export function useTimelinePan({ xDomain, fullXDomain, svgWidth, onZoomChange, leftOffset = 0 }: UseTimelinePanOptions) {
    const isPanningRef = useRef(false);
    const panStartXRef = useRef(0);
    const panStartDomainRef = useRef<[number, number]>([0, 0]);

    const isZoomed = fullXDomain != null && (xDomain[0] !== fullXDomain[0] || xDomain[1] !== fullXDomain[1]);

    // Keep latest values in a ref for the global listeners
    const latestRef = useRef({ onZoomChange, fullXDomain, xDomain, svgWidth, leftOffset });
    useEffect(() => {
        latestRef.current = { onZoomChange, fullXDomain, xDomain, svgWidth, leftOffset };
    }, [onZoomChange, fullXDomain, xDomain, svgWidth, leftOffset]);

    const handlePanStart = useCallback((e: React.MouseEvent) => {
        if (!onZoomChange || !isZoomed || e.button !== 0) return;
        // Don't start pan if clicking on interactive elements
        const target = e.target as Element;
        if (target.classList.contains('event-dot') || target.closest?.('.annotation-popover')) return;

        isPanningRef.current = true;
        panStartXRef.current = e.clientX;
        panStartDomainRef.current = [...xDomain] as [number, number];
        e.preventDefault();
    }, [onZoomChange, isZoomed, xDomain]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isPanningRef.current) return;
            const { onZoomChange: zoomCb, fullXDomain: full, xDomain: domain, svgWidth: width } = latestRef.current;
            if (!zoomCb || width <= 0) return;
            const dx = e.clientX - panStartXRef.current;
            const [startMin, startMax] = panStartDomainRef.current;
            const range = startMax - startMin;
            const domainDelta = -(dx / width) * range;

            const bounds = full ?? domain;
            let newMin = startMin + domainDelta;
            let newMax = startMax + domainDelta;

            if (newMin < bounds[0]) {
                newMin = bounds[0];
                newMax = newMin + range;
            }
            if (newMax > bounds[1]) {
                newMax = bounds[1];
                newMin = newMax - range;
            }

            zoomCb([newMin, newMax]);
        };
        const handleMouseUp = () => {
            isPanningRef.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    return { handlePanStart, isZoomed };
}
