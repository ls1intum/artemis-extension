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
    // Used to obtain jwtToken from server side after successful OIDC authentication
    private pendingCodeVerifier: string | null = null;

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
     * Returns the raw JWT string (without any "jwt=" cookie prefix), suitable
     * for use in a `Cookie: jwt=<value>` or `Authorization: Bearer <value>` header.
     *
     * Intended for developer/debug commands only. Normal code paths use
     * `getAuthHeaders()` so auth-mode handling stays centralized.
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

    /** Cookie string ("jwt=<token>") in Desktop mode, raw JWT in Theia mode. */
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

        return this.buildAuthHeadersFor(token);
    }

    /**
     * The header rule for an explicit token, so a candidate can be checked against the server before it
     * becomes the stored credential. `getAuthHeaders()` delegates here, keeping one definition of the rule.
     */
    public buildAuthHeadersFor(storedToken: string): Record<string, string> {
        if (this._useBearerAuth) {
            return { 'Authorization': `Bearer ${storedToken}` };
        }

        return { 'Cookie': storedToken };
    }

    /**
     * Bring a token into the representation this mode stores: the bare JWT for Theia's Bearer header,
     * `jwt=<token>` for the Desktop cookie.
     *
     * The leading prefix is stripped first, so passing an already-formatted cookie string is well defined
     * in both modes. Without that step a `jwt=`-prefixed value would survive into Bearer mode and produce
     * `Authorization: Bearer jwt=<token>`, which is exactly the Desktop/Theia mixing this file exists to
     * keep apart.
     */
    public formatToken(token: string): string {
        const prefix = `${CONFIG.AUTH_COOKIE_NAME}=`;
        const rawJwt = token.startsWith(prefix) ? token.substring(prefix.length) : token;

        return this._useBearerAuth ? rawJwt : `${prefix}${rawJwt}`;
    }

    /**
     * Commit a credential. This is one operation rather than a store followed by an optional delete,
     * because the two-call version cannot be made consistent: with `persist` false the store would leave
     * SecretStorage untouched, so a delete failing afterwards would strand the new token in memory beside
     * the old persisted one.
     *
     * Bearer mode never reaches SecretStorage at all. Theia passes `persist: false` precisely because ENV
     * tokens must not be persisted, and it must never be able to remove a Desktop secret as a side effect.
     *
     * In cookie mode the persistent side is settled before memory, so a failed write or delete rejects
     * without leaving the two disagreeing.
     */
    public async storeArtemisCredentials(token: string, persist: boolean): Promise<void> {
        if (this._useBearerAuth) {
            this.memoryToken = token;
            return;
        }

        if (persist) {
            await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, token);
        } else {
            // Declining to be remembered has to remove an earlier opt-in, otherwise the old secret
            // resurfaces on the next start and silently outlives the choice.
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        }
        this.memoryToken = token;
    }

    public async clear(): Promise<void> {
        this.memoryToken = undefined;
        try {
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        } catch (err) {
            logger.error('Failed to clear auth credentials from secrets:', LogCategory.AUTH, err);
        }
    }

    public setPendingCodeVerifier(verifier: string): void {
        this.pendingCodeVerifier = verifier;
    }

    public consumePendingCodeVerifier(): string | null {
        const verifier = this.pendingCodeVerifier;
        this.pendingCodeVerifier = null;
        return verifier;
    }
}
