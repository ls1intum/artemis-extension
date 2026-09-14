/**
 * Seconds to "M:SS". `ceil` for remaining times, so a countdown stays at 1 until it truly
 * hits 0; `floor` for elapsed times, so a timer starts at 0 rather than jumping to 1.
 *
 * In `shared` because both sides of the wire format the same engine clock: the webview's
 * countdown panels and the extension host's status-bar alert text.
 */
export function mmss(totalSeconds: number, mode: 'ceil' | 'floor' = 'ceil'): string {
    const s = Math.max(0, mode === 'ceil' ? Math.ceil(totalSeconds) : Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}
