import * as vscode from 'vscode';
import { CONFIG } from '../../utils';
import { logger, LogCategory } from '../loggingService';

// Manages authentication tokens.
// In VS Code Desktop: JWT stored as cookie string ("jwt=<token>"), sent as Cookie header.
// In Theia/EduIDE: raw JWT from environment, sent as Authorization: Bearer header.
export class AuthManager {
    private static SECRET_KEY = CONFIG.SECRET_KEYS.AUTH_COOKIE;
    private memoryCookie?: string;
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
        const token = await this.getCookieHeader();

        if (!token) {
            return {};
        }

        if (this._useBearerAuth) {
            // Theia: send raw JWT as Bearer token
            return { 'Authorization': `Bearer ${token}` };
        }

        // VS Code Desktop: send as cookie
        return { 'Cookie': token };
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