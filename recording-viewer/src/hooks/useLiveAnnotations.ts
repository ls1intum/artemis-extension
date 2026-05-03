import { useCallback } from 'react';
import type { Annotation, AnnotationLabel } from '../types';

export function useLiveAnnotations(sessionId: string | null) {
    const post = useCallback(async (
        label: AnnotationLabel,
        referenceEventTimestamp: number | null,
        reactionDelayMs: number,
    ): Promise<Annotation | null> => {
        if (!sessionId) return null;
        try {
            const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/annotations`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label,
                    text: '',
                    referenceEventTimestamp: referenceEventTimestamp ?? undefined,
                    reactionDelayMs,
                }),
            });
            if (!res.ok) return null;
            const json = await res.json();
            return json.annotation as Annotation;
        } catch { return null; }
    }, [sessionId]);
    return { post };
}
