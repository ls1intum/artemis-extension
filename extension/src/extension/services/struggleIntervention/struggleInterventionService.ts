import type { EpisodeHistoryEntry, EpisodeOutcomeLabel, SlotDebugSnapshot } from '@shared/messageContracts';

import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';

import { isHardAlert, suppressReason } from './alertSuppression';
import { buildStruggleSignal } from './buildStruggleSignal';
import { decideOutcome } from './decideOutcome';
import { EpisodeHistory } from './episodeHistory';
import type { InFlightMarker, OwedConfirmClose, StruggleInterventionDeps } from './interventionDeps';
import { DEFAULT_PROGRESS_CFG } from './interventionDeps';
import type { OutstandingOffer } from './offerController';
import { OfferController } from './offerController';
import { RevealController } from './revealController';
import type { ServerFramePort } from './serverFrameHandler';
import { ServerFrameHandler } from './serverFrameHandler';
import type { EpisodeHint } from './slot/episode';
import type { Episode } from './slot/episode';
import { newEpisode } from './slot/episode';
import type { PendingStamp } from './slot/guard';
import { InFlightGuard } from './slot/guard';
import { ProgressCloseLatch } from './slot/progressClose';
import { SlotManager } from './slot/slotManager';
import { StaleWatchdog } from './slot/staleWatchdog';
import type { SlotRuntime } from './slotRuntime';
import { newSlotRuntime } from './slotRuntime';
import type { StruggleSignal } from './struggleContract';
import { TickRingBuffer } from './tickRingBuffer';

/** Re-exported so importers (five test suites among them) keep the original path. */
export type { StruggleInterventionDeps } from './interventionDeps';


/**
 * Orchestrates the proactive struggle intervention on the client (spec §4). Implements {@link AlertSink}; alerts
 * arrive via the coordinator's sink chain (BackoffGate -> ThrottledAlertSink -> this, see telemetry/index.ts)
 * with no settings gate (#352: consent gates the engine, level/gates/throttle gate the surfaces) and the
 * `reset()`/`resetSession()` teardown calls stay authoritative. Ticks are fed via {@link onTick} (wired in
 * extension.ts from `coordinator.onDidTick`). vscode-free at runtime -- only type imports; all effects injected.
 */
export class StruggleInterventionService implements AlertSink {
    private readonly _buffer = new TickRingBuffer(12);
    private _serverAvailable = true;
    private _courseProactiveOff = false;


    /**
     * The state the inbound and outbound halves of the server exchange both write.
     * See {@link SlotRuntime} for why these seven live together rather than as
     * fourteen accessor pairs across a port.
     */
    private readonly _rt: SlotRuntime;

    // Slot-core state, forwarded (package-internal test seam: the suites read and assign
    // these ~280 times, so the names stay exactly as they were and hand back the live objects).
    get _slot(): SlotManager { return this._rt.slot; }
    get _guard(): InFlightGuard { return this._inFlightGuard; }
    get _latch(): ProgressCloseLatch { return this._rt.latch; }
    get _watchdog(): StaleWatchdog | undefined { return this._rt.watchdog; }
    set _watchdog(v: StaleWatchdog | undefined) { this._rt.watchdog = v; }
    get _candidate(): Episode | undefined { return this._rt.candidate; }
    set _candidate(v: Episode | undefined) { this._rt.candidate = v; }
    get _inFlightMarker(): InFlightMarker | undefined { return this._rt.inFlightMarker; }
    set _inFlightMarker(v: InFlightMarker | undefined) { this._rt.inFlightMarker = v; }
    get _lastSignal(): StruggleSignal | undefined { return this._rt.lastSignal; }
    set _lastSignal(v: StruggleSignal | undefined) { this._rt.lastSignal = v; }
    get _frozenSessionId(): number | undefined { return this._rt.frozenSessionId; }
    set _frozenSessionId(v: number | undefined) { this._rt.frozenSessionId = v; }

    // Owed confirmClose (at most one; queued while the wire is busy). Not in SlotRuntime:
    // only the outbound half and the close scheduler touch it.
    _owedConfirmClose: OwedConfirmClose | undefined;

    // Async/generation guard: validates inbound websocket replies against the live slot state
    private readonly _inFlightGuard = new InFlightGuard();

    // The inbound half of the exchange: every reply the server can send.
    private readonly _frames: ServerFrameHandler;

    // Episode ids that have had at least one accepted POST (isNew flipped to false for future POSTs)
    private _continuedEpisodeIds = new Set<string>();

    // The proactive help offers (Moment-1 / Moment-3) and the three pieces of state only they write.
    private readonly _offers: OfferController;

    // Reveal persistence + the terminal outcomes that race it (owns the consent-epoch generation).
    private readonly _reveal: RevealController;


    /**
     * Evidence gate after idle-abandon: set when the stale watchdog silently frees a slot
     * (force-free / free-silent). While set, non-hard-boundary alerts are dropped pre-throttle
     * (no POST, no delivery-budget consumption), so a walked-away session cannot re-hint on
     * idle alone. Cleared by fresh student activity: a typing tick (one-char inserts), a
     * hard-boundary alert, a new green test, or an explicit proactive re-enable. Session-only;
     * a reload is covered by the D1 warmup instead.
     */
    private _awaitingEvidence = false;

    private readonly _history = new EpisodeHistory();
    private _slotChangeScheduled = false;

    /** Last live-episode value pushed to the chat (SetLiveEpisode frame); dedups by value. */
    private _lastChatLiveEpisodeId: string | null = null;

    constructor(private readonly _deps: StruggleInterventionDeps) {
        this._rt = newSlotRuntime(new ProgressCloseLatch(
            _deps.progressCloseCfg ?? DEFAULT_PROGRESS_CFG,
        ));
        this._reveal = new RevealController({
            deps: _deps,
            dbg: (msg) => this._dbg(msg),
            notifyChanged: () => this.notifySlotDebugChanged(),
        });
        this._offers = new OfferController({
            deps: _deps,
            slotSnapshot: () => this._slot.snapshot(),
            deliveredEpisodeId: () => this._deliveredEpisodeId(),
            isWireBusy: () => this._inFlightMarker !== undefined,
            resetWatchdogProgress: () => this._watchdog?.resetProgress(Date.now()),
            sendHelpRequest: () => { void this._sendHelpRequest(); },
        });
        this._frames = new ServerFrameHandler(this._rt, this._framePort());
    }

    /** Snapshot of the slot/intervention runtime for the dev dashboard. Pure read, never throws. */
    getSlotDebugSnapshot(): SlotDebugSnapshot {
        const snap = this._slot.snapshot();
        const st = snap.state;
        const episode = st.kind === 'free' ? undefined : st.episode;
        const now = Date.now();
        const m = this._inFlightMarker;
        return {
            nowMs: now,
            state: st.kind,
            level: st.kind === 'parked' ? 'ambient' : st.kind === 'delivered' ? st.level : null,
            episodeId: episode?.episodeId ?? null,
            generation: snap.generation,
            episodeAgeMs: episode ? now - episode.createdAtMs : null,
            hintCount: episode?.hints.length ?? 0,
            isNew: episode ? !this._continuedEpisodeIds.has(episode.episodeId) : false,
            inSession: snap.inSession,
            watchdog: {
                armed: this._watchdog?.isArmed() ?? false,
                staleDeadlineMs: this._watchdog?.staleDeadlineMs() ?? null,
            },
            inFlight: m
                ? { intent: m.intent, localToken: m.localToken, episodeId: m.episodeId, generation: m.generation, requestToken: m.requestToken }
                : null,
            owed: { confirmClose: this._owedConfirmClose !== undefined },
            pendingOutcomes: this._reveal.pendingOutcomeCount,
            awaitingEvidence: this._awaitingEvidence,
            suppression: {
                serverAvailable: this._serverAvailable,
                courseProactiveOff: this._courseProactiveOff,
                studentProactiveOn: this._deps.isStudentProactiveOn(),
            },
        };
    }

    /** The in-memory, session-only episode history (newest last). */
    getEpisodeHistory(): readonly EpisodeHistoryEntry[] {
        return this._history.entries;
    }

    /** Append a terminal episode to the session history. Wall-clock is passed in, not read there. */
    private recordTerminalEpisode(episode: Episode, outcome: EpisodeOutcomeLabel): void {
        this._history.record(episode, outcome, Date.now());
    }

    /**
     * Coalesced slot-change notification (one push per sync mutation branch). Serves two sinks:
     * the live-episode chat frame (product: keeps the webview's fold gate in sync with the slot)
     * and the optional debug push. Always scheduled - the chat frame must fire even when the
     * debug seam (onSlotChange) is not wired.
     */
    private notifySlotDebugChanged(): void {
        if (this._slotChangeScheduled) { return; }
        this._slotChangeScheduled = true;
        queueMicrotask(() => {
            this._slotChangeScheduled = false;
            this._pushChatLiveEpisode();
            if (this._deps.onSlotChange) {
                try { this._deps.onSlotChange(); } catch { /* best-effort: debug push must never break the feature */ }
            }
        });
    }

    /** The DELIVERED episode's id, or undefined when the slot is not delivered. */
    private _deliveredEpisodeId(): string | undefined {
        const state = this._slot.snapshot().state;
        return state.kind === 'delivered' ? state.episode.episodeId : undefined;
    }

    /**
     * Push the live-episode snapshot to the chat webview when it changed (SetLiveEpisode frame).
     * PARKED is deliberately not live: no chat rows exist for a parked episode.
     */
    private _pushChatLiveEpisode(): void {
        const live = this._deliveredEpisodeId() ?? null;
        if (live === this._lastChatLiveEpisodeId) { return; }
        this._lastChatLiveEpisodeId = live;
        try { this._deps.setChatLiveEpisode(live); } catch { /* best-effort: chat push must never break the engine */ }
    }

    // Notifying setters (complete-by-construction notify coverage).
    private _setInFlightMarker(v: InFlightMarker | undefined): void { this._inFlightMarker = v; this.notifySlotDebugChanged(); }
    private _setOwedConfirmClose(v: OwedConfirmClose | undefined): void { this._owedConfirmClose = v; this.notifySlotDebugChanged(); }
    private _setAwaitingEvidence(value: boolean, reason: string): void {
        if (this._awaitingEvidence === value) { return; }
        this._awaitingEvidence = value;
        this._dbg(`  -> EVIDENCE GATE ${value ? 'set' : 'cleared'} (${reason})`);
        this.notifySlotDebugChanged();
    }

    /** Value-guarded latch setter so the suppression panel refreshes on every heal/trip. */
    private _setServerAvailable(value: boolean): void {
        if (this._serverAvailable === value) { return; }
        this._serverAvailable = value;
        this.notifySlotDebugChanged();
    }

    /** Test seam (package-internal, unchanged by the split): the live map, now owned by RevealController. */
    get _pendingOutcomes(): Map<string, { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }> { return this._reveal.pendingOutcomes; }

    /** Record the student's terminal outcome for an episode (A10 episode-keyed endpoint). */
    applyEpisodeOutcome(episodeId: string, outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED'): Promise<void> {
        return this._reveal.applyEpisodeOutcome(episodeId, outcome);
    }

    /** Fed every engine tick (ungated buffer fill). Wired externally so we don't bypass coordinator gating. */
    onTick(tick: TickRecord): void {
        this._buffer.push(tick);
        // Typing evidence (one-char inserts in the feature window): clears the idle-abandon gate
        // AND defers the idle watchdog. Typing is activity, so the idle stretch is no longer
        // continuous ("any activity postpones the silent free"); without the deferral, a
        // threshold tick that carries both typing and a due watchdog deadline would abandon the
        // episode and re-set the gate in the same tick the student returned.
        if (tick.features.typingRate > 0) {
            this._setAwaitingEvidence(false, 'typing evidence');
            if (this._watchdog) {
                this._watchdog.resetProgress(tick.ts);
                this.notifySlotDebugChanged();
            }
        }
        // C3: feed progress latch with sBase from tick (newGreenTest path goes through onNewBuildResult)
        this._latch.observe(tick.ts, tick.sBase, false);
        this._propagateLatchToOwed();
        // Sustained sBase drop (student recovering): defer the stale watchdog.
        // Fires on every tick whose sBase is below the re-arm threshold, regardless of edit
        // locality; NOT on new green tests (those go through onNewBuildResult which uses Date.now()).
        // Note: spec §13 force-free bound is conditional on sBase >= 0.6; an engaged student
        // with moderate-low severity (returning resolved=false) can hold the DELIVERED slot.
        if (tick.sBase < (this._deps.progressCloseCfg ?? DEFAULT_PROGRESS_CFG).reArmSBase) {
            // Only a live watchdog has a stale deadline that this can move; on a FREE slot
            // resetProgress is a no-op, so notifying here would republish an unchanged FREE
            // snapshot every tick (the spec's "not a per-tick refresh" intent). Guard on it.
            if (this._watchdog) {
                this._watchdog.resetProgress(tick.ts);
                this.notifySlotDebugChanged();
            }
        }
        // C3: tick the watchdog with the coordinator timestamp (wall-clock ms in live; replay-injected in tests)
        this._handleWatchdogTick(tick.ts);
        // C3: drain any owed confirmClose (wire may now be free)
        void this._drainOwed();
    }

    /** Called by the build-result watcher when a build produces a strict new high in passed tests. */
    onNewBuildResult(newGreenTest: boolean): void {
        if (!newGreenTest) { return; }
        // A new green test is fresh student activity: clear the idle-abandon gate.
        this._setAwaitingEvidence(false, 'new green test');
        // Use Date.now() for the latch since it cares about real time, not session time
        this._latch.observe(Date.now(), 1.0 /* above any threshold, won't fire sBase path */, true);
        this._propagateLatchToOwed();
        // Hard progress: defer the stale watchdog so it does not fire while the student advances
        this._watchdog?.resetProgress(Date.now());
        this.notifySlotDebugChanged();
        void this._drainOwed();
    }

    /**
     * C3: called by extension.ts when the chat-view visibility changes.
     * NON-semantic: does not bump the slot generation.
     */
    setInSession(open: boolean): void {
        this._slot.setInSession(open);
        this._dbg(`  -> IN-SESSION ${open ? 'open' : 'closed'} (slot=${this._slot.snapshot().state.kind})`);
        this.notifySlotDebugChanged();
    }

    /** AlertSink.deliver -- reached for every engine alert that passed the BackoffGate + throttle chain (#352: no settings gate). */
    deliver(alert: AlertRecord): void {
        void this._handleAlert(alert);
    }

    /** Developer-mode diagnostic line (gated upstream); no-op when devLog is not injected. */
    private _dbg(msg: string): void {
        this._deps.devLog?.(msg);
    }

    /**
     * Pre-throttle suppression (the BackoffSource predicate {@link shouldSuppress} wraps this).
     * Returns the dev-log reason, or null when the alert may proceed.
     */
    private _suppressReason(alert: AlertRecord): string | null {
        return suppressReason(alert, {
            irisEnabled: this._deps.isIrisEnabled(),
            courseProactiveOff: this._courseProactiveOff,
            studentProactiveOn: this._deps.isStudentProactiveOn(),
            awaitingEvidence: this._awaitingEvidence,
            slot: this._slot.snapshot().state,
            canRaiseStuckOfferNow: (episodeId) => this._offers.canRaiseStuckOfferNow(episodeId),
        });
    }

    /** BackoffSource: drop a suppressed alert above the throttle so it does not consume delivery budget. */
    shouldSuppress(alert: AlertRecord): boolean {
        return this._suppressReason(alert) !== null;
    }

    private async _handleAlert(alert: AlertRecord): Promise<void> {
        const suppressed = this._suppressReason(alert);
        if (suppressed !== null) {
            this._dbg(suppressed);
            return;
        }

        const preSlot = this._slot.snapshot().state;
        if (preSlot.kind === 'delivered'
            && !(preSlot.level === 'ambient' && isHardAlert(alert))
            && this._offers.canRaiseStuckOfferNow(preSlot.episode.episodeId)) {
            this._offers.raiseStuckOffer();
            return;
        }

        // A hard alert is itself fresh evidence (build/terminal/paste = student action).
        if (this._awaitingEvidence && isHardAlert(alert)) {
            this._setAwaitingEvidence(false, 'hard-boundary alert');
        }

        // Hoisted so the catch's #349 Finding 2 token guard can see it (set just before the POST).
        let requestToken: string | undefined;
        try {
            const signal = buildStruggleSignal(alert, this._buffer.snapshot());
            const snap = this._slot.snapshot();

            const outcome = decideOutcome({
                optedIn: this._deps.isEgressEnabled(),
                inFlight: this._inFlightMarker !== undefined,
                hasExercise: this._deps.getExerciseId() !== undefined,
                noaiMarker: this._deps.hasNoaiMarker(),
                serverAvailable: this._serverAvailable,
            });

            this._dbg(`> ALERT t=${signal.alert.tSessionS}s boundary=${signal.alert.primaryBoundary} `
                + `severity=${signal.alert.severity.toFixed(2)} -> decision=${outcome} `
                + `(slot=${snap.state.kind}, gen=${snap.generation}, inFlight=${this._inFlightMarker !== undefined})`);

            if (outcome === 'silent') {
                await this._deps.log.record({ action: 'requested', finalAction: 'silent', surface: 'none', source: 'local', signal });
                this._dbg('  -> SILENT (no egress path: no opt-in / .noai / server-unavailable)');
                return;
            }
            if (outcome === 'skip') {
                this._dbg('  -> SKIP (no POST, no surface)');
                return;
            }

            const exerciseId = this._deps.getExerciseId() as number;
            const hardEvent = isHardAlert(alert);

            // Episode preallocation: candidate for FREE/PARKED, live episode for DELIVERED
            let requestEpisode: { episodeId: string; isNew: boolean; hints: EpisodeHint[] };

            if (snap.state.kind === 'free') {
                this._candidate = newEpisode(Date.now(), () => crypto.randomUUID(), exerciseId);
                requestEpisode = {
                    episodeId: this._candidate.episodeId,
                    isNew: !this._continuedEpisodeIds.has(this._candidate.episodeId),
                    hints: this._candidate.hints,
                };
            } else if (snap.state.kind === 'parked') {
                // A new candidate for the possible replacement; the PARKED episode is never sent back
                this._candidate = newEpisode(Date.now(), () => crypto.randomUUID(), exerciseId);
                requestEpisode = {
                    episodeId: this._candidate.episodeId,
                    isNew: !this._continuedEpisodeIds.has(this._candidate.episodeId),
                    hints: this._candidate.hints,
                };
            } else {
                // DELIVERED: continue the live episode
                this._candidate = undefined;
                const liveEp = snap.state.episode;
                requestEpisode = {
                    episodeId: liveEp.episodeId,
                    isNew: !this._continuedEpisodeIds.has(liveEp.episodeId),
                    hints: liveEp.hints,
                };
            }

            this._lastSignal = signal;
            requestToken = crypto.randomUUID();

            // Stamp the guard BEFORE async collection (TOCTOU: a second alert must see in-flight)
            const stamp: PendingStamp = {
                episodeId: requestEpisode.episodeId,
                generation: snap.generation,
                hardEvent,
                requestToken,
            };
            const localToken = this._guard.issue('decide', stamp);
            this._setInFlightMarker({ requestToken, episodeId: requestEpisode.episodeId, generation: snap.generation, intent: 'decide', localToken, exerciseId });

            const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
            // Stash the exact bytes we send as the rebase baseline for the eventual anchor reply. The
            // marker is stable across this await (the in-flight guard blocks a second decide, and no
            // reply for this POST can exist yet), but key on the requestToken to be defensive.
            if (this._inFlightMarker?.requestToken === requestToken) {
                this._inFlightMarker.baseline = uncommittedFiles;
            }
            await this._deps.log.record({ action: 'requested', finalAction: 'silent', surface: 'none', source: 'server', signal });

            // #349 TOCTOU (spec 3.5): consent may have been revoked while awaiting the
            // file collection - nothing may leave the machine after a revoke. A revoke
            // clears the in-flight marker (onConsentRevoked -> reset), so a token
            // mismatch equally means this request was superseded. A POST already on
            // the wire below cannot be recalled; that residual window is accepted.
            if (!this._deps.isEgressEnabled() || this._inFlightMarker?.requestToken !== requestToken) {
                this._dbg('  -> ABORT (consent revoked or request superseded during collection)');
                return;
            }

            const result = await this._deps.postIntervention(exerciseId, {
                struggleSignal: signal,
                uncommittedFiles,
                intent: 'decide',
                episode: requestEpisode,
                requestToken,
                proactivityMode: this._deps.getProactiveLevel() === 'less' ? 'pull' : 'push',
            });

            this._dbg(`  -> POST result: ${result}`);

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
            if (this._inFlightMarker?.requestToken !== requestToken) {
                this._dbg('  -> POST settled but request superseded (token mismatch); leaving live marker untouched');
                return;
            }
            if (result === 'course-off') {
                // Panel refresh: the _setInFlightMarker below notifies, covering this latch flip.
                this._courseProactiveOff = true;
                this._setInFlightMarker(undefined);
                this._candidate = undefined;
            } else if (result === 'unavailable') {
                this._setServerAvailable(false);
                this._setInFlightMarker(undefined);
                this._candidate = undefined;
            } else {
                // 'failed': transient error -- release wire so next alert retries
                this._setInFlightMarker(undefined);
                this._candidate = undefined;
            }
        } catch (err) {
            this._dbg(`  -> ERROR during intervention: ${err instanceof Error ? err.message : String(err)}`);
            // #349 Finding 2: only clear when THIS request still owns the wire (a throw after a
            // supersession must not kill the new request's marker).
            if (this._inFlightMarker?.requestToken === requestToken) {
                this._setInFlightMarker(undefined);
                this._candidate = undefined;
            }
        }
    }


    /**
     * Validate an inbound decide reply against the current in-flight marker + slot generation.
     * Returns the PendingStamp on match, null on stale/no-marker (stale drop).
     * Side effect: clears _inFlightMarker when accepted or when stale.
     */
    private _acceptDecide(): PendingStamp | null {
        if (!this._inFlightMarker || this._inFlightMarker.intent !== 'decide') {
            return null;
        }
        const snap = this._slot.snapshot();
        const stamp = this._guard.accept(
            'decide',
            this._inFlightMarker.localToken,
            this._inFlightMarker.episodeId,
            snap.generation,
        );
        // Clear the in-flight marker regardless of result (the reply has landed)
        this._setInFlightMarker(undefined);
        return stamp;
    }

    /**
     * Validate an inbound help_request reply against the current in-flight marker + slot generation.
     * Returns the PendingStamp on match, null on stale/no-marker; clears the marker.
     * Package-internal (no `private`) so logic tests can exercise it directly.
     */
    _acceptHelpRequest(): PendingStamp | null {
        if (!this._inFlightMarker || this._inFlightMarker.intent !== 'help_request') {
            return null;
        }
        const snap = this._slot.snapshot();
        const stamp = this._guard.accept('help_request', this._inFlightMarker.localToken, this._inFlightMarker.episodeId, snap.generation);
        this._setInFlightMarker(undefined);
        return stamp;
    }

    /**
     * Clear in-flight marker without running guard validation (used on mid-flight drops
     * where we don't have a decide reply, e.g. student opt-out mid-flight).
     */
    private _clearInFlight(): void {
        this._setInFlightMarker(undefined);
        this._candidate = undefined;
    }

    /**
     * Stale-row suppression (C4): called when a control frame is dropped as stale and
     * carries a `messageId` for its persisted chat row. Posts a live removeMessage to the
     * webview (removes any existing row AND suppresses future chat-ws arrivals of that id)
     * and enqueues a durable server-side delete so the row does not survive a reload.
     */
    private _dropStaleRow(messageId: number): void {
        this._deps.postRemoveMessage(messageId);
        const exerciseId = this._deps.getExerciseId();
        if (exerciseId !== undefined) {
            void this._deps.deleteSupersededProactiveMessage(exerciseId, messageId).catch(() => { /* best-effort */ });
        }
    }

    private _handleWatchdogTick(nowMs: number): void {
        if (!this._watchdog) { return; }
        const snap = this._slot.snapshot();
        if (snap.state.kind === 'free') { return; }

        const event = this._watchdog.tick(nowMs);
        if (event === null) { return; }

        const exerciseId = this._deps.getExerciseId();

        switch (event.kind) {
            case 'pre-abandon-warn': {
                this._dbg('  -> WATCHDOG pre-abandon-warn: Moment-3 offer');
                const ep = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
                if (!ep || this._inFlightMarker !== undefined) { break; }
                // A stale stuck offer (an ignored in-session bubble has no countdown) must not block the
                // more-urgent Moment-3 presence check -- supersede it, then raise the abandon offer.
                if (this._offers.outstanding?.moment === 'stuck') {
                    this._offers.clearOutstanding();
                }
                if (this._offers.outstanding === undefined) {
                    this._offers.raiseAbandonOffer(ep.episodeId);
                }
                break;
            }
            case 'force-free': {
                // Scoped cancel lives in _clearEpisodeRuntime.
                this._dbg('  -> WATCHDOG force-free: DELIVERED -> FREE (ABANDONED)');
                const deliveredEp = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
                const episodeId = deliveredEp?.episodeId;

                if (deliveredEp) { this.recordTerminalEpisode(deliveredEp, 'ABANDONED'); }
                this._slot.free();
                this._clearEpisodeRuntime();

                if (episodeId && exerciseId !== undefined) {
                    this._reveal.writeOutcomeWithBackfill(exerciseId, episodeId, 'ABANDONED');
                    this._deps.foldEpisode(episodeId, 'ABANDONED');
                }
                this._setAwaitingEvidence(true, 'idle-abandon force-free');
                break;
            }
            case 'free-silent': {
                // PARKED terminal: free silently (no row, no foldEpisode). Scoped cancel lives in
                // _clearEpisodeRuntime.
                this._dbg('  -> WATCHDOG free-silent: PARKED -> FREE (silent)');
                const parkedEp = snap.state.kind === 'parked' ? snap.state.episode : undefined;
                if (parkedEp) { this.recordTerminalEpisode(parkedEp, 'DISCARDED'); }
                this._slot.free();
                this._clearEpisodeRuntime();
                this._setAwaitingEvidence(true, 'idle-abandon free-silent');
                break;
            }
        }
    }

    /**
     * POST a consented follow-up (help_request) for the live DELIVERED episode. Single-flight; the reply
     * lands in onServerActive (or onServerSilent for the silent edge). Requires a prior struggle signal.
     */
    async _sendHelpRequest(): Promise<void> {
        const snap = this._slot.snapshot();
        // A local boolean, not a direct narrow on `this._inFlightMarker` (mirrors _handleAlert's
        // `inFlight` pattern) -- narrowing the field itself here would collapse it to `undefined`
        // for the rest of the method, breaking the later `this._inFlightMarker?.baseline` write.
        const inFlight = this._inFlightMarker !== undefined;
        if (snap.state.kind !== 'delivered' || inFlight || !this._lastSignal) {
            return;
        }
        const exerciseId = this._deps.getExerciseId();
        if (exerciseId === undefined) {
            return;
        }
        // Egress gates can change between delivery and this consented click. An explicit "Show me"
        // never overrides a hard privacy block (.noai) or withdrawn consent / disabled course /
        // proactive-off / offline server (mirrors the decide path's decideOutcome gates). If blocked,
        // give an honest note instead of egressing the workspace.
        if (!this._deps.isIrisEnabled()
            || !this._deps.isEgressEnabled()
            || this._deps.hasNoaiMarker()
            || !this._deps.isStudentProactiveOn()
            || !this._serverAvailable) {
            this._deps.postBubble('Nothing more I can add right now.', null, this._deliveredEpisodeId());
            return;
        }
        const ep = snap.state.episode;
        const requestToken = crypto.randomUUID();
        const requestEpisode = { episodeId: ep.episodeId, isNew: !this._continuedEpisodeIds.has(ep.episodeId), hints: ep.hints };
        const stamp: PendingStamp = { episodeId: ep.episodeId, generation: snap.generation, hardEvent: false, requestToken };
        const localToken = this._guard.issue('help_request', stamp);
        this._setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'help_request', localToken, exerciseId });
        try {
            const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
            if (this._inFlightMarker?.requestToken === requestToken) {
                this._inFlightMarker.baseline = uncommittedFiles;   // rebase baseline for an anchored follow-up
            }
            // #349 TOCTOU: re-validate consent + in-flight ownership after the await.
            if (!this._deps.isEgressEnabled() || this._inFlightMarker?.requestToken !== requestToken) {
                return;
            }
            const result = await this._deps.postIntervention(exerciseId, {
                struggleSignal: this._lastSignal,
                uncommittedFiles,
                intent: 'help_request',
                episode: requestEpisode,
                requestToken,
                proactivityMode: this._deps.getProactiveLevel() === 'less' ? 'pull' : 'push',
            });
            // Only clear + surface the fallback if THIS request is still the live one. The episode may
            // have terminated (marker cleared by _clearEpisodeRuntime) or been superseded during the
            // await -- posting to _deliveredEpisodeId() then would land on a different/absent episode.
            if (result !== 'accepted' && this._inFlightMarker?.requestToken === requestToken) {
                this._setInFlightMarker(undefined);
                this._deps.postBubble('Nothing more I can add right now.', null, this._deliveredEpisodeId());
            }
        } catch {
            if (this._inFlightMarker?.requestToken === requestToken) {
                this._setInFlightMarker(undefined);
                this._deps.postBubble('Nothing more I can add right now.', null, this._deliveredEpisodeId());
            }
        }
    }

    /**
     * Propagate latch pending-post state -> _owedConfirmClose queue.
     * Called immediately after every latch.observe() call so the owed entry is always set
     * BEFORE _drainOwed -- even when the wire is busy (owed survives until wire frees).
     */
    private _propagateLatchToOwed(): void {
        if (!this._latch.shouldPost() || this._owedConfirmClose) { return; }
        const kind = this._slot.snapshot().state.kind;
        if (kind === 'delivered') {
            this._setOwedConfirmClose({ confirmReason: 'progress' });
        } else if (kind === 'parked') {
            this._setOwedConfirmClose({ confirmReason: 'parked_progress' });
        }
    }

    private async _drainOwed(): Promise<void> {
        // Defense-in-depth: never egress code while Iris is disabled, mirrors the _suppressReason gate.
        if (!this._deps.isIrisEnabled()) { return; }
        // Defense-in-depth (#349): confirm_close carries uncommitted files - never egress
        // without the proactive consent (mirrors the isIrisEnabled gate above).
        if (!this._deps.isEgressEnabled()) { return; }
        // Wire must be free to drain. A local boolean, not a direct narrow on `this._inFlightMarker`
        // (mirrors _sendHelpRequest's `inFlight` pattern) -- narrowing the field itself here would
        // collapse it to `undefined` for the rest of the method, breaking the later #349 TOCTOU
        // re-read of `this._inFlightMarker?.requestToken` after the collectFiles await.
        const wireBusy = this._inFlightMarker !== undefined;
        if (wireBusy) { return; }

        const snap = this._slot.snapshot();
        if (snap.state.kind === 'free') { return; }

        const exerciseId = this._deps.getExerciseId();
        if (exerciseId === undefined) { return; }
        if (!this._lastSignal) { return; }

        if (this._owedConfirmClose) {
            const { confirmReason } = this._owedConfirmClose;
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
            this._setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'confirm_close', localToken, exerciseId });

            try {
                const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
                // #349 TOCTOU: re-validate consent + in-flight ownership after the await.
                if (!this._deps.isEgressEnabled() || this._inFlightMarker?.requestToken !== requestToken) {
                    return;
                }
                const result = await this._deps.postIntervention(exerciseId, {
                    struggleSignal: this._lastSignal,
                    uncommittedFiles,
                    intent: 'confirm_close',
                    episode: requestEpisode,
                    confirmReason,
                    requestToken,
                    proactivityMode: this._deps.getProactiveLevel() === 'less' ? 'pull' : 'push',
                });
                // #349 Finding 2: token-scoped settlement (mirror _sendHelpRequest). A stale
                // completion from a superseded confirm_close (revoke->regrant issued a fresh marker)
                // must not latch onto or clear the new request's in-flight state.
                if (this._inFlightMarker?.requestToken !== requestToken) {
                    return;
                }
                if (result === 'accepted') {
                    this._continuedEpisodeIds.add(ep.episodeId);
                    this._setOwedConfirmClose(undefined);
                    this._latch.onPosted();
                } else {
                    // Not accepted (job pending, course-off, etc.) -- retry next tick
                    this._setInFlightMarker(undefined);
                }
            } catch {
                if (this._inFlightMarker?.requestToken === requestToken) {
                    this._setInFlightMarker(undefined);
                }
            }
            return;
        }

    }

    /**
     * Called on EVERY terminal transition (slot free). Tears down the progress latch, watchdog,
     * owed requests, and the live-ask binding (which neutralises any pending ABANDON timers).
     * Also performs a scoped server-side cancel for any in-flight request so the job slot is
     * freed. revealParkedHint is NOT terminal and cancels its own in-flight separately.
     *
     * Clears the episode-scoped inline cue AND the episode-scoped lamp (parked reveal-lamp or active
     * jump lamp): both belong to the episode, so every terminal exit (RECOVERED close,
     * watchdog/ABANDON force-free, dismiss, new-exercise) retires them here in one place. The lamp
     * clear is mode-guarded (clearEpisodeLamp), which only clears the parked/jump modes.
     * This is the inline cue's ONLY lifecycle clear besides the hover Hide/Dismiss actions:
     * typing does not retire it (the decoration merely tracks line shifts), so a missed terminal
     * clear here would leave the cue standing forever.
     */
    private _clearEpisodeRuntime(): void {
        this._deps.clearInline();
        this._deps.clearEpisodeLamp();
        this._deps.hideActiveBanner();
        // The activity-bar badge marks an OUTSTANDING proactive hint, so it belongs to the live
        // episode: clear it on every terminal exit (RECOVERED close, watchdog/ABANDON force-free,
        // dismiss, new-exercise), the same one-place teardown as the other episode surfaces above.
        // Without this it strands at "1" after a solved/timed-out close (#343).
        this._deps.setBadge(false);
        this._latch.reset();
        this._watchdog?.disarm();
        this._watchdog = undefined;
        this._setOwedConfirmClose(undefined);
        // Scoped server-side cancel: free the outstanding job before nulling the marker.
        // revealParkedHint (non-terminal) cancels its own in-flight and does NOT call here.
        // replace-parked / replace-delivered (non-terminal) do NOT call here either, so
        // the in-flight decide completing into the replacement is NOT cancelled.
        if (this._inFlightMarker) {
            const exerciseId = this._inFlightMarker.exerciseId;
            if (exerciseId !== undefined) {
                const token = this._inFlightMarker.requestToken;
                this._deps.cancelOutstandingStruggleJob(exerciseId, token).catch(() => { /* best-effort */ });
            }
        }
        // Clear the in-flight marker (slot is terminal, nothing to reply to)
        this._setInFlightMarker(undefined);
        this._candidate = undefined;
        // An offer still outstanding when the episode terminates (RECOVERED / DISMISSED / any
        // force-free) must be resolved + cleared here, the single terminal chokepoint. Otherwise
        // _outstandingOffer strands and _canRaiseStuckOfferNow blocks every future offer this exercise.
        this._offers.clearOutstanding();
        this.notifySlotDebugChanged();
    }

    // ---- Offers: the package-internal seam the suites drive, forwarded to OfferController ----
    //
    // These members are the offers' declared internal API and ~25 assertions read or
    // assign them. The state moved; the seam did not, and the accessors hand back the
    // collaborator's own Map/Set so a test that mutates one still drives the real thing.

    get _outstandingOffer(): OutstandingOffer | undefined { return this._offers.outstanding; }
    set _outstandingOffer(v: OutstandingOffer | undefined) { this._offers.outstanding = v; }
    get _offeredHintCounts(): Map<string, number> { return this._offers.offeredHintCounts; }
    get _offersDeclined(): Set<string> { return this._offers.offersDeclined; }
    _canOfferStuck(episodeId: string): boolean { return this._offers.canOfferStuck(episodeId); }

    /** Moment-1 "Show me": generate + deliver the next hint. */
    acceptOffer(offerId: string, episodeId: string): void { this._offers.accept(offerId, episodeId); }

    /** Moment-1 "Not now": quiet for this episode. */
    declineOffer(offerId: string, episodeId: string): void { this._offers.decline(offerId, episodeId); }

    /** A stuck offer's out-of-session banner auto-closed; a later alert may offer again. */
    offerTimedOut(offerId: string, episodeId: string): void { this._offers.timedOut(offerId, episodeId); }

    /** Moment-3 "I'm still on it": keep watching, reset the idle clock, no hint, no POST. */
    stillOnIt(offerId: string, episodeId: string): void { this._offers.stillOnIt(offerId, episodeId); }

    /** Moment-3 "I need more help": deliver on demand, overriding an exhausted cap. */
    needMoreHelp(offerId: string, episodeId: string): void { this._offers.needMoreHelp(offerId, episodeId); }

    /**
     * C8: Episode-scoped dismiss. Called by the card Dismiss button (via the provider callback
     * seam) and by the active banner's "Not now" action (via the telemetry closure).
     *
     * For the live DELIVERED episode: frees the slot, tears down episode runtime, writes the
     * DISMISSED outcome (best-effort, A10 first-terminal-wins), and folds the episode without
     * praise.
     *
     * If `episodeId` is passed and does not match the live slot episode (mismatch guard): writes
     * the DISMISSED outcome only - no slot free, no fold, no runtime teardown.
     *
     * If the slot is already FREE (double-dismiss) or PARKED: idempotent outcome write only for
     * the passed `episodeId` (A10 first-terminal-wins rejects any duplicate write).
     */
    public dismissEpisode(episodeId?: string): void {
        this._manualCloseEpisode(episodeId, 'DISMISSED');
    }

    /**
     * Manual "Solved it" close: the student self-reports success, so the episode terminates with a
     * RECOVERED outcome (positive: the fold line is a success summary and Pyris/eval see the hint as
     * having helped). Mirrors {@link dismissEpisode} exactly except for the outcome; both share
     * {@link _manualCloseEpisode}. Unlike the auto-detected RECOVERED close there is no LLM praise row,
     * so the fold carries no praise.
     */
    public resolveEpisode(episodeId?: string): void {
        this._manualCloseEpisode(episodeId, 'RECOVERED');
    }

    /**
     * Shared manual-close path for the two chat-card actions (DISMISSED / RECOVERED). For the live
     * DELIVERED episode it frees the slot, tears down episode runtime, writes the outcome (best-effort,
     * A10 first-terminal-wins) and folds without praise; on a mismatch / already-free / PARKED slot it
     * only writes the idempotent outcome for the passed id (no slot free, no fold).
     */
    private _manualCloseEpisode(episodeId: string | undefined, outcome: 'DISMISSED' | 'RECOVERED'): void {
        const snapState = this._slot.snapshot().state;
        const liveEpisodeId = snapState.kind === 'delivered' ? snapState.episode.episodeId : undefined;
        const exerciseId = this._deps.getExerciseId();
        this._dbg(`  -> MANUAL CLOSE (${outcome}) episode=${episodeId ?? liveEpisodeId ?? 'n/a'} (slot=${snapState.kind})`);

        // Determine the target for the outcome write (passed arg wins; fall back to live)
        const targetEpisodeId = episodeId ?? liveEpisodeId;

        // Free the slot only if DELIVERED and the passed id matches (or none passed)
        const matchesLive = episodeId === undefined || episodeId === liveEpisodeId;
        const shouldFreeSlot = snapState.kind === 'delivered' && matchesLive;

        if (shouldFreeSlot) {
            this.recordTerminalEpisode((snapState as Extract<typeof snapState, { kind: 'delivered' }>).episode, outcome);
            this._slot.free();
            this._clearEpisodeRuntime();
            if (targetEpisodeId && exerciseId !== undefined) {
                this._reveal.writeOutcomeWithBackfill(exerciseId, targetEpisodeId, outcome);
                this._deps.foldEpisode(targetEpisodeId, outcome);
            }
        } else if (targetEpisodeId && exerciseId !== undefined) {
            // Slot already FREE, PARKED, or episodeId mismatch: idempotent outcome write only.
            this._reveal.writeOutcomeWithBackfill(exerciseId, targetEpisodeId, outcome);
        }
    }

    /**
     * The two §14 gate causes, independently (spec §14 cases 4-5): `consentMissing` = no proactive-egress
     * consent (student-fixable, drives the consent-missing card + the forced-Off level, #342);
     * `serverUnavailable` = 404-latched server (drives the limited card). Session-global, no exercise id.
     */
    getProactiveGateState(): { consentMissing: boolean; serverUnavailable: boolean } {
        return { consentMissing: !this._deps.isEgressEnabled(), serverUnavailable: !this._serverAvailable };
    }

    setStudentProactive(exerciseId: number, on: boolean): void {
        if (on) {
            // On = "the student is present in THIS exercise": only reset the active exercise's evidence
            // gate when the toggle came from the active exercise (keep the id guard).
            if (this._deps.getExerciseId() !== exerciseId) { return; }
            this._setAwaitingEvidence(false, 'proactive re-enabled');
        } else {
            // Off is a GLOBAL level (#341): clear the active exercise's surfaces regardless of which
            // exercise view triggered it. The orchestrator already targets the active exercise, so this
            // is always the right instance to clear.
            this._deps.clearLamp();
            this._deps.clearInline();
            this._deps.setBadge(false);
            this._deps.hideActiveBanner();
            this._offers.clearOutstanding();
        }
    }

    /**
     * AlertSink.reset -- shared surface-clearing helper invoked by the consent/session teardown paths
     * (no standalone production caller; level-Off clears surfaces via its own path). Clears
     * ALL surfaces (incl. the lamp) + the in-flight slot, but DELIBERATELY KEEPS the per-session latches
     * (404 / course-off) and the active cap: a mid-session surface clear must not silently lift a latch.
     */
    reset(): void {
        this._buffer.clear();
        this._setInFlightMarker(undefined);
        this._candidate = undefined;
        this._lastSignal = undefined;
        this._deps.setBadge(false);
        this._deps.clearLamp();
        this._deps.clearInline();
        this._deps.hideActiveBanner();
    }

    /**
     * AlertSink.onConsentRevoked (#349) - the consent-revocation path. Terminates the
     * local episode/slot/in-flight state and clears every visible surface. "No egress"
     * means no STUDENT-CODE egress: when a request is in flight, _clearEpisodeRuntime
     * deliberately still sends the scoped control-plane cancel (requestToken only, no
     * code/signal) so the server abandons the job it already holds - privacy-positive.
     * KEEPS the per-session latches (404 / course-off) and the delivery budget:
     * revoking and regranting must not refill the throttle or lift a latch. Compare
     * resetSession() (new exercise: latches + budget DO reset) and reset() (surfaces
     * only: a DELIVERED slot would survive and suppress fresh alerts after a regrant).
     */
    onConsentRevoked(): void {
        // #349 Finding 3: invalidate any scheduled reveal-persist retry (same generation bump
        // resetSession uses). Without this, a retry scheduled before the revoke would fire and
        // egress episode + hint content through revealAmbient while consent is disabled.
        this._reveal.invalidateInFlight();
        if (!this._slot.isFree()) {
            const st = this._slot.snapshot().state;
            if (st.kind === 'delivered') { this.recordTerminalEpisode(st.episode, 'INTERRUPTED'); }
            else if (st.kind === 'parked') { this.recordTerminalEpisode(st.episode, 'DISCARDED'); }
            this._dbg('  -> CONSENT REVOKED: slot -> FREE');
            this._slot.free();
        }
        this._clearEpisodeRuntime();
        this._offers.clearOutstanding();
        this._setAwaitingEvidence(false, 'consent revoked');
        this.reset();
        this.notifySlotDebugChanged();
    }

    /**
     * New-exercise reset: clear the per-session latches (404 / course-off), then the UI/session state.
     * Also frees the slot, clears the frozen session id, and clears pending outcomes (C2: new exercise
     * = clean state).
     */
    resetSession(): void {
        this._setServerAvailable(true);
        this._courseProactiveOff = false;
        // C2: cancel any in-flight reveal-persist retry (generation bump invalidates stale closures)
        this._reveal.invalidateInFlight();
        // C3: clear all slot + episode runtime state
        if (!this._slot.isFree()) {
            const st = this._slot.snapshot().state;
            if (st.kind === 'delivered') {
                this.recordTerminalEpisode(st.episode, 'INTERRUPTED');
                // #350: persist INTERRUPTED best-effort under the OWNING exercise (episode.exerciseId), because
                // getExerciseId() is already the newly-opened exercise here. NO backfill: we never enrol a pending
                // entry (resetSession clears _pendingOutcomes just below anyway). applied=false is expected when no
                // canonical row exists yet (unrevealed ambient); the reveal-in-flight race where the row commits
                // later with a NULL outcome is an accepted, documented limitation (spec D1). onConsentRevoked
                // deliberately does NOT persist (no-egress path).
                const exId = st.episode.exerciseId;
                const episodeId = st.episode.episodeId;
                if (exId !== undefined) {
                    void this._deps.setEpisodeOutcome(exId, episodeId, 'INTERRUPTED')
                        .then(({ applied }) => { if (!applied) { this._dbg(`  -> INTERRUPTED not persisted (no row yet) for episodeId=${episodeId}`); } })
                        .catch(() => { /* best-effort */ });
                }
            }
            else if (st.kind === 'parked') { this.recordTerminalEpisode(st.episode, 'DISCARDED'); }
            this._dbg('  -> RESET (new exercise): slot -> FREE');
            this._slot.free();
        }
        this._clearEpisodeRuntime();
        this._continuedEpisodeIds.clear();
        this._frozenSessionId = undefined;
        this._reveal.clearPendingOutcomes();
        this._offers.resetForNewExercise();
        this._setAwaitingEvidence(false, 'new exercise');
        this.reset();
        this.notifySlotDebugChanged();
    }

    /**
     * Reveal the parked ambient hint (spec §5.2 pull reveal). Transitions the slot PARKED -> DELIVERED,
     * opens the proactive session, posts an optimistic bubble, and persists the canonical row.
     * On reveal: scoped-cancel any in-flight parked_progress confirmClose or decide, and re-owe the
     * work under DELIVERED (C3 reveal re-evaluation).
     */
    async revealParkedHint(): Promise<void> {
        const snap = this._slot.snapshot();
        if (snap.state.kind !== 'parked') { return; }

        const { episode, frozenText } = snap.state;
        const episodeId = episode.episodeId;
        // The owning exercise is captured on the episode at creation (#350); reading it here (not
        // getExerciseId()) keeps the reveal bound to the hint's exercise, and threading it forward
        // is safe across the persist await (a reset can clear the active exercise, #364 spec C.6).
        const exerciseId = episode.exerciseId;
        const sessionId = this._frozenSessionId;
        // Deterministic localId (spec C.1): stable across attempts so the server clientMessageId
        // dedups the reveal even across a re-click.
        const localId = `reveal-${episodeId}`;

        // Step-2 guard (spec C.2): no proactive session or no owning exercise -> cannot reveal.
        if (sessionId === undefined || exerciseId === undefined) {
            this._dbg('revealParkedHint: missing sessionId or exerciseId, cannot reveal');
            return;
        }

        // Resolve the owning course + display title synchronously, BEFORE any transition/persist/
        // navigate (spec C.3). Untracked or incomplete (no courseId/title) -> clean abort with a
        // visible notice; the slot stays PARKED so a later reveal can still succeed.
        const target = this._deps.resolveRevealTarget(exerciseId);
        if (target === undefined) {
            this._deps.notifyRevealUnavailable();
            this._dbg(`revealParkedHint: exercise ${exerciseId} not resolvable, notified + aborted`);
            return;
        }
        const { courseId, title } = target;

        // Capture the nav token BEFORE the persist await (spec C.4): a navigation during persistence
        // then makes the provider abort the (now stale) navigation. Steps 1-4 are synchronous, so
        // there is no pre-transition await and no slot-ownership race.
        const navToken = this._deps.currentNavToken();

        // C3: scoped-cancel any in-flight request (the generation bump on reveal makes it stale)
        const inflight = this._inFlightMarker;
        if (inflight) {
            // Scoped cancel frees the server-side job slot.
            this._deps.cancelOutstandingStruggleJob(exerciseId, inflight.requestToken).catch(() => { /* best-effort */ });
            // Re-owe the in-flight work under DELIVERED semantics (progress, not parked_progress).
            if (inflight.intent === 'confirm_close') {
                this._setOwedConfirmClose({ confirmReason: 'progress' });
            }
            // Clear the in-flight marker so the wire re-opens
            this._setInFlightMarker(undefined);
        }

        // Also reset the latch so it does not remain stuck in candidate-close
        this._latch.reset();
        if (this._owedConfirmClose?.confirmReason === 'parked_progress') {
            // Convert to delivered progress (same physical edge, new slot state)
            this._setOwedConfirmClose({ confirmReason: 'progress' });
        }

        // Transition PARKED -> DELIVERED (generation bump -- invalidates any accept() for old gen)
        const hint: EpisodeHint = { level: 'ambient', text: frozenText, atSessionS: 0 };
        this._slot.revealParked(hint);

        // Watchdog: continue running (episode is still the same, re-arm for delivered)
        if (this._watchdog) {
            this._watchdog.arm(Date.now(), false /* now delivered */);
        }
        this.notifySlotDebugChanged();

        this._dbg(`  -> REVEAL click: episodeId=${episodeId} sessionId=${sessionId} exerciseId=${exerciseId} localId=${localId}`);
        // Persist first; navigate to the hint's exercise ONLY from the confirmed same-epoch success
        // branch inside _persistReveal (spec C.6). The parked path posts no optimistic bubble and
        // does not open the session eagerly: the row arrives via the A0-preserved reload.
        await this._reveal.persistReveal(exerciseId, episodeId, frozenText, 'ambient', localId, courseId, sessionId, title, navToken);
    }

    /** The operations the inbound half needs from here. Named so the set is closed and visible. */
    private _framePort(): ServerFramePort {
        return {
            deps: this._deps,
            reveal: this._reveal,
            offers: this._offers,
            dbg: (msg) => this._dbg(msg),
            setInFlightMarker: (v) => this._setInFlightMarker(v),
            setOwedConfirmClose: (v) => this._setOwedConfirmClose(v),
            setServerAvailable: (v) => this._setServerAvailable(v),
            acceptDecide: () => this._acceptDecide(),
            acceptHelpRequest: () => this._acceptHelpRequest(),
            clearInFlight: () => this._clearInFlight(),
            dropStaleRow: (messageId) => this._dropStaleRow(messageId),
            deliveredEpisodeId: () => this._deliveredEpisodeId(),
            clearEpisodeRuntime: () => this._clearEpisodeRuntime(),
            recordTerminalEpisode: (episode, outcome) => this.recordTerminalEpisode(episode, outcome),
            notifyChanged: () => this.notifySlotDebugChanged(),
            drainOwed: () => { void this._drainOwed(); },
        };
    }

    // ---- Inbound server frames, forwarded to ServerFrameHandler ----

    /** Inbound ambient event (PARKED pointer only: spec §5 pull model). */
    onServerAmbient(
        episodeId: string | undefined, hint: string, anchorFile: string | undefined, anchorLine: number | undefined,
        inlineHint: string | undefined, confidence?: number, messageId?: number | null, sessionId?: number,
    ): void {
        this._frames.onServerAmbient(episodeId, hint, anchorFile, anchorLine, inlineHint, confidence, messageId, sessionId);
    }

    /** Inbound active event (delivered: bubble + notification), subject to the Pull re-route. */
    onServerActive(
        episodeId: string | undefined, sessionId: number, anchorFile?: string, anchorLine?: number,
        inlineHint?: string, confidence?: number, message?: string, messageId?: number | null,
    ): void {
        this._frames.onServerActive(episodeId, sessionId, anchorFile, anchorLine, inlineHint, confidence, message, messageId);
    }

    /** Inbound silent event: the server decided no intervention is needed. */
    onServerSilent(episodeId: string | undefined, messageId: number | undefined): void {
        this._frames.onServerSilent(episodeId, messageId);
    }

    /** Inbound confirmClose response (C4 dispatch). */
    onServerClose(
        episodeId: string | undefined, resolved: boolean, closeMessageId: number | undefined,
        closingSentence: string | undefined, episodeLabel: string | undefined,
    ): void {
        this._frames.onServerClose(episodeId, resolved, closeMessageId, closingSentence, episodeLabel);
    }

    /** Escalate a revealed-ambient episode in place. Loudness comes from `inSession`. */
    applyEscalation(
        inSession: boolean, hint: string, anchorFile: string | undefined, anchorLine: number | undefined,
        inlineHint: string | undefined, messageId: number | null,
    ): void {
        this._frames.applyEscalation(inSession, hint, anchorFile, anchorLine, inlineHint, messageId);
    }
}
