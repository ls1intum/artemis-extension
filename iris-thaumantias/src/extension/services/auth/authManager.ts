import * as vscode from 'vscode';
import { CONFIG } from '../../utils';
import { logger, LogCategory } from '../loggingService';

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
     * Returns the raw token value for comparison (e.g., token refresh detection).
     */
    public async getStoredTokenValue(): Promise<string | undefined> {
        return this.getStoredToken();
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

        const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        if (artemisToken) {
            return artemisToken;
        }

        return undefined;
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
