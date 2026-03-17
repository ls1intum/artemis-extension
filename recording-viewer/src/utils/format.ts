export function formatOffset(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}

export function formatTime(ts: number): string {
    return new Date(ts).toLocaleString();
}

export function shortenUri(uri: string | undefined): string {
    if (!uri) return '\u2014';
    const parts = uri.replace(/^file:\/\//, '').split('/');
    return parts.slice(-2).join('/');
}
