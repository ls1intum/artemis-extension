import * as vscode from 'vscode';
import * as crypto from 'crypto';

import type { ArtemisApiService } from '@extension/api';
import type { ArtemisUser } from '@extension/domain';
import { LogCategory, logger } from '@extension/services/loggingService';
import { normalizeServerUrl } from '@extension/services/session/identityKeys';
import { CONFIG, resolveServerUrl } from '@extension/utils';
import { generateCodeChallenge, generateCodeVerifier } from '@extension/utils/pkce';

import type { AuthManager } from './authManager';

/**
 * How long a pending attempt stays redeemable locally.
 *
 * Deliberately longer than the server's five minute exchange window, because the two clocks start at
 * different moments: this one when the browser opens, the server's only once the identity provider is
 * done. Matching five to five would reject a code the server still considers fresh whenever the sign-in
 * itself took a few minutes. The server remains the authority on whether a code is still good; this bound
 * only stops an abandoned attempt lingering indefinitely.
 */
const PENDING_TTL_MS = 30 * 60 * 1000;

/** RFC 7636 section 4.1, and the pattern the Artemis server validates against. */
const CODE_VERIFIER_PATTERN = /^[a-zA-Z0-9\-._~]{43,128}$/;

interface PendingOidcLogin {
    /** Distinguishes attempts, so one attempt's cleanup cannot discard another's record. */
    attemptId: string;
    codeVerifier: string;
    rememberMe: boolean;
    startedAt: number;
    /** Normalized, so a code issued by one server cannot be redeemed against another. */
    serverUrl: string;
}

function isPendingOidcLogin(value: unknown): value is PendingOidcLogin {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<PendingOidcLogin>;
    return typeof candidate.attemptId === 'string' && candidate.attemptId.length > 0
        && typeof candidate.codeVerifier === 'string' && CODE_VERIFIER_PATTERN.test(candidate.codeVerifier)
        && typeof candidate.rememberMe === 'boolean'
        && typeof candidate.startedAt === 'number' && Number.isFinite(candidate.startedAt)
        && typeof candidate.serverUrl === 'string' && candidate.serverUrl.length > 0;
}

/**
 * Owns one OIDC login attempt from the moment the browser is opened to the moment a token is committed.
 *
 * The attempt is kept in SecretStorage rather than in memory so it survives an extension host reload,
 * which is otherwise a dead end: the browser comes back with a code and nothing is left to redeem it with.
 *
 * Two limits are deliberate, because the server echoes no `state` and therefore no callback can be
 * attributed to the window that started it:
 *
 * - Last start wins. Starting a second attempt replaces the first, and concurrent OIDC logins from two
 *   windows are not supported.
 * - Cleanup is best effort. SecretStorage has no compare-and-delete, so the attempt id narrows the window
 *   in which a stale attempt's cleanup could discard a newer record without closing it, and a delete that
 *   fails during cancellation can leave a record a later callback could still redeem. A resolved `cancel()`
 *   is therefore not proof that no callback can arrive.
 */
export class OidcLoginService {
    /**
     * Bumped by every cancellation. `complete()` captures it up front and refuses to commit if it moved,
     * because consuming the record is not enough on its own: once `complete()` has taken it, a later
     * `cancel()` has nothing left to delete, and the exchange still in flight would sign the user back in
     * after they logged out. In-memory is the right scope, since logging out and switching server happen
     * in the window that is doing the completing.
     */
    private cancelGeneration = 0;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly authManager: AuthManager,
        private readonly artemisApi: ArtemisApiService,
    ) {}

    /**
     * Begin an attempt: derive the PKCE pair, record it, and hand the user to the browser.
     *
     * Throws if the browser could not be opened, having first removed the record it just wrote. Leaving it
     * behind would let a later stray callback redeem an attempt the user never actually made.
     */
    public async start(rememberMe: boolean): Promise<void> {
        const attemptId = crypto.randomUUID();
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const rawServerUrl = resolveServerUrl();
        const serverUrl = normalizeServerUrl(rawServerUrl) ?? rawServerUrl;

        await this.context.secrets.store(
            CONFIG.SECRET_KEYS.OIDC_PENDING_LOGIN,
            JSON.stringify({ attemptId, codeVerifier, rememberMe, startedAt: Date.now(), serverUrl }),
        );

        try {
            const url = `${rawServerUrl}/oauth2/authorization/oidc`
                + `?redirect=vscode&rememberMe=${rememberMe}&code_challenge=${encodeURIComponent(codeChallenge)}`;

            // `openExternal` reports a refusal by resolving false, so the result has to be read rather
            // than only awaited.
            const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
            if (!opened) {
                throw new Error('The browser could not be opened to complete the sign-in.');
            }
        } catch (error) {
            await this.discardAttempt(attemptId);
            throw error;
        }
    }

    /**
     * Drop whatever attempt is pending. Used where the user has said so: Back, logout, a server change.
     *
     * Unconditional by intent, and best effort: a failing delete is logged and swallowed so it cannot break
     * a logout, which means callers must not read a resolved call as a guarantee.
     */
    public async cancel(): Promise<void> {
        // Only a real cancellation moves the generation. Consuming a record on the way to redeeming it
        // deletes the same key but is emphatically not the user changing their mind.
        this.cancelGeneration++;
        await this.deletePendingRecord();
    }

    /** Remove the stored record without declaring the attempt cancelled. Best effort by design. */
    private async deletePendingRecord(): Promise<void> {
        try {
            await this.context.secrets.delete(CONFIG.SECRET_KEYS.OIDC_PENDING_LOGIN);
        } catch (error) {
            logger.warn('Could not discard the pending OIDC login', LogCategory.AUTH, error);
        }
    }

    /**
     * Redeem a callback code and, only once the resulting token has been shown to work, commit it.
     *
     * The order matters: exchange, then check the candidate against the server, then store. A failure at
     * any point leaves an existing session exactly as it was, which is the difference between a failed
     * login and being logged out by one.
     */
    public async complete(code: string): Promise<ArtemisUser> {
        // Captured before anything is awaited, so a cancellation racing the exchange is still noticed.
        const generation = this.cancelGeneration;

        const pending = await this.consumePending();
        if (!pending) {
            throw new Error('This sign-in is no longer valid. Please start the login again.');
        }
        this.assertStillWanted(generation, pending.serverUrl);

        const rawToken = await this.artemisApi.exchangeCodeForToken(code, pending.codeVerifier);
        const token = this.authManager.formatToken(rawToken);

        const user = await this.artemisApi.getCurrentUserWithToken(token);

        // Re-checked immediately before the commit rather than only up front. Both calls above resolve the
        // server URL when they run, so without this a token from the previous server could be stored
        // against the new one, and a logout during the exchange would be undone.
        this.assertStillWanted(generation, pending.serverUrl);
        await this.authManager.storeArtemisCredentials(token, pending.rememberMe);

        return user;
    }

    /** Throws unless this attempt is still the one the user is waiting for, on the server they are on. */
    private assertStillWanted(generation: number, attemptServerUrl: string): void {
        if (this.cancelGeneration !== generation) {
            throw new Error('This sign-in was cancelled. Please start the login again.');
        }

        const rawServerUrl = resolveServerUrl();
        const currentServerUrl = normalizeServerUrl(rawServerUrl) ?? rawServerUrl;
        if (attemptServerUrl !== currentServerUrl) {
            throw new Error('This sign-in belongs to a different Artemis server. Please start the login again.');
        }
    }

    /** Read and remove the pending record. Anything malformed or expired counts as absent. */
    private async consumePending(): Promise<PendingOidcLogin | undefined> {
        const stored = await this.context.secrets.get(CONFIG.SECRET_KEYS.OIDC_PENDING_LOGIN);
        if (!stored) {
            return undefined;
        }
        await this.deletePendingRecord();

        let parsed: unknown;
        try {
            parsed = JSON.parse(stored);
        } catch {
            return undefined;
        }
        if (!isPendingOidcLogin(parsed)) {
            return undefined;
        }

        const age = Date.now() - parsed.startedAt;
        // A negative age means the clock moved or the record was tampered with, so it is not trustworthy.
        if (age < 0 || age >= PENDING_TTL_MS) {
            return undefined;
        }
        return parsed;
    }

    /** Remove a record only while it still belongs to the attempt that is cleaning up after itself. */
    private async discardAttempt(attemptId: string): Promise<void> {
        try {
            const stored = await this.context.secrets.get(CONFIG.SECRET_KEYS.OIDC_PENDING_LOGIN);
            if (!stored) {
                return;
            }
            const parsed: unknown = JSON.parse(stored);
            if (isPendingOidcLogin(parsed) && parsed.attemptId !== attemptId) {
                // A newer attempt has taken over; leaving its record alone is the point of the id.
                return;
            }
        } catch {
            // An unreadable record is worth removing regardless.
        }
        await this.deletePendingRecord();
    }
}
