import type { EpisodeOutcomeLabel } from '@shared/messageContracts';

import type { AlertRecord } from '@extension/services/struggle/types';

import { isHardAlert } from './alertSuppression';
import { buildStruggleSignal } from './buildStruggleSignal';
import { decideOutcome } from './decideOutcome';
import type { InFlightMarker, OwedConfirmClose, StruggleInterventionDeps } from './interventionDeps';
import type { OfferController } from './offerController';
import type { RevealController } from './revealController';
import type { Episode, EpisodeHint } from './slot/episode';
import { newEpisode } from './slot/episode';
import type { PendingStamp } from './slot/guard';
import { InFlightGuard } from './slot/guard';
import type { SlotRuntime } from './slotRuntime';
import { TickRingBuffer } from './tickRingBuffer';

/**
 * What the outbound half needs from the orchestrator, beyond the shared runtime.
 *
 * The mirror of {@link import('./serverFrameHandler').ServerFramePort}: operations
 * only, with the shared state in {@link SlotRuntime}.
 */
export interface EgressPort {
    deps: StruggleInterventionDeps;
    reveal: RevealController;
    offers: OfferController;
    dbg(msg: string): void;
    /** Pre-throttle suppression: the dev-log reason, or null when the alert may proceed. */
    suppressReason(alert: AlertRecord): string | null;
    setInFlightMarker(v: InFlightMarker | undefined): void;
    setOwedConfirmClose(v: OwedConfirmClose | undefined): void;
    owedConfirmClose(): OwedConfirmClose | undefined;
    setServerAvailable(v: boolean): void;
    serverAvailable(): boolean;
    setCourseProactiveOff(v: boolean): void;
    awaitingEvidence(): boolean;
    setAwaitingEvidence(value: boolean, reason: string): void;
    deliveredEpisodeId(): string | undefined;
    clearEpisodeRuntime(): void;
    recordTerminalEpisode(episode: Episode, outcome: EpisodeOutcomeLabel): void;
    notifyChanged(): void;
}

/**
 * Everything this client says TO the server, and the wire bookkeeping that pairs
 * each POST with the reply it will eventually get back.
 *
 * Three things leave here: a `decide` when an alert survives the gates, a
 * `help_request` when the student accepts an offer, and a `confirm_close` when the
 * progress latch says the episode looks finished. All three are single-flight
 * through one in-flight marker, which is why they live together: the marker is
 * how a reply months later in wall-clock terms is matched to the request that
 * earned it, and it is the thing every consent-revoke guard re-checks.
 *
 * The accept/clear helpers are here rather than with the inbound handlers for the
 * same reason. They consume the marker this side stamped.
 */
export class EgressController {
    /** Ungated tick buffer; the alert's signal is built from a window of it. */
    private readonly _buffer = new TickRingBuffer(12);

    /** Async/generation guard: validates inbound replies against the live slot state. */
    readonly _guard = new InFlightGuard();

    /** Episode ids that have had at least one accepted POST (isNew flips to false for later POSTs). */
    readonly _continuedEpisodeIds = new Set<string>();

    constructor(private readonly _rt: SlotRuntime, private readonly _p: EgressPort) { }

    /** Fed every engine tick (ungated buffer fill). */
    pushTick(tick: Parameters<TickRingBuffer['push']>[0]): void { this._buffer.push(tick); }

    /** Drop the tick window. Called from the orchestrator's surface reset. */
    clearTicks(): void { this._buffer.clear(); }

    async handleAlert(alert: AlertRecord): Promise<void> {
        const suppressed = this._p.suppressReason(alert);
        if (suppressed !== null) {
            this._p.dbg(suppressed);
            return;
        }

        const preSlot = this._rt.slot.snapshot().state;
        if (preSlot.kind === 'delivered'
            && !(preSlot.level === 'ambient' && isHardAlert(alert))
            && this._p.offers.canRaiseStuckOfferNow(preSlot.episode.episodeId)) {
            this._p.offers.raiseStuckOffer();
            return;
        }

        // A hard alert is itself fresh evidence (build/terminal/paste = student action).
        if (this._p.awaitingEvidence() && isHardAlert(alert)) {
            this._p.setAwaitingEvidence(false, 'hard-boundary alert');
        }

        // Hoisted so the catch's #349 Finding 2 token guard can see it (set just before the POST).
        let requestToken: string | undefined;
        try {
            const signal = buildStruggleSignal(alert, this._buffer.snapshot());
            const snap = this._rt.slot.snapshot();

            const outcome = decideOutcome({
                optedIn: this._p.deps.isEgressEnabled(),
                inFlight: this._rt.inFlightMarker !== undefined,
                hasExercise: this._p.deps.getExerciseId() !== undefined,
                noaiMarker: this._p.deps.hasNoaiMarker(),
                serverAvailable: this._p.serverAvailable(),
            });

            this._p.dbg(`> ALERT t=${signal.alert.tSessionS}s boundary=${signal.alert.primaryBoundary} `
                + `severity=${signal.alert.severity.toFixed(2)} -> decision=${outcome} `
                + `(slot=${snap.state.kind}, gen=${snap.generation}, inFlight=${this._rt.inFlightMarker !== undefined})`);

            if (outcome === 'silent') {
                await this._p.deps.log.record({ action: 'requested', finalAction: 'silent', surface: 'none', source: 'local', signal });
                this._p.dbg('  -> SILENT (no egress path: no opt-in / .noai / server-unavailable)');
                return;
            }
            if (outcome === 'skip') {
                this._p.dbg('  -> SKIP (no POST, no surface)');
                return;
            }

            const exerciseId = this._p.deps.getExerciseId() as number;
            const hardEvent = isHardAlert(alert);

            // Episode preallocation: candidate for FREE/PARKED, live episode for DELIVERED
            let requestEpisode: { episodeId: string; isNew: boolean; hints: EpisodeHint[] };

            if (snap.state.kind === 'free') {
                this._rt.candidate = newEpisode(Date.now(), () => crypto.randomUUID(), exerciseId);
                requestEpisode = {
                    episodeId: this._rt.candidate.episodeId,
                    isNew: !this._continuedEpisodeIds.has(this._rt.candidate.episodeId),
                    hints: this._rt.candidate.hints,
                };
            } else if (snap.state.kind === 'parked') {
                // A new candidate for the possible replacement; the PARKED episode is never sent back
                this._rt.candidate = newEpisode(Date.now(), () => crypto.randomUUID(), exerciseId);
                requestEpisode = {
                    episodeId: this._rt.candidate.episodeId,
                    isNew: !this._continuedEpisodeIds.has(this._rt.candidate.episodeId),
                    hints: this._rt.candidate.hints,
                };
            } else {
                // DELIVERED: continue the live episode
                this._rt.candidate = undefined;
                const liveEp = snap.state.episode;
                requestEpisode = {
                    episodeId: liveEp.episodeId,
                    isNew: !this._continuedEpisodeIds.has(liveEp.episodeId),
                    hints: liveEp.hints,
                };
            }

            this._rt.lastSignal = signal;
            requestToken = crypto.randomUUID();

            // Stamp the guard BEFORE async collection (TOCTOU: a second alert must see in-flight)
            const stamp: PendingStamp = {
                episodeId: requestEpisode.episodeId,
                generation: snap.generation,
                hardEvent,
                requestToken,
            };
            const localToken = this._guard.issue('decide', stamp);
            this._p.setInFlightMarker({ requestToken, episodeId: requestEpisode.episodeId, generation: snap.generation, intent: 'decide', localToken, exerciseId });

            const uncommittedFiles = await this._p.deps.collectFiles(this._p.deps.getExerciseRoot());
            // Stash the exact bytes we send as the rebase baseline for the eventual anchor reply. The
            // marker is stable across this await (the in-flight guard blocks a second decide, and no
            // reply for this POST can exist yet), but key on the requestToken to be defensive.
            if (this._rt.inFlightMarker?.requestToken === requestToken) {
                this._rt.inFlightMarker.baseline = uncommittedFiles;
            }
            await this._p.deps.log.record({ action: 'requested', finalAction: 'silent', surface: 'none', source: 'server', signal });

            // #349 TOCTOU (spec 3.5): consent may have been revoked while awaiting the
            // file collection - nothing may leave the machine after a revoke. A revoke
            // clears the in-flight marker (onConsentRevoked -> reset), so a token
            // mismatch equally means this request was superseded. A POST already on
            // the wire below cannot be recalled; that residual window is accepted.
            if (!this._mayStillPost(requestToken)) {
                this._p.dbg('  -> ABORT (opted out or request superseded during collection)');
                return;
            }

            const result = await this._p.deps.postIntervention(exerciseId, {
                struggleSignal: signal,
                uncommittedFiles,
                intent: 'decide',
                episode: requestEpisode,
                requestToken,
                proactivityMode: this._p.deps.getProactiveLevel() === 'less' ? 'pull' : 'push',
            });

            this._p.dbg(`  -> POST result: ${result}`);

            if (result === 'accepted') {
                // This episode has now been seen by Pyris: record it so later requests send isNew=false.
                this._continuedEpisodeIds.add(requestEpisode.episodeId);
                // _inFlightMarker stays set until the websocket reply arrives (onServerAmbient/Active/Silent)
                return;
            }
            // #349 Finding 2: token-scoped settlement (mirror _sendHelpRequest ~L1382). If a
            // revoke->regrant issued a fresh marker while this POST was on the wire, a stale
            // completion must not clear or latch onto the new request's in-flight state. Only the
            // clearing/latching branches are gated; 'accepted' above deliberately keeps the marker.
            if (this._rt.inFlightMarker?.requestToken !== requestToken) {
                this._p.dbg('  -> POST settled but request superseded (token mismatch); leaving live marker untouched');
                return;
            }
            if (result === 'course-off') {
                // Panel refresh: the _setInFlightMarker below notifies, covering this latch flip.
                this._p.setCourseProactiveOff(true);
                this._p.setInFlightMarker(undefined);
                this._rt.candidate = undefined;
            } else if (result === 'unavailable') {
                this._p.setServerAvailable(false);
                this._p.setInFlightMarker(undefined);
                this._rt.candidate = undefined;
            } else {
                // 'failed': transient error -- release wire so next alert retries
                this._p.setInFlightMarker(undefined);
                this._rt.candidate = undefined;
            }
        } catch (err) {
            this._p.dbg(`  -> ERROR during intervention: ${err instanceof Error ? err.message : String(err)}`);
            // #349 Finding 2: only clear when THIS request still owns the wire (a throw after a
            // supersession must not kill the new request's marker).
            if (this._rt.inFlightMarker?.requestToken === requestToken) {
                this._p.setInFlightMarker(undefined);
                this._rt.candidate = undefined;
            }
        }
    }


    /**
     * Validate an inbound decide reply against the current in-flight marker + slot generation.
     * Returns the PendingStamp on match, null on stale/no-marker (stale drop).
     * Side effect: clears _inFlightMarker when accepted or when stale.
     */
    acceptDecide(): PendingStamp | null {
        if (!this._rt.inFlightMarker || this._rt.inFlightMarker.intent !== 'decide') {
            return null;
        }
        const snap = this._rt.slot.snapshot();
        const stamp = this._guard.accept(
            'decide',
            this._rt.inFlightMarker.localToken,
            this._rt.inFlightMarker.episodeId,
            snap.generation,
        );
        // Clear the in-flight marker regardless of result (the reply has landed)
        this._p.setInFlightMarker(undefined);
        return stamp;
    }

    /**
     * The student-controlled switches that must STILL hold when a `collectFiles` await returns.
     *
     * #349 re-validated consent after the await, but only consent: a `.noai` file appearing, Iris
     * being disabled, or proactivity being switched to Off during the collection would all still
     * have put the collected workspace content on the wire. Each of the three egress paths checks
     * some subset of these before its await; re-checking the whole set afterwards is defence in
     * depth on bytes that are already in memory. Deliberately excludes `serverAvailable()`, which
     * is a reachability latch rather than a student decision -- the POST result handles that.
     */
    private _egressStillAllowed(): boolean {
        return this._p.deps.isIrisEnabled()
            && this._p.deps.isEgressEnabled()
            && !this._p.deps.hasNoaiMarker()
            && this._p.deps.isStudentProactiveOn();
    }

    /**
     * The post-collection checkpoint every egress path runs: may `requestToken`'s payload still go
     * on the wire?
     *
     * Two ways to fail, and they need opposite handling. A token MISMATCH means this request was
     * superseded or already settled, so the marker belongs to somebody else and clearing it would
     * strand the live request. A closed gate means this request is still the live one and nobody
     * else will ever settle it, so it has to tear its own state down here or the wire stays busy
     * forever (and with it the chat's "preparing your hint" indicator). Before the gate widened,
     * the only way to fail it was a consent revoke, which clears the marker through its own path;
     * `.noai` and Iris-disabled have no such path.
     */
    private _mayStillPost(requestToken: string): boolean {
        if (this._rt.inFlightMarker?.requestToken !== requestToken) { return false; }
        if (this._egressStillAllowed()) { return true; }
        this.clearInFlight();
        return false;
    }

    /**
     * Validate an inbound help_request reply against the current in-flight marker + slot generation.
     * Returns the PendingStamp on match, null on stale/no-marker; clears the marker.
     * Package-internal (no `private`) so logic tests can exercise it directly.
     */
    acceptHelpRequest(): PendingStamp | null {
        if (!this._rt.inFlightMarker || this._rt.inFlightMarker.intent !== 'help_request') {
            return null;
        }
        const snap = this._rt.slot.snapshot();
        const stamp = this._guard.accept('help_request', this._rt.inFlightMarker.localToken, this._rt.inFlightMarker.episodeId, snap.generation);
        this._p.setInFlightMarker(undefined);
        return stamp;
    }

    /**
     * Clear in-flight marker without running guard validation (used on mid-flight drops
     * where we don't have a decide reply, e.g. student opt-out mid-flight).
     */
    clearInFlight(): void {
        this._p.setInFlightMarker(undefined);
        this._rt.candidate = undefined;
    }

    /**
     * Stale-row suppression (C4): called when a control frame is dropped as stale and
     * carries a `messageId` for its persisted chat row. Posts a live removeMessage to the
     * webview (removes any existing row AND suppresses future chat-ws arrivals of that id)
     * and enqueues a durable server-side delete so the row does not survive a reload.
     */
    dropStaleRow(messageId: number): void {
        this._p.deps.postRemoveMessage(messageId);
        const exerciseId = this._p.deps.getExerciseId();
        if (exerciseId !== undefined) {
            void this._p.deps.deleteSupersededProactiveMessage(exerciseId, messageId).catch(() => { /* best-effort */ });
        }
    }

    /**
     * POST a consented follow-up (help_request) for the live DELIVERED episode. Single-flight; the reply
     * lands in onServerActive (or onServerSilent for the silent edge). Requires a prior struggle signal.
     */
    async sendHelpRequest(): Promise<void> {
        const snap = this._rt.slot.snapshot();
        // A local boolean, not a direct narrow on `this._rt.inFlightMarker` (mirrors _handleAlert's
        // `inFlight` pattern) -- narrowing the field itself here would collapse it to `undefined`
        // for the rest of the method, breaking the later `this._rt.inFlightMarker?.baseline` write.
        const inFlight = this._rt.inFlightMarker !== undefined;
        if (snap.state.kind !== 'delivered' || inFlight || !this._rt.lastSignal) {
            return;
        }
        const exerciseId = this._p.deps.getExerciseId();
        if (exerciseId === undefined) {
            return;
        }
        // Egress gates can change between delivery and this consented click. An explicit "Show me"
        // never overrides a hard privacy block (.noai) or withdrawn consent / disabled course /
        // proactive-off / offline server (mirrors the decide path's decideOutcome gates). If blocked,
        // give an honest note instead of egressing the workspace.
        if (!this._p.deps.isIrisEnabled()
            || !this._p.deps.isEgressEnabled()
            || this._p.deps.hasNoaiMarker()
            || !this._p.deps.isStudentProactiveOn()
            || !this._p.serverAvailable()) {
            this._p.deps.postBubble('Nothing more I can add right now.', null, this._p.deliveredEpisodeId());
            return;
        }
        const ep = snap.state.episode;
        const requestToken = crypto.randomUUID();
        const requestEpisode = { episodeId: ep.episodeId, isNew: !this._continuedEpisodeIds.has(ep.episodeId), hints: ep.hints };
        const stamp: PendingStamp = { episodeId: ep.episodeId, generation: snap.generation, hardEvent: false, requestToken };
        const localToken = this._guard.issue('help_request', stamp);
        this._p.setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'help_request', localToken, exerciseId });
        try {
            const uncommittedFiles = await this._p.deps.collectFiles(this._p.deps.getExerciseRoot());
            if (this._rt.inFlightMarker?.requestToken === requestToken) {
                this._rt.inFlightMarker.baseline = uncommittedFiles;   // rebase baseline for an anchored follow-up
            }
            // #349 TOCTOU: re-validate every student switch + in-flight ownership after the await.
            if (!this._mayStillPost(requestToken)) {
                return;
            }
            const result = await this._p.deps.postIntervention(exerciseId, {
                struggleSignal: this._rt.lastSignal,
                uncommittedFiles,
                intent: 'help_request',
                episode: requestEpisode,
                requestToken,
                proactivityMode: this._p.deps.getProactiveLevel() === 'less' ? 'pull' : 'push',
            });
            // Only clear + surface the fallback if THIS request is still the live one. The episode may
            // have terminated (marker cleared by _clearEpisodeRuntime) or been superseded during the
            // await -- posting to _deliveredEpisodeId() then would land on a different/absent episode.
            if (result !== 'accepted' && this._rt.inFlightMarker?.requestToken === requestToken) {
                this._p.setInFlightMarker(undefined);
                this._p.deps.postBubble('Nothing more I can add right now.', null, this._p.deliveredEpisodeId());
            }
        } catch {
            if (this._rt.inFlightMarker?.requestToken === requestToken) {
                this._p.setInFlightMarker(undefined);
                this._p.deps.postBubble('Nothing more I can add right now.', null, this._p.deliveredEpisodeId());
            }
        }
    }

    /**
     * Propagate latch pending-post state -> _owedConfirmClose queue.
     * Called immediately after every latch.observe() call so the owed entry is always set
     * BEFORE _drainOwed -- even when the wire is busy (owed survives until wire frees).
     */
    propagateLatchToOwed(): void {
        if (!this._rt.latch.shouldPost() || this._p.owedConfirmClose()) { return; }
        const kind = this._rt.slot.snapshot().state.kind;
        if (kind === 'delivered') {
            this._p.setOwedConfirmClose({ confirmReason: 'progress' });
        } else if (kind === 'parked') {
            this._p.setOwedConfirmClose({ confirmReason: 'parked_progress' });
        }
    }

    async drainOwed(): Promise<void> {
        // Defense-in-depth: never egress code while Iris is disabled, mirrors the _suppressReason gate.
        if (!this._p.deps.isIrisEnabled()) { return; }
        // Defense-in-depth (#349): confirm_close carries uncommitted files - never egress
        // without the proactive consent (mirrors the isIrisEnabled gate above).
        if (!this._p.deps.isEgressEnabled()) { return; }
        // Same reasoning for the student's proactivity level: Off means nothing about this exercise
        // goes to the server, and a drain is the one egress path with no alert gating it upstream.
        if (!this._p.deps.isStudentProactiveOn()) { return; }
        // Wire must be free to drain. A local boolean, not a direct narrow on `this._rt.inFlightMarker`
        // (mirrors _sendHelpRequest's `inFlight` pattern) -- narrowing the field itself here would
        // collapse it to `undefined` for the rest of the method, breaking the later #349 TOCTOU
        // re-read of `this._rt.inFlightMarker?.requestToken` after the collectFiles await.
        const wireBusy = this._rt.inFlightMarker !== undefined;
        if (wireBusy) { return; }

        const snap = this._rt.slot.snapshot();
        if (snap.state.kind === 'free') { return; }

        const exerciseId = this._p.deps.getExerciseId();
        if (exerciseId === undefined) { return; }
        if (!this._rt.lastSignal) { return; }

        const owed = this._p.owedConfirmClose();
        if (owed) {
            const { confirmReason } = owed;
            const epState = snap.state;
            const ep = (epState.kind === 'delivered' || epState.kind === 'parked') ? epState.episode : null;
            if (!ep) { return; }

            const requestToken = crypto.randomUUID();
            const requestEpisode = {
                episodeId: ep.episodeId,
                isNew: !this._continuedEpisodeIds.has(ep.episodeId),
                hints: ep.hints,
            };
            const stamp: PendingStamp = { episodeId: ep.episodeId, generation: snap.generation, hardEvent: false, requestToken };
            const localToken = this._guard.issue('confirm_close', stamp);
            this._p.setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'confirm_close', localToken, exerciseId });

            try {
                const uncommittedFiles = await this._p.deps.collectFiles(this._p.deps.getExerciseRoot());
                // #349 TOCTOU: re-validate every student switch + in-flight ownership after the await.
                // `_owedConfirmClose` deliberately survives: the close is still owed, and the next
                // drain re-checks the same gates at its own top before collecting anything again.
                if (!this._mayStillPost(requestToken)) {
                    return;
                }
                const result = await this._p.deps.postIntervention(exerciseId, {
                    struggleSignal: this._rt.lastSignal,
                    uncommittedFiles,
                    intent: 'confirm_close',
                    episode: requestEpisode,
                    confirmReason,
                    requestToken,
                    proactivityMode: this._p.deps.getProactiveLevel() === 'less' ? 'pull' : 'push',
                });
                // #349 Finding 2: token-scoped settlement (mirror _sendHelpRequest). A stale
                // completion from a superseded confirm_close (revoke->regrant issued a fresh marker)
                // must not latch onto or clear the new request's in-flight state.
                if (this._rt.inFlightMarker?.requestToken !== requestToken) {
                    return;
                }
                if (result === 'accepted') {
                    this._continuedEpisodeIds.add(ep.episodeId);
                    this._p.setOwedConfirmClose(undefined);
                    this._rt.latch.onPosted();
                } else {
                    // Not accepted (job pending, course-off, etc.) -- retry next tick
                    this._p.setInFlightMarker(undefined);
                }
            } catch {
                if (this._rt.inFlightMarker?.requestToken === requestToken) {
                    this._p.setInFlightMarker(undefined);
                }
            }
            return;
        }

    }
}
