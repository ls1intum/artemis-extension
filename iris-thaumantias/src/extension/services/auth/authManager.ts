import * as vscode from 'vscode';
import { CONFIG } from '../../utils';
import { logger, LogCategory } from '../loggingService';

// Manages authentication tokens for both VS Code Desktop and Theia/EduIDE.
// Desktop: JWT stored as cookie string ("jwt=<token>"), sent as Cookie header.
// Theia:   Raw JWT from environment variable, sent as Authorization: Bearer header.
export class AuthManager {
    private static LEGACY_SECRET_KEY = CONFIG.SECRET_KEYS.AUTH_COOKIE;
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
        const legacy = await this.context.secrets.get(AuthManager.LEGACY_SECRET_KEY);
        const stored = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        return !!legacy || !!stored;
    }

    public async hasArtemisToken(): Promise<boolean> {
        const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        return !!artemisToken;
    }

    public async getArtemisServerUrl(): Promise<string | undefined> {
        return await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
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
            await this.context.secrets.delete(AuthManager.LEGACY_SECRET_KEY);
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
        } catch (err) {
            logger.error('Failed to clear auth credentials from secrets:', LogCategory.AUTH, err);
        }
    }
}