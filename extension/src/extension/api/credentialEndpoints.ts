import { fetchWithTimeout } from '@extension/api/fetchWithTimeout';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ArtemisUser, AuthenticationResult } from '@extension/types';
import { ApiError, parseArtemisUser } from '@extension/types';
import { CONFIG, getUserAgent } from '@extension/utils';

/**
 * The four Artemis endpoints that must NOT go through `ArtemisApiService`'s
 * `makeRequest`.
 *
 * `makeRequest` treats a 401 as "the stored credential is dead": it clears that
 * credential and fires the auth-expired callback. That is right for an ordinary
 * request and wrong for every call here, because these four are the credential
 * lifecycle itself. Checking a candidate token, redeeming a login code,
 * exchanging a password, and telling the server about a logout must all be able
 * to fail without disturbing the session the student already has. They are also
 * the only endpoints whose non-2xx statuses carry meaning the caller acts on,
 * which `makeRequest` would have thrown away before they were read.
 *
 * They live here as free functions taking an already-resolved server URL (and,
 * where relevant, already-resolved auth headers), because `getServerUrl()` is
 * protected and overridable on the service and must stay there.
 */
/**
 * Fetch the account behind a candidate token without installing that token first.
 *
 * This is what lets a login commit only after the credential has been shown to work. It bypasses
 * `makeRequest()` on purpose: that helper reads the *stored* credential and, on a 401, clears it and
 * fires the auth-expired callback. Checking a candidate must never touch the session the user has.
 */
export async function fetchAccountWithToken(
    serverUrl: string,
    authHeaders: Record<string, string>,
    signal?: AbortSignal,
): Promise<ArtemisUser> {
    const url = `${serverUrl}/api/core/public/account`;

    const response = await fetchWithTimeout(url, {
        signal,
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': getUserAgent(),
            ...authHeaders,
        },
    });

    if (!response.ok) {
        throw new ApiError(`Could not load the account for this token: ${response.status}`, response.status);
    }

    const body = (await response.text()).trim();
    if (!body) {
        // The endpoint is public, so an unusable token yields a 200 with an empty body rather than a
        // 401. Same rule as getCurrentUser(): treat it as not authenticated.
        throw new ApiError('Not authenticated', 401);
    }
    return parseArtemisUser(JSON.parse(body));
}

/**
 * Redeem a single-use OIDC exchange code for a JWT, proving ownership with the PKCE verifier.
 *
 * Deliberately bypasses `makeRequest()`, exactly like `logoutFromServer()` and for the same reason:
 * `makeRequest` throws on any non-2xx, which would make the status mapping below unreachable, and its
 * 401 branch clears the stored credentials and fires the auth-expired callback. A rejected login code
 * must never disturb a session the user already has. The endpoint is public, so no auth header is sent.
 */
export async function exchangeCodeForToken(
    serverUrl: string,
    code: string,
    codeVerifier: string,
): Promise<string> {
    const url = `${serverUrl}/api/core/public/exchange-code`;

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': getUserAgent(),
        },
        body: JSON.stringify({
            code: code,
            codeVerifier: codeVerifier,
        }),
    });

    if (!response.ok) {
        if (response.status === 404 || response.status === 401) {
            throw new Error('The login code has expired or is invalid. Please try logging in again.');
        }
        throw new Error(`Server returned status ${response.status} during code exchange.`);
    }

    const token = (await response.text()).trim();
    if (!token) {
        throw new Error('The server returned an empty token during code exchange.');
    }
    return token;
}

/**
 * Exchange username and password for a JWT. The token is returned, not stored: committing it is the
 * caller's job, once it has been shown to work.
 */
export async function authenticateWithPassword(
    serverUrl: string,
    username: string,
    password: string,
    rememberMe: boolean,
    signal?: AbortSignal,
): Promise<AuthenticationResult> {
    const url = `${serverUrl}${CONFIG.API.ENDPOINTS.AUTHENTICATE}`;

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        signal,
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': getUserAgent()
        },
        body: JSON.stringify({
            username: username,
            password: password,
            rememberMe: rememberMe
        })
    });

    if (!response.ok) {
        const rawError = await response.text();
        let parsedMessage = rawError.trim();

        if (parsedMessage) {
            try {
                const parsed: unknown = JSON.parse(rawError);
                if (parsed && typeof parsed === 'object') {
                    const errorObj = parsed as { title?: string; message?: string; detail?: string; error?: string };
                    parsedMessage = errorObj.title || errorObj.message || errorObj.detail || errorObj.error || parsedMessage;
                }
            } catch (parseError) {
                // Fall back to plain text error message when JSON parsing fails
            }
        }

        if (response.status === 400 || response.status === 401) {
            if (!parsedMessage || /method argument not valid/i.test(parsedMessage)) {
                throw new Error('Invalid username or password.');
            }
            throw new Error(parsedMessage);
        } else if (response.status === 403) {
            throw new Error(parsedMessage || 'Account is not activated or access is forbidden.');
        } else {
            const statusText = response.statusText || 'Unexpected error';
            const detail = parsedMessage && parsedMessage !== statusText ? ` - ${parsedMessage}` : '';
            throw new Error(`${response.status} ${statusText}${detail}`.trim());
        }
    }

    // Extract JWT cookie from Set-Cookie header (Desktop auth uses Cookie header)
    const setCookieHeader = response.headers.get('set-cookie');
    let jwtCookie = '';

    if (setCookieHeader) {
        const jwtMatch = setCookieHeader.match(new RegExp(`${CONFIG.AUTH_COOKIE_NAME}=([^;]+)`));
        if (jwtMatch) {
            jwtCookie = `${CONFIG.AUTH_COOKIE_NAME}=${jwtMatch[1]}`;
        }
    }

    if (!jwtCookie) {
        throw new Error('Authentication succeeded but no JWT token received');
    }

    // Hand the candidate back rather than installing it. The caller checks it against the server and
    // commits only then, so a login that falls over halfway cannot leave a half-applied session behind.
    return { success: true, token: jwtCookie };
}

/**
 * Inform the Artemis server that the user is logging out.
 *
 * Best-effort: this never throws. The calling logout flow must always clear
 * local state regardless of the server response, so any failure here is logged
 * and swallowed.
 *
 * `authHeaders` is already resolved by the caller, which also decides that
 * there is a session worth telling the server about at all.
 *
 * Uses a direct fetch instead of `makeRequest()` so a non-2xx response does
 * not trigger the shared 401 handler, which would re-clear auth and fire the
 * auth-expired callback during an intentional logout.
 *
 * Artemis JWTs are strictly stateless: `PublicUserJwtResource.logout()` only
 * sets `Set-Cookie: jwt=; Max-Age=0`, with no blacklist and no server-side
 * invalidation. The extension keeps the JWT in VS Code secrets rather than a
 * cookie jar, so fetch() discards that header. The call exists purely for
 * protocol symmetry with the Artemis webapp.
 */
export async function postLogout(
    serverUrl: string,
    authHeaders: Record<string, string>,
): Promise<void> {
    try {
        const response = await fetchWithTimeout(`${serverUrl}${CONFIG.API.ENDPOINTS.LOGOUT}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': getUserAgent(),
                ...authHeaders,
            },
        }, CONFIG.API.LOGOUT_TIMEOUT_MS);
        if (response.ok) {
            logger.info('Server-side logout successful', LogCategory.AUTH);
        } else {
            logger.warn(
                `Server-side logout returned ${response.status}, continuing with local cleanup`,
                LogCategory.AUTH
            );
        }
    } catch (err) {
        logger.warn(
            'Server-side logout failed, continuing with local cleanup',
            LogCategory.AUTH,
            err
        );
    }
}
