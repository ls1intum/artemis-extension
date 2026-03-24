import { useEffect, useState } from 'react';

/**
 * Hook that converts absolute dates to relative time strings.
 * Updates every minute (accuracy not critical for relative time display).
 *
 * @param targetDate - Target date to display relative to now, or null
 * @returns Relative time string like "in 2 days", "5 hours ago", etc.
 */
export function useRelativeTime(targetDate: Date | null): string {
    const [relativeTime, setRelativeTime] = useState('');

    useEffect(() => {
        if (!targetDate) {
            setRelativeTime('');
            return;
        }

        const update = () => {
            const now = new Date();
            const diffMs = targetDate.getTime() - now.getTime();
            const absDiffMs = Math.abs(diffMs);
            const isPast = diffMs < 0;

            const minutes = Math.floor(absDiffMs / (1000 * 60));
            const hours = Math.floor(absDiffMs / (1000 * 60 * 60));
            const days = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));

            let timeStr: string;
            if (days > 0) {
                timeStr = days === 1 ? '1 day' : `${days} days`;
            } else if (hours > 0) {
                timeStr = hours === 1 ? '1 hour' : `${hours} hours`;
            } else if (minutes > 0) {
                timeStr = minutes === 1 ? '1 minute' : `${minutes} minutes`;
            } else {
                timeStr = 'less than a minute';
            }

            setRelativeTime(isPast ? `${timeStr} ago` : `in ${timeStr}`);
        };

        // Update immediately
        update();

        // Update every minute
        const interval = setInterval(update, 60000);

        return () => clearInterval(interval);
    }, [targetDate]);

    return relativeTime;
}
