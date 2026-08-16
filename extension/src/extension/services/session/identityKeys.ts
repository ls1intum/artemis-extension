/**
 * The one normalization for "which server" and "which person". Shared by
 * `courseAccessStorageService.ts` and the session coordinator, which key the
 * same identity: two implementations of the same key are two ways to disagree
 * about who the student is.
 */

const COURSE_ACCESS_KEY_PREFIX = 'dashboard.courseAccess';

export function normalizeServerUrl(raw: string): string | null {
    if (!raw || typeof raw !== 'string') { return null; }
    try {
        const url = new URL(raw.trim());
        const protocol = url.protocol.toLowerCase();
        const host = url.hostname.toLowerCase();
        const defaultPort = protocol === 'https:' ? '443' : protocol === 'http:' ? '80' : '';
        const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
        const path = url.pathname.replace(/\/+$/, '');
        return `${protocol}//${host}${port}${path}`;
    } catch {
        return null;
    }
}

export function normalizePrincipal(p: { id?: number; login?: string }): string | null {
    if (typeof p.id === 'number' && Number.isFinite(p.id)) { return `id:${p.id}`; }
    if (typeof p.login === 'string' && p.login.trim()) { return `login:${p.login.trim().toLowerCase()}`; }
    return null;
}

/**
 * FROZEN. This exact string is a `globalState` key holding a student's
 * recent-course history; a change to it discards that history silently.
 */
export function buildCourseAccessKey(serverKey: string, principal: string): string {
    return `${COURSE_ACCESS_KEY_PREFIX}::${serverKey}::${principal}`;
}
