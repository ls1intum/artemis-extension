/**
 * Formats a timestamp as a relative time string ("just now", "5m ago", "2h ago", "3d ago").
 * For use in non-hook contexts (e.g., inside .map() calls).
 * For component-level relative time with auto-refresh, use useRelativeTime hook instead.
 */
export function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) { return 'just now'; }
    if (minutes < 60) { return `${minutes}m ago`; }
    if (hours < 24) { return `${hours}h ago`; }
    return `${days}d ago`;
}
