import * as vscode from 'vscode';
import * as crypto from 'crypto';

import type { ArtemisApiService } from '@extension/api';
import type { ArtemisUser } from '@extension/domain';
import { LogCategory, logger } from '@extension/services/loggingService';
import { normalizeServerUrl } from '@extension/services/session/identityKeys';
import { CONFIG, resolveServerUrl } from '@extension/utils';
import { generateCodeChallenge, generateCodeVerifier } from '@extension/utils/pkce';

import type { AuthManager } from './authManager';
import { LoginCancelledError } from './loginCancelledError';

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
 * - Cleanup is best effort. SecretStorage has no compare-and-delete, so a delete that fails during
 *   cancellation can leave a record a later callback still finds. That record is not enough to redeem
 *   the attempt, though: `invalidatedAttempts` remembers every cancelled attempt id for the life of this
 *   host, so a stray callback for one is refused rather than signing the user back in.
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

    /** The attempt this host started, so a cancellation can name the one it retracts. */
    private currentAttemptId?: string;

    /**
     * Attempts the user has retracted. Per attempt rather than a single flag, because a flag would be
     * cleared by the next `start()`, and the cancelled attempt's callback could then still redeem its
     * record. In memory, so this is a guarantee for as long as this host lives.
     */
    private readonly invalidatedAttempts = new Set<string>();

    /**
     * The most recent cancellation's cleanup. `start()` waits on it, so retracting one attempt and
     * immediately beginning another cannot end with the older cancellation deleting the newer record.
     */
    private pendingCleanup: Promise<void> = Promise.resolve();

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
        this.currentAttemptId = attemptId;
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const rawServerUrl = resolveServerUrl();
        const serverUrl = normalizeServerUrl(rawServerUrl) ?? rawServerUrl;

        // Any cancellation still cleaning up belongs to the attempt this one replaces. Writing the new
        // record first would let that cleanup delete it.
        await this.pendingCleanup;

        await this.context.secrets.store(
            CONFIG.SECRET_KEYS.OIDC_PENDING_LOGIN,
            JSON.stringify({ attemptId, codeVerifier, rememberMe, startedAt: Date.now(), serverUrl }),
        );

        if (this.invalidatedAttempts.has(attemptId)) {
            // The user cancelled while the record was being written. Opening the browser now would hand
            // them a sign-in they already retracted.
            await this.discardAttempt(attemptId);
            throw new LoginCancelledError();
        }

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
        if (this.currentAttemptId) {
            // The generation alone only catches a cancellation that happens after `complete()` captured
            // it. This catches one that happens before, while the record deletion is still in flight.
            this.invalidatedAttempts.add(this.currentAttemptId);
        }
        this.pendingCleanup = this.deletePendingRecord();
        await this.pendingCleanup;
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
        this.assertStillWanted(generation, pending);

        const rawToken = await this.artemisApi.exchangeCodeForToken(code, pending.codeVerifier);
        const token = this.authManager.formatToken(rawToken);

        const user = await this.artemisApi.getCurrentUserWithToken(token);

        // Re-checked immediately before the commit rather than only up front. Both calls above resolve the
        // server URL when they run, so without this a token from the previous server could be stored
        // against the new one, and a logout during the exchange would be undone. Distinct from the
        // `stillWanted` predicate below: this one still tells a server switch apart from a cancellation,
        // which matters here because nothing has been written yet for either to have to undo.
        this.assertStillWanted(generation, pending);

        const committed = await this.authManager.storeArtemisCredentials(
            token,
            pending.rememberMe,
            () => this.isStillWanted(generation, pending),
        );
        if (!committed) {
            throw new LoginCancelledError();
        }

        return user;
    }

    /** Whether this attempt is still the one the user is waiting for, on the server they are on. */
    private isStillWanted(generation: number, pending: PendingOidcLogin): boolean {
        if (this.cancelGeneration !== generation || this.invalidatedAttempts.has(pending.attemptId)) {
            return false;
        }
        const rawServerUrl = resolveServerUrl();
        const currentServerUrl = normalizeServerUrl(rawServerUrl) ?? rawServerUrl;
        return pending.serverUrl === currentServerUrl;
    }

    /** Throws unless this attempt is still the one the user is waiting for, on the server they are on. */
    private assertStillWanted(generation: number, pending: PendingOidcLogin): void {
        if (this.cancelGeneration !== generation || this.invalidatedAttempts.has(pending.attemptId)) {
            throw new LoginCancelledError();
        }

        const rawServerUrl = resolveServerUrl();
        const currentServerUrl = normalizeServerUrl(rawServerUrl) ?? rawServerUrl;
        if (pending.serverUrl !== currentServerUrl) {
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
