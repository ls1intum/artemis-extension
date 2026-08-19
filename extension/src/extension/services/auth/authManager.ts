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

    /** Serializes credential mutations, so a commit and a clear can never interleave. */
    private mutations: Promise<unknown> = Promise.resolve();

    /**
     * Moves on every committed credential and every clear. It is what lets a caller that started work
     * against one credential tell "still mine" from "the user has since acquired another one".
     */
    private credentialRevision = 0;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private enqueue<T>(op: () => Promise<T>): Promise<T> {
        // `op` is both handlers on purpose: a rejected predecessor must not poison the tail and strand
        // a later logout behind a failed write.
        const run = this.mutations.then(op, op);
        this.mutations = run.then(() => undefined, () => undefined);
        return run;
    }

    public currentCredentialRevision(): number {
        return this.credentialRevision;
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
        if (this._useBearerAuth) {
            return false;
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
        if (this._useBearerAuth) {
            // Bearer mode has no business in SecretStorage: a Desktop secret read here would go out as
            // `Authorization: Bearer jwt=<token>`. No memory token means not signed in.
            return this.memoryToken;
        }

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
     * The credential and the revision it belongs to, from one read.
     *
     * Fetching them separately would let a mutation land between the two calls, so a caller could pair
     * an old credential's headers with a new credential's revision and then decide it still owns it.
     */
    public async getAuthContext(): Promise<{ headers: Record<string, string>; revision: number }> {
        return this.enqueue(async () => {
            const token = await this.getStoredToken();
            return {
                headers: token ? this.buildAuthHeadersFor(token) : {},
                revision: this.credentialRevision,
            };
        });
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
     * Commit a credential, and only keep it if the caller still wants it once the write has landed.
     *
     * This is one operation rather than a store followed by an optional delete, because the two-call
     * version cannot be made consistent: with `persist` false the store would leave SecretStorage
     * untouched, so a delete failing afterwards would strand the new token in memory beside the old
     * persisted one.
     *
     * `stillWanted` is checked twice: once before any work, and again after the SecretStorage write.
     * The second check is the point of the whole thing. SecretStorage yields, so a cancellation or a
     * logout can land while the write is in flight, and a check placed only before it would commit the
     * credential anyway. On a refusal the previous state is restored rather than cleared, so a cancelled
     * attempt cannot destroy a session the user already had.
     *
     * Bearer mode never reaches SecretStorage at all. Theia passes `persist: false` precisely because
     * ENV tokens must not be persisted, and it must never remove a Desktop secret as a side effect.
     *
     * Returns whether the credential became the live one. A `false` result is an outcome, not an error.
     */
    public async storeArtemisCredentials(
        token: string,
        persist: boolean,
        stillWanted?: () => boolean,
    ): Promise<boolean> {
        return this.enqueue(async () => {
            if (stillWanted && !stillWanted()) {
                return false;
            }

            if (this._useBearerAuth) {
                // Synchronous, so nothing can interleave and the first check is the only one needed.
                this.memoryToken = token;
                this.credentialRevision++;
                return true;
            }

            const previousMemory = this.memoryToken;
            const previousStored = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);

            if (persist) {
                await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, token);
            } else {
                // Declining to be remembered has to remove an earlier opt-in, otherwise the old secret
                // resurfaces on the next start and silently outlives the choice.
                await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
            }

            if (stillWanted && !stillWanted()) {
                if (previousStored === undefined) {
                    await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
                } else {
                    await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, previousStored);
                }
                this.memoryToken = previousMemory;
                return false;
            }

            this.memoryToken = token;
            this.credentialRevision++;
            return true;
        });
    }

    public async clear(): Promise<void> {
        await this.enqueue(() => this.clearInternal());
    }

    /**
     * Clear only while the credential is still the one the caller meant.
     *
     * A logout that awaits a server round trip, or a request that only learns its token was rejected
     * long after it was sent, can otherwise land on a credential the user acquired in the meantime and
     * silently sign them out of it.
     */
    public async clearIfUnchanged(revision: number): Promise<boolean> {
        return this.enqueue(async () => {
            if (this.credentialRevision !== revision) {
                return false;
            }
            await this.clearInternal();
            return true;
        });
    }

    /** The clear itself. Un-queued, because callers of this are already inside the queue. */
    private async clearInternal(): Promise<void> {
        this.memoryToken = undefined;
        this.credentialRevision++;

        if (this._useBearerAuth) {
            return;
        }

        try {
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        } catch (err) {
            logger.error('Failed to clear auth credentials from secrets:', LogCategory.AUTH, err);
        }
    }

}
