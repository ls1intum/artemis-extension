import * as vscode from 'vscode';

import { ApiError } from '@extension/domain/errors';
import { LogCategory, logger } from '@extension/services/loggingService';

import { normalizePrincipal } from './identityKeys';

/**
 * Who the extension is talking to, and on whose behalf.
 *
 * `resolving` separates "logged out" from "the token has not been checked
 * yet", which decides whether work may start. Without it activation runs an
 * anonymous workspace detection, reports that the folder has no exercise, and
 * has to reset and repeat it once the principal arrives.
 */
export type SessionState =
    | { kind: 'resolving'; serverKey: string }
    | { kind: 'anonymous'; serverKey: string }
    | { kind: 'authenticated'; serverKey: string; principal: string };

/**
 * The reset, in one place and one order. Components expose narrow methods and
 * do NOT each subscribe to auth events: independent subscribers make the reset
 * order nondeterministic, and the next component someone adds quietly forgets
 * the invariant.
 */
export interface SessionResetTargets {
    /** Leave the Iris websocket subscription and drop the open conversation. */
    resetConversation(): void;
    /**
     * Close the struggle detector's exercise session.
     *
     * Its own target rather than a line inside `clearWorkspaceTracker`: the
     * telemetry bridge ignores the tracker's clear event (a clear announces no
     * new exercise), so nothing else ends the session, and
     * `startExerciseSession` is a no-op when the next identity's exercise
     * carries the same numeric id. A session spanning two accounts is corrupt
     * research data.
     */
    endTelemetrySession(): void;
    clearWorkspaceTracker(): void;
    /** Clears the catalog AND installs the new epoch on it. */
    clearCatalog(): void;
    resetRegistry(): void;
    publishEmptyChatSnapshot(): void;
    /** A fresh startup latch. Admitted intent never crosses an identity. */
    rearmStartup(): void;
}

/**
 * The read-only slice a report needs: which account, which server, which
 * generation. Narrow on purpose, so a diagnostics path cannot also transition
 * the session it is describing.
 */
export interface SessionIdentityReader {
    readonly state: SessionState;
    readonly epoch: number;
}

/**
 * What the coordinator needs to answer "who is this" on its own. Narrow on
 * purpose: it must not depend on any webview being open.
 */
export interface SessionIdentityDeps {
    /** The configured server, already normalized. Read fresh: it can change. */
    serverKey(): string;
    hasAuthToken(): Promise<boolean>;
    getCurrentUser(): Promise<{ id?: number; login?: string }>;
}

/**
 * How long to wait before each automatic re-attempt of a principal lookup that
 * failed for a reason a retry can plausibly fix. Short enough that a network
 * blip at activation heals before the student notices, bounded so a server
 * that is genuinely down is not hammered and the session does not spin forever.
 */
const RESOLVE_RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

function sameSession(a: SessionState, b: SessionState): boolean {
    if (a.kind !== b.kind || a.serverKey !== b.serverKey) { return false; }
    return a.kind !== 'authenticated' || a.principal === (b as typeof a).principal;
}

function describe(state: SessionState): string {
    return state.kind === 'authenticated'
        ? `authenticated ${state.principal} on ${state.serverKey}`
        : `${state.kind} on ${state.serverKey}`;
}

export class SessionIdentityCoordinator implements vscode.Disposable {
    private _state: SessionState;
    private _epoch = 0;
    private _targets: SessionResetTargets | undefined;
    /**
     * Bumped by every published intent, including the ones that turn out to
     * be no-ops. A principal lookup captures it and publishes only while it
     * is still the current attempt: a logout, a 401 or a server change during
     * an open `getCurrentUser` must not be undone by its late answer.
     */
    private _attempt = 0;
    /** How many automatic re-attempts the current lookup has already spent. */
    private _retriesUsed = 0;
    private _retryTimer: ReturnType<typeof setTimeout> | undefined;
    private _disposed = false;

    private readonly _onDidChangeSession = new vscode.EventEmitter<SessionState>();
    public readonly onDidChangeSession = this._onDidChangeSession.event;

    /**
     * Identity resolution gave up while still `resolving`, and no automatic
     * re-attempt is pending.
     *
     * Deliberately NOT a fourth `SessionState`: the session really is still
     * resolving (a credential is held, nobody has been logged out). A separate
     * signal keeps that state single-meaning while letting the one UI that
     * waits on an identity offer a way out instead of spinning forever.
     */
    private readonly _onDidStallResolution = new vscode.EventEmitter<void>();
    public readonly onDidStallResolution = this._onDidStallResolution.event;

    constructor(private readonly _deps: SessionIdentityDeps) {
        this._state = { kind: 'resolving', serverKey: _deps.serverKey() };
    }

    /**
     * Establishes who the student is, from the token and the server. THE
     * entry point for becoming authenticated.
     *
     * Not driven off `AppStateManager`: the flow that writes it runs inside
     * the Artemis sidebar's view resolution, so a student who only opens the
     * Iris chat would leave this session `resolving` forever and workspace
     * detection would never run.
     */
    public async resolvePrincipal(): Promise<void> {
        // Deliberately does NOT refill the retry budget. The budget belongs to
        // an unresolved-identity EPISODE, not to a call, and is refilled when
        // the identity settles (see `_transition`). Refilling here would treat
        // the chat's Retry like an unattended activation: a click against a
        // server that is still down would replace the outage screen, the Retry
        // and the course chooser with a spinner for the whole budget.
        this._cancelPendingRetry();
        await this._attemptResolve();
    }

    private async _attemptResolve(): Promise<void> {
        const serverKey = this._deps.serverKey();
        this.beginResolving(serverKey);
        const attempt = this._attempt;

        let hasToken: boolean;
        try {
            hasToken = await this._deps.hasAuthToken();
        } catch (error) {
            // Reading the stored token failed. That is not evidence of
            // absence, and clearing anything on it would be destructive.
            logger.warn('Could not read the stored token; session stays resolving', LogCategory.AUTH, error);
            this._stall(attempt, true);
            return;
        }
        if (attempt !== this._attempt) { return; }
        if (!hasToken) { this.setAnonymous(serverKey); return; }

        let user: { id?: number; login?: string };
        try {
            user = await this._deps.getCurrentUser();
        } catch (error) {
            if (attempt !== this._attempt) { return; }
            // Only a 401 means the token is actually invalid. A timeout, a
            // network error or a 5xx is a reachability blip, and treating it
            // as anonymous would contradict the credential still being held,
            // the same rule `AuthFlowHandler` already follows.
            if (error instanceof ApiError && error.status === 401) {
                this.setAnonymous(serverKey);
                return;
            }
            logger.warn('Could not verify the session principal; staying resolving', LogCategory.AUTH, error);
            this._stall(attempt, true);
            return;
        }
        if (attempt !== this._attempt) { return; }

        const principal = normalizePrincipal({ id: user.id, login: user.login });
        if (!principal) {
            // Authenticated but unnameable. Everything scoped per account is
            // keyed on this string, so claiming a session we cannot key would
            // put one student's data under another's key. Repeating the same
            // request would return the same unnameable user, so this stalls
            // immediately rather than retrying.
            logger.warn('Authenticated user has neither an id nor a login; session stays resolving', LogCategory.AUTH);
            this._stall(attempt, false);
            return;
        }
        this.setAuthenticated(serverKey, principal);
    }

    /**
     * The lookup ended without an identity. Schedules the next automatic
     * re-attempt if the failure is one a retry can fix and the budget allows,
     * and otherwise announces that the session is stuck so a UI waiting on it
     * can offer the student a way out.
     */
    private _stall(attempt: number, retryable: boolean): void {
        // A newer intent has already superseded this lookup, so its outcome is
        // not the session's outcome and must neither retry nor announce.
        if (this._disposed || attempt !== this._attempt) { return; }
        const delay = retryable ? RESOLVE_RETRY_DELAYS_MS[this._retriesUsed] : undefined;
        if (delay === undefined) {
            this._onDidStallResolution.fire();
            return;
        }
        this._retriesUsed++;
        this._retryTimer = setTimeout(() => {
            this._retryTimer = undefined;
            // Anything that happened in the meantime (a login, a logout, a
            // server change, an explicit retry) is newer than this timer.
            // Disposal needs no check of its own: `dispose` clears the timer,
            // so a disposed coordinator never reaches this callback.
            if (attempt !== this._attempt) { return; }
            void this._attemptResolve();
        }, delay);
    }

    private _cancelPendingRetry(): void {
        if (this._retryTimer !== undefined) {
            clearTimeout(this._retryTimer);
            this._retryTimer = undefined;
        }
    }

    /**
     * Wired once, at activation, after every component exists. Until then a
     * transition still bumps the epoch; nothing has been populated yet, so
     * there is nothing to reset.
     */
    public attach(targets: SessionResetTargets): void {
        this._targets = targets;
    }

    public get state(): SessionState { return this._state; }
    public get epoch(): number { return this._epoch; }

    /** The scope for anything stored per account. Only an authenticated session has one. */
    public accessScope(): { serverKey: string; principal: string } | null {
        return this._state.kind === 'authenticated'
            ? { serverKey: this._state.serverKey, principal: this._state.principal }
            : null;
    }

    public beginResolving(serverKey: string): void {
        this._transition({ kind: 'resolving', serverKey });
    }

    public setAnonymous(serverKey: string): void {
        this._transition({ kind: 'anonymous', serverKey });
    }

    public setAuthenticated(serverKey: string, principal: string): void {
        this._transition({ kind: 'authenticated', serverKey, principal });
    }

    private _transition(next: SessionState): void {
        // BEFORE the equality check. A repeated `beginResolving` is a no-op
        // for the state but still a newer intent, and an in-flight principal
        // lookup has to lose to it.
        this._attempt++;
        if (next.kind !== 'resolving') {
            // The identity question just got an answer, so the NEXT episode of
            // not having one starts patient again. This is the only refill:
            // starting a lookup does not earn one (see `resolvePrincipal`).
            this._retriesUsed = 0;
        }
        if (sameSession(this._state, next)) { return; }
        this._state = next;
        this._epoch++;
        logger.info(`Session identity is now ${describe(next)} (epoch ${this._epoch})`, LogCategory.AUTH);
        const targets = this._targets;
        if (targets) {
            // Order matters: the conversation lets go of its websocket
            // subscription before anything it points at disappears, the
            // detector's session is closed while the exercise it belongs to is
            // still known, and the registry is rebuilt from a catalog that has
            // already been cleared. The startup latch is re-armed LAST, so the
            // fresh cold start it permits sees an empty world rather than half
            // of one.
            targets.resetConversation();
            targets.endTelemetrySession();
            targets.clearWorkspaceTracker();
            targets.clearCatalog();
            targets.resetRegistry();
            targets.publishEmptyChatSnapshot();
            targets.rearmStartup();
        }
        this._onDidChangeSession.fire(next);
    }

    public dispose(): void {
        this._disposed = true;
        this._cancelPendingRetry();
        this._onDidChangeSession.dispose();
        this._onDidStallResolution.dispose();
    }
}
