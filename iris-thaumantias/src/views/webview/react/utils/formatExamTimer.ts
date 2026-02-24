/**
 * Formats exam timer milliseconds to Artemis-compatible display format.
 *
 * Format rules:
 * - >= 1 hour: "1h 7min" (hours + minutes)
 * - >= 10 minutes: "15min" (minutes only)
 * - 1-10 minutes: "8min 0s" (minutes + seconds)
 * - < 1 minute: "45s" (seconds only)
 *
 * @param ms - Milliseconds remaining
 * @returns Formatted timer string
 */
export function formatExamTimer(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        // >= 1 hour: "1h 7min"
        return `${hours}h ${minutes}min`;
    } else if (totalSeconds >= 600) {
        // >= 10 minutes: "15min"
        return `${minutes}min`;
    } else if (totalSeconds >= 60) {
        // 1-10 minutes: "8min 0s"
        return `${minutes}min ${seconds}s`;
    } else {
        // < 1 minute: "45s"
        return `${seconds}s`;
    }
}
