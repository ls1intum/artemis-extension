import type { EpisodeOutcomeLabel } from '@shared/messageContracts';

import { isSafeAnchorPath } from '@extension/services/intervention/anchorPath';
import { rebaseAnchorLine } from '@extension/services/intervention/anchorRebase';

import type { InFlightMarker, OwedConfirmClose, StruggleInterventionDeps } from './interventionDeps';
import { DEFAULT_SLOT_CFG } from './interventionDeps';
import type { OfferController } from './offerController';
import type { RevealController } from './revealController';
import type { Episode, EpisodeHint } from './slot/episode';
import type { PendingStamp } from './slot/guard';
import type { ReconcileAction } from './slot/reconcile';
import { reconcile } from './slot/reconcile';
import { StaleWatchdog } from './slot/staleWatchdog';
import type { SlotRuntime } from './slotRuntime';

/**
 * What the inbound half needs from the orchestrator, beyond the shared runtime.
 *
 * Everything here is an OPERATION, not state: the state it shares lives in
 * {@link SlotRuntime}. The list is long because this really is one half of a
 * state machine and the other half owns the lifecycle, but the point of naming
 * them is that the set is now visible and closed. It was invisible while these
 * methods sat in the same class as everything they touched.
 */
export interface ServerFramePort {
    deps: StruggleInterventionDeps;
    reveal: RevealController;
    offers: OfferController;
    /** Developer-mode diagnostic line (gated upstream). */
    dbg(msg: string): void;
    setInFlightMarker(v: InFlightMarker | undefined): void;
    setOwedConfirmClose(v: OwedConfirmClose | undefined): void;
    setServerAvailable(v: boolean): void;
    /** Validate an inbound decide reply against the in-flight marker + slot generation. */
    acceptDecide(): PendingStamp | null;
    /** The same, for a consented follow-up. */
    acceptHelpRequest(): PendingStamp | null;
    clearInFlight(): void;
    /** Retire an already-persisted chat row that this frame turned out not to own. */
    dropStaleRow(messageId: number): void;
    /** The DELIVERED episode's id, or undefined when the slot is not delivered. */
    deliveredEpisodeId(): string | undefined;
    /** The single terminal chokepoint: surfaces down, watchdog disarmed, in-flight cancelled. */
    clearEpisodeRuntime(): void;
    recordTerminalEpisode(episode: Episode, outcome: EpisodeOutcomeLabel): void;
    notifyChanged(): void;
    drainOwed(): void;
}

/**
 * Everything the server can say back, and what each answer does to the slot.
 *
 * The four `onServer*` handlers are the inbound half of the struggle exchange:
 * a POST goes out from the egress path, and minutes later one of these lands.
 * They share a guard sequence that is the whole correctness story of the async
 * boundary (correlate the frame, re-check consent, re-check the opt-out, retire
 * the row a dropped frame left behind server-side), and then hand the surviving
 * decision to `reconcile` and the `_apply*` methods below.
 *
 * Split out because it was half of a 2000-line class, and because the guard
 * sequence reads as one rule only when the four handlers sit together.
 */
export class ServerFrameHandler {
    constructor(private readonly _rt: SlotRuntime, private readonly _p: ServerFramePort) { }

    /**
     * Inbound ambient event from the server (PARKED pointer only: spec §5 pull model).
     * Routes through reconcile; may take-parked (FREE), replace-parked (PARKED), or suppress (DELIVERED).
     * sessionId is stored for the reveal flow (C2).
     */
    onServerAmbient(episodeId: string | undefined, hint: string, anchorFile: string | undefined, anchorLine: number | undefined, inlineHint: string | undefined, confidence?: number, messageId?: number | null, sessionId?: number, rationale?: string): void {
        // #349 Finding 1: inbound stale-frame correlation. Drop a late reply whose echoed
        // episodeId does not match the in-flight request (e.g. a pre-revoke POST landing after
        // a regrant issued a fresh marker) WITHOUT clearing the marker, so the current request's
        // wire survives. Runs before the consent guard below (that one clears on revoke).
        // Wave 2: the stale frame's chat row is already persisted server-side and would surface
        // via chat history, so retire it (mirrors the suppress path's _dropStaleRow).
        if (this._isUncorrelatedFrame(episodeId)) {
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }
        // #349: after a consent revoke, a reply to a pre-revoke POST must not open any
        // surface (mirrors the student-opt-out guard). Silent/Close stay ungated - they
        // only finalize state and never open a surface.
        // Wave 3: this frame's chat row is already persisted server-side; retire it too so it
        // cannot surface via chat history (same-exercise path, so getExerciseId is correct).
        if (!this._p.deps.isEgressEnabled()) {
            this._p.clearInFlight();
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }
        this._p.setServerAvailable(true);

        if (sessionId !== undefined) {
            this._rt.frozenSessionId = sessionId;
        }

        if (!this._p.deps.isStudentProactiveOn()) {
            this._p.clearInFlight();
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }

        // Read the sent snapshot BEFORE _acceptDecide clears the in-flight marker (it is the coord
        // system the server anchored against; the rebase happens once in _applyDecideAction).
        const baseline = this._rt.inFlightMarker?.baseline;

        // Validate against the pending decide stamp (drop stale replies)
        const accepted = this._p.acceptDecide();
        if (accepted === null) {
            // Stale: slot moved since POST, or no decide was outstanding (a frame with no live
            // marker is by definition late). Retire its persisted row too (#349 wave 2).
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }

        // Content logging only AFTER every guard (correlation/consent/opt-out/accept) passed:
        // the telemetry wrapper logs metadata only, so stale or revoked hint text never reaches
        // the dev channel (#349 wave 2).
        this._p.dbg(`  <- AMBIENT accepted conf=${confidence ?? 'n/a'}: "${hint}"`);

        const snap = this._rt.slot.snapshot();
        const decision = { action: 'ambient' as const, text: hint, hardEvent: accepted.hardEvent };
        const action = reconcile(snap.state, decision);

        this._applyDecideAction(action, hint, { level: 'ambient', text: hint, atSessionS: Date.now() / 1000 }, messageId ?? null, anchorFile, anchorLine, inlineHint, confidence, baseline, undefined, rationale);
    }

    /**
     * Inbound active event from the server (delivered, bubble+notification). Routes through reconcile;
     * may take-delivered (FREE), replace-delivered (PARKED), escalate (revealed-ambient DELIVERED +
     * hardEvent), or suppress (already-active DELIVERED, no hardEvent, etc.).
     * Pull re-route (spec §12.2): when the active exercise's level is `less`, this delegates to
     * {@link onServerAmbient} instead, so Less never creates a DELIVERED episode/bubble/notification.
     */
    onServerActive(episodeId: string | undefined, sessionId: number, anchorFile?: string, anchorLine?: number, inlineHint?: string, confidence?: number, message?: string, messageId?: number | null, rationale?: string): void {
        // #349 Finding 1: inbound stale-frame correlation (see onServerAmbient). Drop a late
        // reply for a superseded request without clearing the current request's marker; retire
        // the stale frame's persisted chat row so it cannot surface via history (wave 2).
        if (this._isUncorrelatedFrame(episodeId)) {
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }
        // #349: after a consent revoke, a reply to a pre-revoke POST must not open any
        // surface (mirrors the student-opt-out guard). Silent/Close stay ungated - they
        // only finalize state and never open a surface.
        // Wave 3: retire this frame's already-persisted chat row so it cannot surface via
        // chat history (same-exercise path, so getExerciseId is correct).
        if (!this._p.deps.isEgressEnabled()) {
            this._p.clearInFlight();
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }
        this._p.setServerAvailable(true);

        if (!this._p.deps.isStudentProactiveOn()) {
            this._p.clearInFlight();
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }

        // Consented follow-up (help_request): an invited delivery. Bypass the Less reroute AND reconcile's
        // delivered-suppress; append to the open episode as a bubble. Disambiguated by the marker's intent.
        if (this._rt.inFlightMarker?.intent === 'help_request') {
            const baseline = this._rt.inFlightMarker.baseline;
            const accepted = this._p.acceptHelpRequest();
            if (accepted === null) {
                // Stale (generation moved): retire the persisted row (#349 wave 2, mirrors onServerSilent).
                if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
                return;
            }
            const text = message ?? 'Iris has a suggestion for you.';
            let effectiveAnchorLine = anchorLine;
            if (anchorFile !== undefined && anchorLine !== undefined && isSafeAnchorPath(anchorFile)) {
                const base = baseline?.[anchorFile];
                const current = base !== undefined ? this._p.deps.readFileContent(anchorFile) : undefined;
                if (base !== undefined && current !== undefined) {
                    effectiveAnchorLine = rebaseAnchorLine(base, current, anchorLine);
                }
            }
            this._rt.slot.appendFollowup({ level: 'active', text, atSessionS: Date.now() / 1000 });
            const episodeId = this._p.deliveredEpisodeId();
            if (episodeId) {
                this._p.offers.countAcceptedHint(episodeId);
            }
            this._rt.watchdog?.resetProgress(Date.now());
            this._applyActiveSurface(text, messageId ?? null, anchorFile, effectiveAnchorLine, inlineHint, sessionId);
            return;
        }

        // Pull re-route (spec §12.2 Off/Less/More): Less may only surface quietly (lamp/gutter),
        // never a bubble/notification, even when the server decided `active`. Check the level BEFORE
        // _acceptDecide runs and hand the whole event to onServerAmbient, which does its own
        // _acceptDecide/baseline/_frozenSessionId bookkeeping -- falling through into the active
        // handling below would double-consume the in-flight marker (its _acceptDecide clears the
        // marker, so a second call here would read it as stale and silently drop the reply).
        const level = this._p.deps.getProactiveLevel();
        if (level === 'less') {
            this.onServerAmbient(episodeId, message ?? '', anchorFile, anchorLine, inlineHint, confidence, messageId, sessionId, rationale);
            return;
        }

        // Read the sent snapshot BEFORE _acceptDecide clears the in-flight marker (see onServerAmbient).
        const baseline = this._rt.inFlightMarker?.baseline;

        const accepted = this._p.acceptDecide();
        if (accepted === null) {
            // Stale: no live marker (a markerless frame is by definition late) or the slot
            // generation moved. Retire its persisted row too (#349 wave 2).
            if (messageId !== undefined && messageId !== null) { this._p.dropStaleRow(messageId); }
            return;
        }

        const snap = this._rt.slot.snapshot();
        const text = message ?? 'Iris has a suggestion for you.';
        const decision = { action: 'active' as const, text, hardEvent: accepted.hardEvent };
        const action = reconcile(snap.state, decision);

        this._applyDecideAction(action, text, { level: 'active', text, atSessionS: Date.now() / 1000 }, messageId ?? null, anchorFile, anchorLine, inlineHint, confidence, baseline, sessionId, rationale);
    }

    /**
     * Inbound silent event: server decided no intervention is needed.
     * Frees PARKED (discard-free), suppresses for DELIVERED (no-op).
     * C4: accepts `episodeId` echo (stale-drop if mismatch) and `messageId` for stale-row suppression.
     */
    onServerSilent(episodeId: string | undefined, messageId: number | undefined): void {
        this._p.setServerAvailable(true);

        // C4 echo check: verify the wire's episodeId matches what was requested.
        // Do this BEFORE _acceptDecide so a mismatch does NOT consume the in-flight marker
        // (the real reply for this episode may still arrive).
        const expectedEpisodeId = this._rt.inFlightMarker?.episodeId;
        if (expectedEpisodeId === undefined || episodeId !== expectedEpisodeId) {
            if (messageId !== undefined) { this._p.dropStaleRow(messageId); }
            return;
        }

        // Consented follow-up that resolved silent: clear the help_request marker so the wire is not wedged,
        // and give an honest note. No cap slot is consumed.
        if (this._rt.inFlightMarker?.intent === 'help_request') {
            const accepted = this._p.acceptHelpRequest();
            if (accepted === null) {
                if (messageId !== undefined) { this._p.dropStaleRow(messageId); }
                return;
            }
            this._p.deps.postBubble('Nothing more I can add right now.', null, this._p.deliveredEpisodeId());
            return;
        }

        const accepted = this._p.acceptDecide();
        if (accepted === null) {
            // Generation/token mismatch: stale. The marker was already cleared by _acceptDecide.
            if (messageId !== undefined) { this._p.dropStaleRow(messageId); }
            return;
        }

        const snap = this._rt.slot.snapshot();
        const decision = { action: 'silent' as const, text: null, hardEvent: false };
        const action = reconcile(snap.state, decision);

        if (action.kind === 'discard-free') {
            this._p.dbg('  -> SILENT: discard PARKED -> FREE');
            if (snap.state.kind === 'parked') { this._p.recordTerminalEpisode(snap.state.episode, 'DISCARDED'); }
            this._rt.slot.discardParkedToFree();
            this._p.clearEpisodeRuntime();
        } else {
            // 'suppress': DELIVERED + silent -> no-op (keep the live episode).
            // FREE + silent -> suppress -> discard the pending candidate.
            this._rt.candidate = undefined;
        }
    }

    /**
     * Inbound confirmClose response from the server (C4 dispatch).
     * `resolved=true`: Pyris agreed to close -> free the slot (DELIVERED) or discard-free (PARKED).
     * `resolved=false`: Pyris declined -> latch re-arms, slot stays.
     * C4: accepts `episodeId` echo, `closeMessageId`/`episodeLabel` for praise, stale-row suppression.
     */
    onServerClose(
        episodeId: string | undefined,
        resolved: boolean,
        closeMessageId: number | undefined,
        _closingSentence: string | undefined,
        episodeLabel: string | undefined,
    ): void {
        this._p.setServerAvailable(true);

        // C4 echo check: must be a confirm_close in-flight for the right episode.
        // Echo mismatch -> drop without consuming the marker (real reply may still arrive).
        const expectedEpisodeId = this._rt.inFlightMarker?.episodeId;
        if (this._rt.inFlightMarker?.intent !== 'confirm_close' || expectedEpisodeId === undefined || episodeId !== expectedEpisodeId) {
            if (closeMessageId !== undefined) { this._p.dropStaleRow(closeMessageId); }
            return;
        }

        this._p.setInFlightMarker(undefined);

        this._rt.latch.onConfirmResult(resolved);

        if (resolved) {
            const snap = this._rt.slot.snapshot();
            const snapState = snap.state;
            const wasDelivered = snapState.kind === 'delivered';
            const wasParked = snapState.kind === 'parked';
            const liveEpisodeId = (wasDelivered || wasParked) ? snapState.episode.episodeId : undefined;

            // A confirmClose that resolves frees the slot; clear any owed confirmClose (one CLOSE total).
            this._p.setOwedConfirmClose(undefined);

            if (wasDelivered) {
                this._p.dbg(`  -> CLOSE resolved: DELIVERED -> FREE (RECOVERED) episodeId=${liveEpisodeId ?? 'n/a'}`);
                const exerciseId = this._p.deps.getExerciseId();
                this._p.recordTerminalEpisode((snapState as Extract<typeof snapState, { kind: 'delivered' }>).episode, 'RECOVERED');
                this._rt.slot.free();
                this._p.clearEpisodeRuntime();
                if (liveEpisodeId) {
                    if (exerciseId !== undefined) {
                        this._p.reveal.writeOutcomeWithBackfill(exerciseId, liveEpisodeId, 'RECOVERED');
                    }
                    const praise = (episodeLabel && closeMessageId !== undefined)
                        ? { episodeLabel, closeMessageId }
                        : undefined;
                    this._p.deps.foldEpisode(liveEpisodeId, 'RECOVERED', praise);
                }
            } else if (wasParked) {
                this._p.dbg('  -> CLOSE resolved: PARKED -> FREE (silent discard)');
                this._p.recordTerminalEpisode((snapState as Extract<typeof snapState, { kind: 'parked' }>).episode, 'DISCARDED');
                this._rt.slot.discardParkedToFree();
                this._p.clearEpisodeRuntime();
            } else {
                // Already free (race): just clear runtime
                this._p.clearEpisodeRuntime();
            }
        } else {
            this._p.dbg('  -> CLOSE not resolved: latch re-arms, slot stays');
            void this._p.drainOwed();
        }
    }

    private _applyDecideAction(
        action: ReconcileAction,
        text: string,
        hint: EpisodeHint,
        messageId: number | null,
        anchorFile: string | undefined,
        anchorLine: number | undefined,
        inlineHint: string | undefined,
        confidence: number | undefined,
        baseline: Record<string, string> | undefined,
        sessionId?: number,
        rationale?: string,
    ): void {
        const now = Date.now();

        // Rebase the server anchor line from the snapshot we SENT at trigger onto the live buffer at
        // delivery: the server picked the line against those exact bytes, but the student kept typing
        // in the ~10s round-trip. Done ONCE here so every surface (gutter, inline + jump, escalation)
        // shares the corrected line. undefined -> the anchored line is gone, so the surfaces'
        // `!== undefined` guards drop the cue while the bubble/message still shows (fail-safe). No
        // baseline (anchor on an unchanged file) or file not open -> keep the raw line.
        let effectiveAnchorLine = anchorLine;
        if (anchorFile !== undefined && anchorLine !== undefined && isSafeAnchorPath(anchorFile)) {
            const base = baseline?.[anchorFile];
            const current = base !== undefined ? this._p.deps.readFileContent(anchorFile) : undefined;
            if (base !== undefined && current !== undefined) {
                effectiveAnchorLine = rebaseAnchorLine(base, current, anchorLine);
            }
        }

        switch (action.kind) {
            case 'take-parked': {
                const ep = this._rt.candidate!;
                this._rt.slot.takeParked(now, ep, hint);
                this._rt.candidate = undefined;
                this._rt.watchdog = new StaleWatchdog(this._p.deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._rt.watchdog.arm(now, true /* parked */);
                this._rt.latch.reset();
                this._p.deps.setBadge(true);
                this._p.deps.showLamp();
                if (anchorFile && effectiveAnchorLine !== undefined && inlineHint && isSafeAnchorPath(anchorFile)) {
                    this._p.deps.showGutterOnly(anchorFile, effectiveAnchorLine);
                } else {
                    this._p.deps.clearInline();
                }
                this._p.dbg(`  -> TAKE-PARKED badge+lamp${anchorFile ? '+gutter' : ''} hint="${text}"`);
                void this._p.deps.log.record({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', signal: this._rt.lastSignal, confidence, rationale });
                break;
            }

            case 'take-delivered': {
                const ep = this._rt.candidate!;
                this._rt.slot.takeDelivered(now, ep, hint);
                this._p.dbg(`  -> TAKE-DELIVERED bubble hint="${text}"`);
                this._rt.candidate = undefined;
                this._rt.watchdog = new StaleWatchdog(this._p.deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._rt.watchdog.arm(now, false /* delivered */);
                this._rt.latch.reset();
                this._applyActiveSurface(text, messageId, anchorFile, effectiveAnchorLine, inlineHint, sessionId);
                void this._p.deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._rt.lastSignal, confidence, rationale });
                break;
            }

            case 'replace-parked': {
                // KNOWN GAP (debug history): replace swaps the slot's episode without a
                // recordTerminalEpisode for the outgoing one (replace is not an enumerated terminal
                // site). Today replace reuses the same episodeId, so nothing is lost; only if a
                // replace ever carried a DISTINCT outgoing episodeId would that episode be absent
                // from the session history. Acceptable for a best-effort debug surface.
                const ep = this._rt.candidate!;
                this._rt.slot.replaceParked(now, ep, hint);
                this._rt.candidate = undefined;
                this._rt.watchdog?.disarm();
                this._rt.watchdog = new StaleWatchdog(this._p.deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._rt.watchdog.arm(now, true /* parked */);
                this._rt.latch.reset();
                this._p.deps.setBadge(true);
                this._p.deps.showLamp();
                if (anchorFile && effectiveAnchorLine !== undefined && inlineHint && isSafeAnchorPath(anchorFile)) {
                    this._p.deps.showGutterOnly(anchorFile, effectiveAnchorLine);
                } else {
                    this._p.deps.clearInline();
                }
                this._p.dbg(`  -> REPLACE-PARKED new hint="${text}"`);
                void this._p.deps.log.record({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', signal: this._rt.lastSignal, confidence, rationale });
                break;
            }

            case 'replace-delivered': {
                // KNOWN GAP (debug history): see replace-parked above; the outgoing episode is not
                // recorded to history (same-episodeId reuse means nothing is lost in practice).
                const ep = this._rt.candidate!;
                this._rt.slot.replaceWithDelivered(now, ep, hint);
                this._p.dbg(`  -> REPLACE-DELIVERED bubble hint="${text}"`);
                this._rt.candidate = undefined;
                this._rt.watchdog?.disarm();
                this._rt.watchdog = new StaleWatchdog(this._p.deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._rt.watchdog.arm(now, false /* delivered */);
                this._rt.latch.reset();
                this._applyActiveSurface(text, messageId, anchorFile, effectiveAnchorLine, inlineHint, sessionId);
                void this._p.deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._rt.lastSignal, confidence, rationale });
                break;
            }

            case 'escalate': {
                this._rt.slot.escalate(hint);
                this._p.dbg(`  -> ESCALATE ambient->active hint="${text}"`);
                const inSession = this._rt.slot.snapshot().inSession;
                this._applyEscalation(inSession, text, anchorFile, effectiveAnchorLine, inlineHint, messageId);
                // Watchdog: resetProgress is NOT called here (escalation is not "hard progress")
                void this._p.deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._rt.lastSignal, confidence, rationale });
                break;
            }

            case 'suppress':
            case 'discard-free':
                // Suppress: server decided no surface change for this slot state. If the reply still
                // carried a persisted proactive row (messageId), it will never be surfaced live, so
                // drop it -- otherwise it reappears as a chat row on the next history/chat-ws load,
                // reintroducing the duplicate hint the occupied-slot suppress rule is meant to block.
                if (messageId !== null) { this._p.dropStaleRow(messageId); }
                this._p.dbg(`  -> SUPPRESS (slot=${this._rt.slot.snapshot().state.kind})`);
                break;
        }
        this._p.notifyChanged();
    }

    /**
     * Apply the full active push surface (bubble + session open + notification + badge + inline).
     * Called from take-delivered, replace-delivered; NOT for escalation (which uses applyEscalation).
     */
    private _applyActiveSurface(
        text: string,
        messageId: number | null,
        anchorFile: string | undefined,
        anchorLine: number | undefined,
        inlineHint: string | undefined,
        sessionId?: number,
    ): void {
        const bubbleText = text;
        const episodeId = this._p.deliveredEpisodeId();
        // Navigate BEFORE posting. A bubble emitted while another conversation is
        // still installed is attributed to that one, so the student sees it in the
        // wrong place or not at all.
        // Optional calls: a caller that cannot name the course (or a harness that
        // does not stub these) degrades to posting straight away. Production always
        // resolves both.
        const exerciseId = this._p.deps.getExerciseId?.();
        const courseId = exerciseId !== undefined ? this._p.deps.resolveRevealTarget?.(exerciseId)?.courseId : undefined;
        if (sessionId !== undefined && courseId !== undefined) {
            void this._p.deps.openSession(courseId, sessionId)
                .then(() => { this._p.deps.postBubble(bubbleText, messageId, episodeId); })
                .catch(() => { this._p.deps.postBubble(bubbleText, messageId, episodeId); });
        } else {
            this._p.deps.postBubble(bubbleText, messageId, episodeId);
        }
        this._p.deps.setBadge(true);
        // The bubble already lands in the open chat, so the banner is redundant (and noisy) when the
        // chat view is open. Mirror the escalation path, which already suppresses the banner in-session.
        if (!this._rt.slot.snapshot().inSession) {
            this._p.deps.showActiveBanner(this._p.deliveredEpisodeId());
        }
        if (anchorFile && anchorLine !== undefined && inlineHint && isSafeAnchorPath(anchorFile)) {
            this._p.deps.showInline(anchorFile, anchorLine, inlineHint, bubbleText);
            // Jump lamp: the persistent, discoverable way to reach the (silent, possibly off-screen)
            // inline cue. A fresh accepted active reply is authoritative server state, so clobbering
            // any stale lamp (incl. a recovered-from fallback) via showActiveJump is correct here.
            this._p.deps.showActiveJump(anchorFile, anchorLine);
        } else {
            this._p.deps.clearInline();
            this._p.deps.clearLamp();
        }
    }

    /**
     * Apply an escalation (PARKED -> DELIVERED transition, driven by C3 slot reconcile).
     * Computes loudness from `inSession`: when the chat view is open (in-session), the escalation
     * drops quietly as a bubble with no banner or inline push; otherwise it fires the full active
     * surface (banner + inline). This method does NOT touch the slot state (C3 owns that).
     */
    applyEscalation(
        inSession: boolean,
        hint: string,
        anchorFile: string | undefined,
        anchorLine: number | undefined,
        inlineHint: string | undefined,
        messageId: number | null,
    ): void {
        this._applyEscalation(inSession, hint, anchorFile, anchorLine, inlineHint, messageId);
    }

    private _applyEscalation(
        inSession: boolean,
        text: string,
        anchorFile: string | undefined,
        anchorLine: number | undefined,
        inlineHint: string | undefined,
        messageId: number | null,
    ): void {
        this._p.deps.postBubble(text, messageId, this._p.deliveredEpisodeId());
        const hasAnchor = !!anchorFile && anchorLine !== undefined && !!inlineHint && isSafeAnchorPath(anchorFile);
        // The jump lamp is a quieter, no-focus-steal code pointer, so arm it for an anchored
        // escalation regardless of in-session (the inline cue below stays in-session-suppressed).
        if (hasAnchor) {
            this._p.deps.showActiveJump(anchorFile, anchorLine);
        }
        if (inSession) {
            // Quiet in-session escalation: bubble + jump lamp only. Still retire any inline/gutter
            // cue carried over from the parked phase (revealParkedHint keeps the parked gutter cue),
            // so a stale pointer at the old anchor cannot outlive the escalation.
            this._p.deps.clearInline();
            return;
        }
        // Out-of-session: full active push
        this._p.deps.showActiveBanner(this._p.deliveredEpisodeId());
        if (hasAnchor) {
            this._p.deps.showInline(anchorFile, anchorLine, inlineHint, text);
        } else {
            // No-anchor escalation: retire any stale parked gutter cue (nothing fresh to arm).
            this._p.deps.clearInline();
        }
    }

    /**
     * #349 Finding 1: inbound stale-frame correlation for the AMBIENT/ACTIVE surface handlers.
     * While a request is in flight, a late reply must echo the same episodeId as the live marker;
     * otherwise it belongs to a superseded request (e.g. a pre-revoke POST landing after a
     * revoke->regrant issued a fresh marker) and must be dropped WITHOUT clearing the marker, so the
     * live request's wire is never killed by a foreign frame. A frame that carries NO episodeId fails
     * closed the same way: the current C4 server echoes episodeId on every new-style frame (mirroring
     * onServerSilent/onServerClose, which already drop on a missing/mismatched echo), so an absent id
     * means a stale or foreign frame. When no marker is in flight, correlation is skipped (the
     * exercise-id filter and consent guard still run).
     * Returns true when the frame should be dropped.
     */
    private _isUncorrelatedFrame(frameEpisodeId: string | undefined): boolean {
        const marker = this._rt.inFlightMarker;
        if (!marker) { return false; }
        if (frameEpisodeId !== undefined && frameEpisodeId === marker.episodeId) { return false; }
        this._p.dbg(`  -> DROP uncorrelated inbound frame (episodeId=${frameEpisodeId ?? 'none'} != in-flight ${marker.episodeId}); marker preserved`);
        return true;
    }
}
