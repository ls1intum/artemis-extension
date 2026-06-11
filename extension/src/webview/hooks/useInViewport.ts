import { useEffect, useState } from 'react';

/**
 * Tracks whether the given element is inside the viewport.
 *
 * Takes the element itself (wire it up via a callback ref into state,
 * `<div ref={setEl}>`), NOT a RefObject: consumers like ExerciseDetailView
 * mount the observed element only after loading early-returns resolve, and
 * only an element-keyed effect re-attaches the observer in that case.
 *
 * Defaults to `true` (element considered visible) while the element is
 * absent and until the first IntersectionObserver callback fires, so
 * dependent UI (the sticky build strip) never flashes on mount.
 * Environments without IntersectionObserver (e.g. happy-dom in tests)
 * permanently report `true`.
 */
export function useInViewport(element: Element | null): boolean {
    const [inViewport, setInViewport] = useState(true);

    useEffect(() => {
        if (!element || typeof IntersectionObserver === 'undefined') {
            setInViewport(true);
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            // Entries arrive oldest-first; the last one is the current state.
            setInViewport(entries[entries.length - 1].isIntersecting);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);

    return inViewport;
}
