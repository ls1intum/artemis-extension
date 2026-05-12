/**
 * Generate a short opaque identifier used to pair `*Opened` and `*Closed`
 * recorder events. Prefers `crypto.randomUUID()` (available in modern
 * Electron/VS Code webview runtimes); falls back to a timestamp+random
 * string when unavailable. Not for cryptographic use.
 */
export function makeViewId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
