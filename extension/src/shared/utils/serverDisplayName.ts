/**
 * The server as a person reads it: the host, plus a path prefix and a non-default
 * port where those are part of which instance you are on. Used for the view header,
 * where the full URL would be cut off long before the interesting part.
 *
 * The setting is free text and nothing normalises it, so this has to survive what a
 * person can type. `new URL('localhost:8080')` does not throw, it reads `localhost:`
 * as the protocol and leaves the host empty, which is why an empty host falls back
 * to the raw value rather than rendering as "8080".
 */
export function serverDisplayName(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) { return ''; }

    try {
        const url = new URL(trimmed);
        if (!url.host) { return trimmed; }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') { return trimmed; }
        return url.host + url.pathname.replace(/\/+$/, '');
    } catch {
        return trimmed;
    }
}
