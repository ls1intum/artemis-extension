import type { Uri } from 'vscode';

import { ApiError } from '@extension/domain';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import type { IrisChatMessage } from '@extension/types';

import { buildStruggleSignal } from './buildStruggleSignal';
import { decideOutcome } from './decideOutcome';
import type { InterventionEventLog } from './interventionEventLog';
import type { EpisodeHint, Level } from './slot/episode';
import type { Episode } from './slot/episode';
import { markContinuation, newEpisode } from './slot/episode';
import type { PendingStamp } from './slot/guard';
import { InFlightGuard } from './slot/guard';
import type { ProgressCloseCfg } from './slot/progressClose';
import { ProgressCloseLatch } from './slot/progressClose';
import type { ReconcileAction } from './slot/reconcile';
import { reconcile } from './slot/reconcile';
import { SlotManager } from './slot/slotManager';
import type { StaleConfig } from './slot/staleWatchdog';
import { StaleWatchdog } from './slot/staleWatchdog';
import type { StruggleEgressResult, StruggleInterventionRequest, StruggleSignal } from './struggleContract';
import { templateForSignal } from './struggleTemplates';
import { TickRingBuffer } from './tickRingBuffer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The in-flight marker tracks the outstanding struggle POST (single-outstanding). */
interface InFlightMarker {
    requestToken: string;
    episodeId: string;
    generation: number;
    intent: 'decide' | 'confirm_close' | 'stale_check';
    /** Local token from InFlightGuard.issue() for accept() call. */
    localToken: number;
}

/** A queued confirmClose reason waiting to be POSTed. */
interface OwedConfirmClose {
    confirmReason: 'progress' | 'stale_solved' | 'parked_progress';
}

/** A live stale-ask binding -- cleared by clearEpisodeRuntime(). */
interface LiveAskBinding {
    askId: string;
    messageId: number;
    episodeId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Delay between reveal-persist retries. The server upsert is idempotent (A10), so retries are safe. */
const REVEAL_RETRY_MS = 5_000;
/** Maximum number of reveal-persist retry attempts (~1 min at 5s). After this the bubble stays runtime-only. */
const MAX_REVEAL_RETRIES = 12;
/** Permanent server-side rejection codes. These must not be retried; only transient/5xx/network errors are retried. */
const NON_RETRIABLE_REVEAL_STATUSES = new Set([400, 403, 404]);

/** Boundary types that constitute a hard event (drive the escalation path). */
const HARD_BOUNDARIES = new Set<string>(['FM', 'FM_PLUS', 'E4', 'N1']);

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface StruggleInterventionDeps {
    isEgressEnabled(): boolean;
    /** True when a `.noai` marker file is present in the workspace (spec §9). */
    hasNoaiMarker(): boolean;
    getExerciseId(): number | undefined;
    getExerciseRoot(): Uri | undefined;
    collectFiles(root: Uri | undefined): Promise<Record<string, string>>;
    postIntervention(exerciseId: number, body: StruggleInterventionRequest): Promise<StruggleEgressResult>;
    /** Open/attach the proactive session by id + reload its history so the bubble shows (spec §5.5 active). */
    openSession(sessionId: number): Promise<void>;
    /** opensChat: true -> click focuses Iris chat; false -> click shows the local template. */
    showAmbient(hint: string, opensChat: boolean): void;
    /** Show the ambient-hint lamp for a PARKED server hint (spec §5 pull model). No per-hint tooltip. */
    showLamp(): void;
    /** Hide the status-bar lamp (called on session/context reset so stale hints do not survive). */
    clearLamp(): void;
    /** Render the inline in-editor cue (gutter logo + after-line hint + hover) at the live anchor (spec §4.1). */
    showInline(anchorFile: string, anchorLine: number, inlineHint: string, message: string): void;
    /** Render the ambient gutter-only decoration (gutter icon, NO after-line text) at the live anchor (spec §5). */
    showGutterOnly(anchorFile: string, anchorLine: number): void;
    /** Remove any inline cue (session/context reset). */
    clearInline(): void;
    /** True iff the anchored file is a visible editor AND the (1-based) line is in a visible range (spec §4). */
    isAnchorLive(anchorFile: string, anchorLine: number): boolean;
    /** Durable per-exercise student opt-out (spec §12.2): false -> the orchestrator suppresses proactive for it. */
    isStudentProactiveOn(exerciseId: number): boolean;
    /** Reject-backoff thresholds (spec §5.2). */
    softThreshold: number;
    pauseStrikes: number;
    setBadge(on: boolean): void;
    showActiveNotification(): void;
    /**
     * Post an optimistic proactive bubble to the open chat. When `messageId` is set, a later server
     * message with the same id deduplicates on the webview side. When `messageId` is null
     * (server persist failed, A9), the bubble is runtime-only and carries no dedup tag.
     */
    postBubble(text: string, messageId: number | null): void;
    // ---- C2: reveal flow ----
    /** Generate a unique local id for an optimistic reveal bubble. */
    generateLocalId(): string;
    /** Post an optimistic reveal bubble with a string local id (C2 pull-reveal flow). */
    postRevealBubble(text: string, localId: string): void;
    /**
     * Reconcile the reveal bubble after server persist confirms the canonical row.
     */
    reconcileOptimisticBubble(localId: string, serverId: number, proactiveEpisodeId: string | undefined, sentAt: string): void;
    /**
     * Reveal the hidden ambient hint by persisting it as a chat message in the proactive session (A10).
     */
    revealAmbient(exerciseId: number, episodeId: string, hintText: string, level: Level, clientMessageId: string): Promise<IrisChatMessage>;
    /**
     * Record the student's terminal outcome for an episode-keyed proactive row (A10).
     */
    setEpisodeOutcome(exerciseId: number, episodeId: string, outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED'): Promise<{ applied: boolean }>;
    // ---- C3: slot-continuity ----
    /**
     * Cancel an outstanding struggle job by its per-POST requestToken (A10 scoped cancel).
     */
    cancelOutstandingStruggleJob(exerciseId: number, requestToken: string): Promise<void>;
    /**
     * Emit the host-to-webview fold signal for a terminal DELIVERED episode (C6/C7 renders).
     * praise is present for progress-close terminals; absent for dismiss/stale/force-free.
     */
    foldEpisode(episodeId: string, praise?: { episodeLabel: string; closeMessageId: number }): void;
    log: InterventionEventLog;
    setTimeoutFn?: (fn: () => void, ms: number) => void;
    /** Developer-mode diagnostic sink (gated upstream); no-op when omitted. Pure string out, no effects. */
    devLog?(msg: string): void;
    /** Slot config (staleAfterMs, staleWindowMax, staleAskCap). Consumed from TUNING.slot. */
    slotCfg?: StaleConfig;
    /** Progress-close latch config. Consumed from TUNING.slot. */
    progressCloseCfg?: ProgressCloseCfg;
}

// ---------------------------------------------------------------------------
// Default slot config (mirrors TUNING.slot; injected so tests can override)
// ---------------------------------------------------------------------------

const DEFAULT_SLOT_CFG: StaleConfig = {
    staleAfterMs: 45_000,
    staleWindowMax: 4,
    staleAskCap: 2,
};

const DEFAULT_PROGRESS_CFG: ProgressCloseCfg = {
    reArmSBase: 0.6,
    reArmHoldMs: 30_000,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Orchestrates the proactive struggle intervention on the client (spec §4). Implements {@link AlertSink}, so
 * the coordinator's `enabled`/`showInterventions` gating AND its `reset()` on session change stay authoritative
 * (we do NOT subscribe the raw, ungated engine event). Ticks are fed via {@link onTick} (wired in extension.ts
 * from `coordinator.onDidTick`). vscode-free at runtime -- only type imports; all effects injected.
 */
export class StruggleInterventionService implements AlertSink {
    private readonly _buffer = new TickRingBuffer(12);
    private _serverAvailable = true;
    private _courseProactiveOff = false;
    // Reject backoff (delivery-layer, spec §5.2). Only an explicit dismiss moves these; engagement/new exercise clear them.
    private _annoyance = 0;
    private _dismissStrikes = 0;
    private _softSkipBudget = 0;

    /**
     * Generation counter for reveal-persist retries. Incremented by resetSession (exercise switch) to
     * invalidate any in-flight retry closure that captured a stale generation.
     */
    private _revealRetryGen = 0;

    // ---------------------------------------------------------------------------
    // C3: slot-core state (package-internal for test access -- underscore prefix)
    // ---------------------------------------------------------------------------

    // Slot state machine (C2 introduced; C3 routes all decisions through it)
    readonly _slot = new SlotManager();

    // Async/generation guard: validates inbound websocket replies against the live slot state
    readonly _guard = new InFlightGuard();

    // Progress-close edge-trigger latch (B8)
    readonly _latch: ProgressCloseLatch;

    // Per-episode stale watchdog (minted fresh on every TAKE; undefined when slot is FREE)
    _watchdog: StaleWatchdog | undefined;

    // Preallocated candidate episode for FREE/PARKED-slot decide (cleared on slot take or reject)
    _candidate: Episode | undefined;

    // Outstanding struggle POST marker (undefined = wire is free)
    _inFlightMarker: InFlightMarker | undefined;

    // Most recent StruggleSignal from deliver(); reused for confirmClose/staleCheck POSTs
    _lastSignal: StruggleSignal | undefined;

    // Owed confirmClose (at most one; queued while the wire is busy)
    _owedConfirmClose: OwedConfirmClose | undefined;

    // Owed staleCheck POST (set on fire-stale-check if wire busy; drained when wire frees)
    _owedStaleCheck = false;

    // Episode ids that have had at least one accepted POST (isNew flipped to false for future POSTs)
    private _continuedEpisodeIds = new Set<string>();

    // Live stale-ask binding; cleared by clearEpisodeRuntime() to neutralise pending ABANDON timers
    _liveAskBinding: LiveAskBinding | undefined;

    /**
     * The proactive session id from the last inbound ambient event (spec §5, A9).
     * Stored here because the SlotManager does not hold session ids. Cleared on resetSession.
     */
    _frozenSessionId: number | undefined;

    /**
     * Per-exercise pending terminal outcomes. Keyed by episodeId. Lives at the orchestrator level
     * so it survives a slot free (teardown). Populated when setEpisodeOutcome returns applied=false
     * (canonical row not yet created). Flushed when the reveal-persist retry creates the row.
     * Cleared on resetSession (new exercise = fresh state).
     */
    _pendingOutcomes = new Map<string, { sessionId: number; outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }>();

    constructor(private readonly _deps: StruggleInterventionDeps) {
        this._latch = new ProgressCloseLatch(
            _deps.progressCloseCfg ?? DEFAULT_PROGRESS_CFG,
        );
    }

    // ---------------------------------------------------------------------------
    // AlertSink
    // ---------------------------------------------------------------------------

    /** Fed every engine tick (ungated buffer fill). Wired externally so we don't bypass coordinator gating. */
    onTick(tick: TickRecord): void {
        this._buffer.push(tick);
        // C3: feed progress latch with sBase from tick (newGreenTest path goes through onNewBuildResult)
        this._latch.observe(tick.ts, tick.sBase, false);
        this._propagateLatchToOwed();
        // C3: tick the watchdog (uses session-relative ms, staleAfterMs is comparable)
        this._handleWatchdogTick(tick.ts);
        // C3: drain any owed confirmClose / staleCheck (wire may now be free)
        void this._drainOwed();
    }

    /** Called by the build-result watcher when a build produces a strict new high in passed tests. */
    onNewBuildResult(newGreenTest: boolean): void {
        if (!newGreenTest) { return; }
        // Feed the latch: newGreenTest=true triggers a progress edge
        // Use Date.now() for the latch since it cares about real time, not session time
        this._latch.observe(Date.now(), 1.0 /* above any threshold, won't fire sBase path */, true);
        this._propagateLatchToOwed();
        void this._drainOwed();
    }

    /** AlertSink.deliver -- the coordinator calls this ONLY when `enabled && showInterventions`. */
    deliver(alert: AlertRecord): void {
        void this._handleAlert(alert);
    }

    /** Developer-mode diagnostic line (gated upstream); no-op when devLog is not injected. */
    private _dbg(msg: string): void {
        this._deps.devLog?.(msg);
    }

    /** No-AI path: deterministic signal-keyed local template on the lamp, ZERO egress; click shows the template. */
    private _fallback(signal: StruggleSignal): void {
        const template = templateForSignal(signal);
        this._dbg(`  -> FALLBACK (no egress): local lamp template "${template}"`);
        this._deps.showAmbient(template, false);
    }

    /**
     * Pre-throttle suppression (the BackoffSource predicate {@link shouldSuppress} wraps this).
     * Returns the dev-log reason, or null when the alert may proceed.
     */
    private _suppressReason(alert: AlertRecord): string | null {
        if (alert.kind !== 'edit') {
            return `alert kind=${alert.kind} skipped (only edit-path alerts intervene)`;
        }
        if (this._courseProactiveOff) {
            return '  -> SKIP (course proactive disabled for this session)';
        }
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return '  -> SKIP (student turned proactive off for this exercise)';
        }
        return null;
    }

    /** BackoffSource: drop a suppressed alert above the throttle so it does not consume delivery budget. */
    shouldSuppress(alert: AlertRecord): boolean {
        return this._suppressReason(alert) !== null;
    }

    // ---------------------------------------------------------------------------
    // Core alert handler (C3: preallocation + slot routing)
    // ---------------------------------------------------------------------------

    private async _handleAlert(alert: AlertRecord): Promise<void> {
        const suppressed = this._suppressReason(alert);
        if (suppressed !== null) {
            this._dbg(suppressed);
            return;
        }
        if (alert.kind !== 'edit') { return; }

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

            if (outcome === 'fallback') {
                this._fallback(signal);
                return;
            }
            if (outcome === 'skip') {
                this._dbg('  -> SKIP (no POST, no surface)');
                return;
            }

            const exerciseId = this._deps.getExerciseId() as number;
            const hardEvent = alert.types.some(t => HARD_BOUNDARIES.has(t));

            // Episode preallocation: candidate for FREE/PARKED, live episode for DELIVERED
            let requestEpisode: { episodeId: string; isNew: boolean; hints: EpisodeHint[] };

            if (snap.state.kind === 'free') {
                this._candidate = newEpisode(Date.now(), () => crypto.randomUUID());
                requestEpisode = {
                    episodeId: this._candidate.episodeId,
                    isNew: !this._continuedEpisodeIds.has(this._candidate.episodeId),
                    hints: this._candidate.hints,
                };
            } else if (snap.state.kind === 'parked') {
                // A new candidate for the possible replacement; the PARKED episode is never sent back
                this._candidate = newEpisode(Date.now(), () => crypto.randomUUID());
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
            const requestToken = crypto.randomUUID();

            // Stamp the guard BEFORE async collection (TOCTOU: a second alert must see in-flight)
            const stamp: PendingStamp = {
                episodeId: requestEpisode.episodeId,
                generation: snap.generation,
                hardEvent,
                requestToken,
            };
            const localToken = this._guard.issue('decide', stamp);
            this._inFlightMarker = { requestToken, episodeId: requestEpisode.episodeId, generation: snap.generation, intent: 'decide', localToken };

            const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
            await this._deps.log.record({ action: 'requested', finalAction: 'silent', surface: 'none', source: 'server', signal });

            const result = await this._deps.postIntervention(exerciseId, {
                struggleSignal: signal,
                uncommittedFiles,
                intent: 'decide',
                episode: requestEpisode,
                requestToken,
            });

            this._dbg(`  -> POST result: ${result}`);

            if (result === 'accepted') {
                // Flip isNew: this episode has now been seen by Pyris
                this._continuedEpisodeIds.add(requestEpisode.episodeId);
                if (this._candidate) {
                    this._candidate = markContinuation(this._candidate);
                }
                // _inFlightMarker stays set until the websocket reply arrives (onServerAmbient/Active/Silent)
            } else if (result === 'course-off') {
                this._courseProactiveOff = true;
                this._inFlightMarker = undefined;
                this._candidate = undefined;
            } else if (result === 'unavailable') {
                this._serverAvailable = false;
                this._inFlightMarker = undefined;
                this._candidate = undefined;
                this._fallback(signal);
            } else {
                // 'failed': transient error -- release wire so next alert retries
                this._inFlightMarker = undefined;
                this._candidate = undefined;
            }
        } catch (err) {
            this._dbg(`  -> ERROR during intervention: ${err instanceof Error ? err.message : String(err)}`);
            this._inFlightMarker = undefined;
            this._candidate = undefined;
        }
    }

    // ---------------------------------------------------------------------------
    // Inbound decision handlers (C3 slot-reaction logic; C4 dispatches to these)
    // ---------------------------------------------------------------------------

    /**
     * Inbound ambient event from the server (PARKED pointer only: spec §5 pull model).
     * Routes through reconcile; may take-parked (FREE), replace-parked (PARKED), or suppress (DELIVERED).
     * sessionId is stored for the reveal flow (C2).
     */
    onServerAmbient(hint: string, anchorFile: string | undefined, anchorLine: number | undefined, inlineHint: string | undefined, confidence?: number, messageId?: number | null, sessionId?: number): void {
        this._serverAvailable = true;

        if (sessionId !== undefined) {
            this._frozenSessionId = sessionId;
        }

        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            this._clearInFlight();
            return;
        }

        // Validate against the pending decide stamp (drop stale replies)
        const accepted = this._acceptDecide();
        if (accepted === null) {
            return; // stale: slot moved since POST, or no decide was outstanding
        }

        const snap = this._slot.snapshot();
        const decision = { action: 'ambient' as const, text: hint, hardEvent: accepted.hardEvent };
        const action = reconcile(snap.state, decision);

        this._applyDecideAction(action, hint, { level: 'ambient', text: hint, atSessionS: Date.now() / 1000 }, messageId ?? null, anchorFile, anchorLine, inlineHint, confidence);
    }

    /**
     * Inbound active event from the server (delivered, bubble+notification). Routes through reconcile;
     * may take-delivered (FREE), replace-delivered (PARKED), escalate (revealed-ambient DELIVERED +
     * hardEvent), or suppress (already-active DELIVERED, no hardEvent, etc.).
     */
    onServerActive(sessionId: number, anchorFile?: string, anchorLine?: number, inlineHint?: string, confidence?: number, message?: string, messageId?: number | null): void {
        this._serverAvailable = true;

        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            this._clearInFlight();
            return;
        }

        const accepted = this._acceptDecide();
        if (accepted === null) {
            return;
        }

        const snap = this._slot.snapshot();
        const text = message ?? 'Iris has a suggestion for you.';
        const decision = { action: 'active' as const, text, hardEvent: accepted.hardEvent };
        const action = reconcile(snap.state, decision);

        this._applyDecideAction(action, text, { level: 'active', text, atSessionS: Date.now() / 1000 }, messageId ?? null, anchorFile, anchorLine, inlineHint, confidence, sessionId);
    }

    /**
     * Inbound silent event: server decided no intervention is needed.
     * Frees PARKED (discard-free), suppresses for DELIVERED (no-op).
     */
    onServerSilent(): void {
        this._serverAvailable = true;

        const accepted = this._acceptDecide();
        if (accepted === null) { return; }

        const snap = this._slot.snapshot();
        const decision = { action: 'silent' as const, text: null, hardEvent: false };
        const action = reconcile(snap.state, decision);

        if (action.kind === 'discard-free') {
            this._slot.discardParkedToFree();
            this._clearEpisodeRuntime();
        }
        // 'suppress': DELIVERED + silent -> no-op (keep the live episode)
        // 'suppress' from FREE: was already free, no-op
    }

    /**
     * Inbound confirmClose response from the server (C4 will parse and dispatch).
     * `resolved=true`: Pyris agreed to close -> free the slot.
     * `resolved=false`: Pyris declined -> latch re-arms, slot stays.
     */
    onServerClose(resolved: boolean, _closeMessageId?: number, _episodeLabel?: string): void {
        this._serverAvailable = true;

        // Clear the in-flight marker for the confirmClose intent
        const wasDedicated = this._inFlightMarker?.intent === 'confirm_close';
        if (wasDedicated) {
            this._inFlightMarker = undefined;
        }

        // Notify the latch
        this._latch.onConfirmResult(resolved);

        if (resolved) {
            const snap = this._slot.snapshot();
            const snapState = snap.state;
            const wasDelivered = snapState.kind === 'delivered';
            const episodeId = wasDelivered ? snapState.episode.episodeId : undefined;

            // Handle queued stale_solved that arrived while this confirmClose was in flight:
            // slot-free clears it (one CLOSE total -- spec §6 "cannot apply twice")
            this._owedConfirmClose = undefined;

            // Free the slot and tear down per-episode runtime
            this._slot.free();
            this._clearEpisodeRuntime();

            // Fold signal for DELIVERED terminals (PARKED terminals have no visible artifact)
            if (wasDelivered && episodeId) {
                // C4 will pass episodeLabel/closeMessageId for praise; for now emit without
                this._deps.foldEpisode(episodeId);
            }
        } else {
            // Not resolved: if there is a queued stale_solved, drain it now (spec §7.3)
            // The wire is free now -- drain on next _drainOwed() call
            void this._drainOwed();
        }
    }

    /**
     * Inbound staleCheck response from the server (C4 will parse and dispatch).
     * Stub for C3: handles watchdog ask-count bookkeeping when an ask was shown.
     */
    onServerStale(_askShown: boolean): void {
        this._serverAvailable = true;

        // Clear the in-flight staleCheck marker
        if (this._inFlightMarker?.intent === 'stale_check') {
            this._inFlightMarker = undefined;
        }

        if (_askShown && this._watchdog) {
            this._watchdog.onAskPosted();
        }

        // Wire now free -- drain any owed work
        void this._drainOwed();
    }

    // ---------------------------------------------------------------------------
    // Reconcile-action applier (shared by onServerAmbient / onServerActive)
    // ---------------------------------------------------------------------------

    private _applyDecideAction(
        action: ReconcileAction,
        text: string,
        hint: EpisodeHint,
        messageId: number | null,
        anchorFile: string | undefined,
        anchorLine: number | undefined,
        inlineHint: string | undefined,
        confidence: number | undefined,
        sessionId?: number,
    ): void {
        const now = Date.now();

        switch (action.kind) {
            case 'take-parked': {
                const ep = this._candidate!;
                this._slot.takeParked(now, ep, hint);
                this._candidate = undefined;
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, true /* parked */);
                this._latch.reset();
                // Parked surface: badge + lamp (+ gutter if anchor live)
                this._deps.setBadge(true);
                this._deps.showLamp();
                if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
                    this._deps.showGutterOnly(anchorFile, anchorLine);
                } else {
                    this._deps.clearInline();
                }
                this._dbg(`  -> TAKE-PARKED badge+lamp${anchorFile ? '+gutter' : ''} hint="${text}"`);
                void this._deps.log.record({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'take-delivered': {
                const ep = this._candidate!;
                this._slot.takeDelivered(now, ep, hint);
                this._candidate = undefined;
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, false /* delivered */);
                this._latch.reset();
                this._applyActiveSurface(text, messageId, anchorFile, anchorLine, inlineHint, sessionId);
                void this._deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'replace-parked': {
                const ep = this._candidate!;
                this._slot.replaceParked(now, ep, hint);
                this._candidate = undefined;
                // Watchdog: fresh instance for the new episode
                this._watchdog?.disarm();
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, true /* parked */);
                this._latch.reset();
                // Surface: same parked pointers (badge + lamp + maybe gutter)
                this._deps.setBadge(true);
                this._deps.showLamp();
                if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
                    this._deps.showGutterOnly(anchorFile, anchorLine);
                } else {
                    this._deps.clearInline();
                }
                this._dbg(`  -> REPLACE-PARKED new hint="${text}"`);
                void this._deps.log.record({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'replace-delivered': {
                const ep = this._candidate!;
                this._slot.replaceWithDelivered(now, ep, hint);
                this._candidate = undefined;
                // Watchdog: fresh instance for the replacement episode
                this._watchdog?.disarm();
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, false /* delivered */);
                this._latch.reset();
                this._applyActiveSurface(text, messageId, anchorFile, anchorLine, inlineHint, sessionId);
                void this._deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'escalate': {
                // DELIVERED ambient + hardEvent: escalate to active (same episode)
                this._slot.escalate(hint);
                const inSession = this._slot.snapshot().inSession;
                this._applyEscalation(inSession, text, anchorFile, anchorLine, inlineHint, messageId);
                // Watchdog: resetProgress is NOT called here (escalation is not "hard progress")
                void this._deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'suppress':
            case 'discard-free':
                // Suppress: server decided no surface change for this slot state
                this._dbg(`  -> SUPPRESS (slot=${this._slot.snapshot().state.kind})`);
                break;
        }
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
        this._deps.postBubble(bubbleText, messageId);
        if (sessionId !== undefined) {
            void this._deps.openSession(sessionId);
        }
        this._deps.setBadge(true);
        this._deps.showActiveNotification();
        this._deps.clearLamp();
        if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
            this._deps.showInline(anchorFile, anchorLine, inlineHint, bubbleText);
        } else {
            this._deps.clearInline();
        }
    }

    /**
     * Apply an escalation (PARKED -> DELIVERED transition, driven by C3 slot reconcile).
     * Computes loudness from `inSession`: when the chat view is open (in-session), the escalation
     * drops quietly as a bubble with no toast or inline push; otherwise it fires the full active
     * surface (toast + inline). This method does NOT touch the slot state (C3 owns that).
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
        this._deps.postBubble(text, messageId);
        if (inSession) { return; }
        // Out-of-session: full active push
        this._deps.showActiveNotification();
        if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
            this._deps.showInline(anchorFile, anchorLine, inlineHint, text);
        }
    }

    // ---------------------------------------------------------------------------
    // Guard validation helpers
    // ---------------------------------------------------------------------------

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
        this._inFlightMarker = undefined;
        return stamp;
    }

    /**
     * Clear in-flight marker without running guard validation (used on mid-flight drops
     * where we don't have a decide reply, e.g. student opt-out mid-flight).
     */
    private _clearInFlight(): void {
        this._inFlightMarker = undefined;
        this._candidate = undefined;
    }

    // ---------------------------------------------------------------------------
    // Watchdog event handling
    // ---------------------------------------------------------------------------

    private _handleWatchdogTick(nowMs: number): void {
        if (!this._watchdog) { return; }
        const snap = this._slot.snapshot();
        // Only tick when slot is PARKED or DELIVERED
        if (snap.state.kind === 'free') { return; }

        const event = this._watchdog.tick(nowMs);
        if (event === null) { return; }

        const exerciseId = this._deps.getExerciseId();

        switch (event.kind) {
            case 'fire-stale-check': {
                // Window already incremented inside tick() (wire-independent)
                if (this._watchdog.canPostAsk() && !this._liveAskBinding) {
                    this._owedStaleCheck = true;
                }
                // _drainOwed() is called after onTick returns
                break;
            }
            case 'force-free': {
                // DELIVERED terminal: free + ABANDONED + clearEpisodeRuntime + foldEpisode (no praise)
                const deliveredEp = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
                const episodeId = deliveredEp?.episodeId;

                // Scoped-cancel any in-flight request
                if (this._inFlightMarker && exerciseId !== undefined) {
                    const token = this._inFlightMarker.requestToken;
                    this._deps.cancelOutstandingStruggleJob(exerciseId, token).catch(() => { /* best-effort */ });
                }

                this._slot.free();
                this._clearEpisodeRuntime();

                if (episodeId && exerciseId !== undefined) {
                    void this._deps.setEpisodeOutcome(exerciseId, episodeId, 'ABANDONED').catch(() => { /* best-effort */ });
                    this._deps.foldEpisode(episodeId);
                }
                break;
            }
            case 'free-silent': {
                // PARKED terminal: free silently (no row, no foldEpisode)
                if (this._inFlightMarker && exerciseId !== undefined) {
                    const token = this._inFlightMarker.requestToken;
                    this._deps.cancelOutstandingStruggleJob(exerciseId, token).catch(() => { /* best-effort */ });
                }
                this._slot.free();
                this._clearEpisodeRuntime();
                break;
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Owed-request drain (confirmClose / staleCheck)
    // ---------------------------------------------------------------------------

    /**
     * Propagate latch pending-post state -> _owedConfirmClose queue.
     * Called immediately after every latch.observe() call so the owed entry is always set
     * BEFORE _drainOwed -- even when the wire is busy (owed survives until wire frees).
     */
    private _propagateLatchToOwed(): void {
        if (!this._latch.shouldPost() || this._owedConfirmClose) { return; }
        const kind = this._slot.snapshot().state.kind;
        if (kind === 'delivered') {
            this._owedConfirmClose = { confirmReason: 'progress' };
        } else if (kind === 'parked') {
            this._owedConfirmClose = { confirmReason: 'parked_progress' };
        }
    }

    private async _drainOwed(): Promise<void> {
        // Wire must be free to drain
        if (this._inFlightMarker !== undefined) { return; }

        const snap = this._slot.snapshot();
        if (snap.state.kind === 'free') { return; }

        const exerciseId = this._deps.getExerciseId();
        if (exerciseId === undefined) { return; }
        if (!this._lastSignal) { return; }

        // Priority 1: owed confirmClose
        if (this._owedConfirmClose) {
            const { confirmReason } = this._owedConfirmClose;
            // Determine episode block based on current slot state
            // Get episode from whichever taken state we're in (DELIVERED or PARKED)
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
            this._inFlightMarker = { requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'confirm_close', localToken };

            try {
                const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
                const result = await this._deps.postIntervention(exerciseId, {
                    struggleSignal: this._lastSignal,
                    uncommittedFiles,
                    intent: 'confirm_close',
                    episode: requestEpisode,
                    confirmReason,
                    requestToken,
                });
                if (result === 'accepted') {
                    this._continuedEpisodeIds.add(ep.episodeId);
                    this._owedConfirmClose = undefined;
                    this._latch.onPosted();
                } else {
                    // Not accepted (job pending, course-off, etc.) -- retry next tick
                    this._inFlightMarker = undefined;
                }
            } catch {
                this._inFlightMarker = undefined;
            }
            return;
        }

        // Priority 2: owed staleCheck
        if (this._owedStaleCheck && !this._liveAskBinding) {
            const epState2 = snap.state;
            const ep = epState2.kind === 'delivered' ? epState2.episode : null;
            if (!ep) { this._owedStaleCheck = false; return; }

            const requestToken = crypto.randomUUID();
            const requestEpisode = {
                episodeId: ep.episodeId,
                isNew: !this._continuedEpisodeIds.has(ep.episodeId),
                hints: ep.hints,
            };
            const stamp: PendingStamp = { episodeId: ep.episodeId, generation: snap.generation, hardEvent: false, requestToken };
            const localToken = this._guard.issue('stale_check', stamp);
            this._inFlightMarker = { requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'stale_check', localToken };

            try {
                const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
                const result = await this._deps.postIntervention(exerciseId, {
                    struggleSignal: this._lastSignal,
                    uncommittedFiles,
                    intent: 'stale_check',
                    episode: requestEpisode,
                    requestToken,
                });
                if (result === 'accepted') {
                    this._continuedEpisodeIds.add(ep.episodeId);
                    this._owedStaleCheck = false;
                } else {
                    this._inFlightMarker = undefined;
                }
            } catch {
                this._inFlightMarker = undefined;
            }
        }
    }

    // ---------------------------------------------------------------------------
    // clearEpisodeRuntime: tears down ALL per-episode runtime state
    // ---------------------------------------------------------------------------

    /**
     * Called on EVERY terminal transition (slot free). Tears down the progress latch, watchdog,
     * owed requests, and the live-ask binding (which neutralises any pending ABANDON timers).
     */
    private _clearEpisodeRuntime(): void {
        this._latch.reset();
        this._watchdog?.disarm();
        this._watchdog = undefined;
        this._owedConfirmClose = undefined;
        this._owedStaleCheck = false;
        // Cancel any in-flight staleCheck (guard cancel, not scoped-cancel -- the job was cleared on guard)
        this._guard.cancel('stale_check');
        // Clear the live-ask binding: neutralises any pending ABANDON setTimeout
        this._liveAskBinding = undefined;
        // Clear the in-flight marker (slot is terminal, nothing to reply to)
        this._inFlightMarker = undefined;
    }

    // ---------------------------------------------------------------------------
    // recordOutcome / backoff (C3: _lastSurface removed; backoff latches kept)
    // ---------------------------------------------------------------------------

    /**
     * A surfaced intervention was engaged (lamp click / toast action / inline command).
     * Feeds the reject backoff (dismiss escalates, click clears).
     */
    recordOutcome(outcome: 'clicked' | 'dismissed'): void {
        if (outcome === 'clicked') {
            this._annoyance = 0;
            this._dismissStrikes = 0;
            this._softSkipBudget = 0;
        } else {
            this._dismissStrikes += 1;
            this._annoyance += 2;
            if (this._annoyance >= this._deps.softThreshold) {
                this._softSkipBudget += 1;
            }
        }
    }

    /**
     * An explicit chat-bubble dismiss (spec §6.3). Bumps the Slice-4a counters directly.
     */
    recordChatDismiss(): void {
        this._dismissStrikes += 1;
        this._annoyance += 2;
        if (this._annoyance >= this._deps.softThreshold) {
            this._softSkipBudget += 1;
        }
    }

    /** True while proactive is paused for this exercise (only an explicit dismiss can trigger this, spec §5.2). */
    isPaused(): boolean {
        return this._dismissStrikes >= this._deps.pauseStrikes;
    }

    /** True iff the delivery backoff is currently paused for the active exercise. */
    isProactivePaused(exerciseId: number): boolean {
        return this._deps.getExerciseId() === exerciseId && this.isPaused();
    }

    /**
     * True iff proactive is running in a degraded mode (spec §14 cases 4-5): no proactive-egress consent
     * OR a 404-latched server.
     */
    isProactiveDegraded(): boolean {
        return !this._deps.isEgressEnabled() || !this._serverAvailable;
    }

    private _clearBackoff(): void {
        this._dismissStrikes = 0;
        this._annoyance = 0;
        this._softSkipBudget = 0;
    }

    resumeProactive(exerciseId: number): void {
        if (this._deps.getExerciseId() !== exerciseId) { return; }
        this._clearBackoff();
    }

    setStudentProactive(exerciseId: number, on: boolean): void {
        if (this._deps.getExerciseId() !== exerciseId) { return; }
        if (on) {
            this._clearBackoff();
        } else {
            this._deps.clearLamp();
            this._deps.clearInline();
            this._deps.setBadge(false);
        }
    }

    tryConsumeSoftSkip(): boolean {
        if (this._softSkipBudget > 0) {
            this._softSkipBudget -= 1;
            return true;
        }
        return false;
    }

    /**
     * AlertSink.reset -- the coordinator's settings-toggle / context-clear path. Clears ALL surfaces
     * (incl. the lamp) + the in-flight slot, but DELIBERATELY KEEPS the per-session latches (404 /
     * course-off) and the active cap: a config-off->on toggle mid-session must not silently lift a latch.
     */
    reset(): void {
        this._buffer.clear();
        this._inFlightMarker = undefined;
        this._candidate = undefined;
        this._lastSignal = undefined;
        this._deps.setBadge(false);
        this._deps.clearLamp();
        this._deps.clearInline();
    }

    /**
     * New-exercise reset: clear the per-exercise backoff AND the per-session latches (404 / course-off),
     * then the UI/session state. Also frees the slot, clears the frozen session id, and clears pending
     * outcomes (C2: new exercise = clean state).
     */
    resetSession(): void {
        this._annoyance = 0;
        this._dismissStrikes = 0;
        this._softSkipBudget = 0;
        this._serverAvailable = true;
        this._courseProactiveOff = false;
        // C2: cancel any in-flight reveal-persist retry (generation bump invalidates stale closures)
        this._revealRetryGen++;
        // C3: clear all slot + episode runtime state
        if (!this._slot.isFree()) {
            this._slot.free();
        }
        this._clearEpisodeRuntime();
        this._continuedEpisodeIds.clear();
        this._frozenSessionId = undefined;
        this._pendingOutcomes.clear();
        this.reset();
    }

    // -------------------------------------------------------------------------
    // C2: reveal-on-click + episode-outcome back-fill
    // -------------------------------------------------------------------------

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
        const sessionId = this._frozenSessionId;
        const exerciseId = this._deps.getExerciseId();
        if (sessionId === undefined || exerciseId === undefined) {
            this._dbg('revealParkedHint: missing sessionId or exerciseId, cannot reveal');
            return;
        }

        const localId = this._deps.generateLocalId();

        // C3: scoped-cancel any in-flight request (the generation bump on reveal makes it stale)
        const inflight = this._inFlightMarker;
        if (inflight) {
            // Scoped cancel: send server cancel to free the job slot
            this._deps.cancelOutstandingStruggleJob(exerciseId, inflight.requestToken).catch(() => { /* best-effort */ });
            // Re-owe the work that was in-flight under DELIVERED semantics
            if (inflight.intent === 'confirm_close') {
                // Re-owe as a DELIVERED progress close (not parked_progress)
                this._owedConfirmClose = { confirmReason: 'progress' };
            }
            // Clear the in-flight marker so the wire re-opens
            this._inFlightMarker = undefined;
        }

        // Also reset the latch so it does not remain stuck in candidate-close
        this._latch.reset();
        // Clear any owed confirmClose (the re-owe above replaces it with the DELIVERED variant)
        // We set it above if needed; otherwise clear stale parked_progress
        if (this._owedConfirmClose?.confirmReason === 'parked_progress') {
            // Convert to delivered progress (same physical edge, new slot state)
            this._owedConfirmClose = { confirmReason: 'progress' };
        }

        // Transition PARKED -> DELIVERED (generation bump -- invalidates any accept() for old gen)
        const hint: EpisodeHint = { level: 'ambient', text: frozenText, atSessionS: 0 };
        this._slot.revealParked(hint);

        // Watchdog: continue running (episode is still the same, re-arm for delivered)
        if (this._watchdog) {
            this._watchdog.arm(Date.now(), false /* now delivered */);
        }

        void this._deps.openSession(sessionId);
        this._deps.postRevealBubble(frozenText, localId);
        this._dbg(`  -> REVEAL click: episodeId=${episodeId} sessionId=${sessionId} localId=${localId}`);
        await this._persistReveal(exerciseId, episodeId, frozenText, 'ambient', localId);
    }

    /**
     * Record the student's terminal outcome for the active episode (spec §7.5, A10 episode-keyed endpoint).
     */
    async applyEpisodeOutcome(
        episodeId: string,
        sessionId: number,
        outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED',
    ): Promise<void> {
        const exerciseId = this._deps.getExerciseId();
        if (exerciseId === undefined) { return; }
        const { applied } = await this._deps.setEpisodeOutcome(exerciseId, episodeId, outcome);
        if (!applied) {
            this._pendingOutcomes.set(episodeId, { sessionId, outcome });
            this._dbg(`  -> back-fill: outcome=${outcome} deferred for episodeId=${episodeId} (row not yet created)`);
        }
    }

    /**
     * Persist the revealed hint as a canonical chat message row. On success, reconciles the optimistic
     * bubble and flushes any pending terminal outcome. On transient failure, schedules a best-effort retry.
     */
    private async _persistReveal(
        exerciseId: number,
        episodeId: string,
        hintText: string,
        level: Level,
        localId: string,
        attempt = 0,
    ): Promise<void> {
        try {
            const dto = await this._deps.revealAmbient(exerciseId, episodeId, hintText, level, localId);
            if (dto.id === undefined) {
                throw new Error('revealAmbient returned a DTO with no message id');
            }
            const serverId = dto.id;
            const proactiveEpisodeId = typeof dto['proactiveEpisodeId'] === 'string' ? dto['proactiveEpisodeId'] : undefined;
            const sentAt = typeof dto['sentAt'] === 'string' ? dto['sentAt'] : new Date().toISOString();
            this._deps.reconcileOptimisticBubble(localId, serverId, proactiveEpisodeId, sentAt);
            this._dbg(`  -> reveal persisted: serverId=${serverId} proactiveEpisodeId=${proactiveEpisodeId ?? 'none'}`);
            // Flush any pending terminal outcome recorded before the canonical row existed
            const pending = this._pendingOutcomes.get(episodeId);
            if (pending) {
                this._pendingOutcomes.delete(episodeId);
                this._dbg(`  -> back-fill flush: outcome=${pending.outcome} for episodeId=${episodeId}`);
                try {
                    await this._deps.setEpisodeOutcome(exerciseId, episodeId, pending.outcome);
                } catch (flushErr) {
                    this._dbg(`  -> back-fill flush failed (best-effort): ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
                }
            }
        } catch (err) {
            if (err instanceof ApiError && NON_RETRIABLE_REVEAL_STATUSES.has(err.status)) {
                this._dbg(`  -> reveal persist: permanent ${err.status}, not retrying (spec §12 attrition)`);
                return;
            }
            if (attempt >= MAX_REVEAL_RETRIES) {
                this._dbg(`  -> reveal persist: max retries (${MAX_REVEAL_RETRIES}) reached, giving up`);
                return;
            }
            this._dbg(`  -> reveal persist failed (attempt ${attempt + 1}/${MAX_REVEAL_RETRIES}), scheduling retry in ${REVEAL_RETRY_MS}ms`);
            const myGen = this._revealRetryGen;
            const schedule = this._deps.setTimeoutFn ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
            schedule(() => {
                if (this._revealRetryGen !== myGen) { return; }
                void this._persistReveal(exerciseId, episodeId, hintText, level, localId, attempt + 1);
            }, REVEAL_RETRY_MS);
        }
    }
}
