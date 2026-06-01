import { CONFIG } from '@extension/utils';

/**
 * Extract the JWT from either a Bearer Authorization header or the Artemis
 * auth cookie. Used as a connection-time validation step (the token itself
 * is not forwarded as a STOMP `connectHeaders` field; this just fails fast
 * when the cookie carries no usable token).
 */
export function extractJwtFromHeaders(headers: Record<string, string>): string | undefined {
    const bearer = headers['Authorization'];
    if (bearer) {
        return bearer.replace(/^Bearer\s+/, '');
    }

    const cookie = headers['Cookie'];
    if (cookie) {
        const jwtMatch = cookie.match(new RegExp(`${CONFIG.AUTH_COOKIE_NAME}=([^;]+)`));
        return jwtMatch ? jwtMatch[1] : undefined;
    }

    return undefined;
}
