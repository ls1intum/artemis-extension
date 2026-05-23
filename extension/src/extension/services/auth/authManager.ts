import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';
import { CONFIG } from '@extension/utils';

// Manages authentication tokens for both VS Code Desktop and Theia/EduIDE.
// Desktop: JWT stored as cookie string ("jwt=<token>"), sent as Cookie header.
// Theia:   Raw JWT from environment variable, sent as Authorization: Bearer header.
export class AuthManager {
    private memoryToken?: string;
    private context: vscode.ExtensionContext;
    private _useBearerAuth = false;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Enable Bearer token authentication mode (used in Theia/EduIDE).
     * When enabled, getAuthHeaders() returns Authorization: Bearer instead of Cookie.
     */
    public enableBearerAuth(): void {
        this._useBearerAuth = true;
    }

    public async hasAuthToken(): Promise<boolean> {
        if (this.memoryToken) {
            return true;
        }
        const stored = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        return !!stored;
    }

    /**
     * Returns the server URL that was active at the time of last successful login.
     * Used exclusively for URL-change detection: if the user changes their
     * `artemis.serverUrl` setting after login, stored credentials may be stale.
     * The live server URL is always resolved via `resolveServerUrl()`.
     */
    public async getStoredLoginServerUrl(): Promise<string | undefined> {
        return await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
    }

    /**
     * Checks whether the user changed the server URL since their last login.
     * @param currentUrl The currently resolved server URL from settings/env.
     */
    public async isServerUrlChanged(currentUrl: string): Promise<boolean> {
        const storedUrl = await this.getStoredLoginServerUrl();
        if (!storedUrl) { return false; }
        return storedUrl !== currentUrl;
    }

    /**
     * Returns the raw JWT string (without any "jwt=" cookie prefix), suitable
     * for use in a `Cookie: jwt=<value>` or `Authorization: Bearer <value>` header.
     *
     * Intended for developer/debug commands only — normal code paths should use
     * `getAuthHeaders()` instead so auth-mode handling stays centralized.
     *
     * Returns `undefined` if not authenticated.
     */
    public async getRawJwt(): Promise<string | undefined> {
        const stored = await this.getStoredToken();
        if (!stored) {
            return undefined;
        }
        // Desktop mode stores the token as "jwt=<value>" (cookie string).
        // Theia mode stores the raw JWT directly. Strip the prefix if present.
        const prefix = `${CONFIG.AUTH_COOKIE_NAME}=`;
        return stored.startsWith(prefix) ? stored.substring(prefix.length) : stored;
    }

    /**
     * Returns the stored token string.
     * In Desktop mode this is a cookie string ("jwt=<token>"),
     * in Theia mode this is a raw JWT.
     */
    private async getStoredToken(): Promise<string | undefined> {
        if (this.memoryToken) {
            return this.memoryToken;
        }

        return this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
    }

    public async getAuthHeaders(): Promise<Record<string, string>> {
        const token = await this.getStoredToken();

        if (!token) {
            return {};
        }

        if (this._useBearerAuth) {
            return { 'Authorization': `Bearer ${token}` };
        }

        return { 'Cookie': token };
    }

    public async storeArtemisCredentials(token: string, serverUrl: string, persist: boolean): Promise<void> {
        this.memoryToken = token;
        if (persist) {
            await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, token);
            await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL, serverUrl);
        }
    }

    public async clear(): Promise<void> {
        this.memoryToken = undefined;
        try {
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
        } catch (err) {
            logger.error('Failed to clear auth credentials from secrets:', LogCategory.AUTH, err);
        }
    }
}
