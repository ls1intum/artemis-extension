import { useEffect, useState } from 'react';

interface BuildProgress {
    /** Whole seconds until the estimated completion, or null when unknown/elapsed. */
    etaSeconds: number | null;
    /** Progress percentage clamped to 5–100, or null when unknown/elapsed. */
    progressPercent: number | null;
}

/**
 * Live ETA countdown + progress percentage for a running build, derived
 * client-side from the buildTimingInfo dates (500 ms tick). Returns nulls
 * when `isBuilding` is false, timing info is missing, the window is invalid
 * (eta <= start), or the estimated window has elapsed.
 */
export function useBuildProgress(
    isBuilding: boolean,
    buildStartDate?: string,
    estimatedCompletionDate?: string,
): BuildProgress {
    const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
    const [progressPercent, setProgressPercent] = useState<number | null>(null);

    useEffect(() => {
        if (!isBuilding || !estimatedCompletionDate || !buildStartDate) {
            setEtaSeconds(null);
            setProgressPercent(null);
            return;
        }

        const eta = new Date(estimatedCompletionDate).getTime();
        const start = new Date(buildStartDate).getTime();
        const totalTime = eta - start;

        if (totalTime <= 0) {
            setEtaSeconds(null);
            setProgressPercent(null);
            return;
        }

        const update = () => {
            const now = Date.now();
            const elapsed = now - start;
            const remaining = Math.max(0, Math.floor((eta - now) / 1000));
            const percent = Math.min(100, Math.max(5, (elapsed / totalTime) * 100));

            setEtaSeconds(remaining > 0 ? remaining : null);
            setProgressPercent(remaining > 0 ? percent : null);
        };

        update();
        const interval = setInterval(update, 500);
        return () => clearInterval(interval);
    }, [isBuilding, estimatedCompletionDate, buildStartDate]);

    return { etaSeconds, progressPercent };
}
