import * as vscode from 'vscode';
import { CONFIG } from '../utils';
import { logger, LogCategory } from '../services/loggingService';

// Manages authentication cookies (JWT in HttpOnly cookie)
export class AuthManager {
    private static SECRET_KEY = CONFIG.SECRET_KEYS.AUTH_COOKIE;
    private memoryCookie?: string;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // Extracts the Cookie header string ("name=value; name2=value2") from Set-Cookie header(s)
    private static extractCookieHeader(setCookie: string | string[] | undefined): string | undefined {
        if (!setCookie) {
            return undefined;
        }
        const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
        const pairs = entries
            .map(h => (h || '').split(';')[0]?.trim())
            .filter(Boolean) as string[];
        if (pairs.length === 0) {
            return undefined;
        }
        return pairs.join('; ');
    }

    // Persist cookie if requested, and always keep it in memory for current session
    private async setAuthCookie(cookieHeader: string, persist: boolean): Promise<void> {
        this.memoryCookie = cookieHeader;
        if (persist) {
            await this.context.secrets.store(AuthManager.SECRET_KEY, cookieHeader);
        }
    }

    public async hasAuthCookie(): Promise<boolean> {
        if (this.memoryCookie) {
            return true;
        }
        const stored = await this.context.secrets.get(AuthManager.SECRET_KEY);
        const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        return !!stored || !!artemisToken;
    }

    public async hasArtemisToken(): Promise<boolean> {
        const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        return !!artemisToken;
    }

    public async getArtemisServerUrl(): Promise<string | undefined> {
        return await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
    }

    // Capture Set-Cookie from a fetch Response and store it
    public async setFromResponse(response: unknown, persist: boolean): Promise<void> {
        try {
            let setCookies: string[] | undefined;
            // undici supports getSetCookie() in Node fetch
            // Type guard for response with headers
            if (response && typeof response === 'object' && 'headers' in response) {
                const headers = (response as { headers: unknown }).headers;

                // Check for getSetCookie method (undici Headers)
                if (headers && typeof headers === 'object' && 'getSetCookie' in headers) {
                    const getSetCookie = (headers as { getSetCookie: unknown }).getSetCookie;
                    if (typeof getSetCookie === 'function') {
                        const result: unknown = (getSetCookie as () => unknown)();
                        setCookies = result as string[];
                    }
                } else if (headers && typeof headers === 'object' && 'get' in headers) {
                    // Fallback to standard Headers.get
                    const get = (headers as { get: unknown }).get;
                    if (typeof get === 'function') {
                        const result: unknown = (get as (name: string) => unknown)('set-cookie');
                        const single = result as string | null;
                        setCookies = single ? [single] : undefined;
                    }
                }
            }

            const cookieHeader = AuthManager.extractCookieHeader(setCookies);
            if (cookieHeader) {
                await this.setAuthCookie(cookieHeader, persist);
            }
        } catch (err) {
            logger.error('Failed to capture auth cookie:', LogCategory.AUTH, err);
        }
    }

    public async getCookieHeader(): Promise<string | undefined> {
        // 1. Check in-memory cache first (current session)
        if (this.memoryCookie) {
            return this.memoryCookie;
        }

        // 2. Check new storage location (artemis-auth-token) - primary
        const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        if (artemisToken) {
            return artemisToken;
        }

        return undefined;
    }

    public async getAuthHeaders(): Promise<Record<string, string>> {
        const cookie = await this.getCookieHeader();

        if (cookie) {
            return { 'Cookie': cookie };
        } else {
            return {};
        }
    }

    public async storeArtemisCredentials(jwtCookie: string, serverUrl: string, persist: boolean): Promise<void> {
        this.memoryCookie = jwtCookie;
        if (persist) {
            await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, jwtCookie);
            await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL, serverUrl);
        }
    }

    public async clear(): Promise<void> {
        this.memoryCookie = undefined;
        try {
            await this.context.secrets.delete(AuthManager.SECRET_KEY);
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
        } catch (err) {
            logger.error('Failed to clear auth credentials from secrets:', LogCategory.AUTH, err);
        }
    }
}