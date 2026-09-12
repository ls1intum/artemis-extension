import { ApiError } from './errors';

const DEFAULT_MESSAGE = 'Login failed: An unexpected error occurred. Please try again.';
const BAD_CREDENTIALS = 'Login failed: Invalid username or password. Please verify your credentials and try again.';
const FORBIDDEN = 'Login failed: Your account is not activated or access is forbidden.';
const UNREACHABLE = 'Login failed: Could not reach the Artemis server. Check your network connection or server URL.';
const TIMED_OUT = 'Login failed: The Artemis server did not respond in time. Please try again.';

/**
 * The one sentence the student reads when signing in did not work.
 *
 * Shared by both login stages: the login-options lookup, which is where a wrong
 * server URL usually fails, and the password submit. They used to answer in
 * different vocabularies, and only the second one was ever formatted.
 *
 * Classification is by HTTP status wherever the error carries one. The text
 * matching below is what it replaced, kept for errors that have no status
 * (network failures, timeouts, anything thrown outside the API layer). Matching
 * on text is unsound for statuses: it reads `\b401\b` anywhere in the message,
 * so a 404 whose body mentions that number was classified as bad credentials.
 */
export function describeLoginFailure(error: unknown): string {
    if (!(error instanceof Error)) {
        return DEFAULT_MESSAGE;
    }

    const normalized = (error.message || '')
        .trim()
        .replace(/^login failed[:]?\s*/i, '')
        .trim();

    if (error instanceof ApiError) {
        return byStatus(error.status, normalized);
    }
    return byText(normalized);
}

function byStatus(status: number, normalized: string): string {
    // 400 and 401: the generic sentence wins. A server's own wording here is
    // reliably some variant of "Bad credentials", which tells a student less
    // than naming the two fields they should look at.
    if (status === 400 || status === 401) {
        return BAD_CREDENTIALS;
    }
    // 403: the server's wording wins when there is one. The reasons genuinely
    // differ (not activated, locked, IP restricted) and only the server knows
    // which applies.
    if (status === 403) {
        return normalized ? `Login failed: ${normalized}` : FORBIDDEN;
    }
    return normalized ? `Login failed: ${normalized}` : DEFAULT_MESSAGE;
}

function byText(normalized: string): string {
    if (!normalized) {
        return DEFAULT_MESSAGE;
    }
    if (/invalid username or password/i.test(normalized)
        || /method argument not valid/i.test(normalized)
        || /\b400\b/.test(normalized)
        || /\b401\b/.test(normalized)) {
        return BAD_CREDENTIALS;
    }
    if (/not activated/i.test(normalized) || /forbidden/i.test(normalized) || /\b403\b/.test(normalized)) {
        return FORBIDDEN;
    }
    if (/failed to fetch/i.test(normalized) || /enotfound/i.test(normalized) || /econnrefused/i.test(normalized)) {
        return UNREACHABLE;
    }
    if (/timed out/i.test(normalized)) {
        return TIMED_OUT;
    }
    return `Login failed: ${normalized}`;
}
