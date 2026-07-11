import type { Uri } from 'vscode';

import type { EpisodeHistoryEntry, EpisodeOutcomeLabel, ProactiveLevel, SlotDebugSnapshot } from '@shared/messageContracts';

import { ApiError } from '@extension/domain';
import { isSafeAnchorPath } from '@extension/services/intervention/anchorPath';
import { rebaseAnchorLine } from '@extension/services/intervention/anchorRebase';
import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import type { IrisChatMessage } from '@extension/types';

import { buildStruggleSignal } from './buildStruggleSignal';
import { decideOutcome } from './decideOutcome';
import type { InterventionEventLog } from './interventionEventLog';
import type { EpisodeHint, Level } from './slot/episode';
import type { Episode } from './slot/episode';
import { newEpisode } from './slot/episode';
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
import { TickRingBuffer } from './tickRingBuffer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The in-flight marker tracks the outstanding struggle POST (single-outstanding). */
interface InFlightMarker {
    requestToken: string;
    episodeId: string;
    generation: number;
    intent: 'decide' | 'confirm_close' | 'help_request';
    /** Local token from InFlightGuard.issue() for accept() call. */
    localToken: number;
    /**
     * The exact working-copy snapshot (`uncommittedFiles`) this decide POST sent, keyed by the same
     * path the server anchors against. Used at delivery to rebase the server anchor line onto the
     * live buffer (the coord system it was picked in). Set after collectFiles; dropped with the
     * marker. Only decide POSTs carry an anchor reply, so confirm_close leaves it undefined.
     */
    baseline?: Record<string, string>;
}

/** A queued confirmClose reason waiting to be POSTed. */
interface OwedConfirmClose {
    confirmReason: 'progress' | 'parked_progress';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Delay between reveal-persist retries. The server upsert is idempotent (A10), so retries are safe. */
const REVEAL_RETRY_MS = 5_000;
/** Maximum number of reveal-persist retry attempts (~1 min at 5s). After this the bubble stays runtime-only. */
const MAX_REVEAL_RETRIES = 12;
/** Permanent server-side rejection codes. These must not be retried; only transient/5xx/network errors are retried. */
const NON_RETRIABLE_REVEAL_STATUSES = new Set([400, 403, 404, 422]);

/** Boundary types that constitute a hard event (drive the escalation path). */
const HARD_BOUNDARIES = new Set<string>(['FM', 'E4', 'N1']);

/**
 * A hard alert is anchored on a student ACTION (build/terminal/paste), not on passive state:
 * it clears/bypasses the awaiting-evidence gate and may escalate a delivered-ambient episode.
 * Edit path: any hard boundary present. Discrete path: the test-stagnation trigger is hard
 * (build-anchored — the engine treats it as warmup-breaking for the same reason). Scoped to
 * the TRIGGER, not the kind: a future discrete add-on must opt into hard semantics explicitly.
 */
function isHardAlert(alert: AlertRecord): boolean {
    return alert.kind === 'edit'
        ? alert.types.some(t => HARD_BOUNDARIES.has(t))
        : alert.trigger === 'test-stagnation';
}

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface StruggleInterventionDeps {
    /** True iff Iris is enabled for the active exercise's course (global profile + course chat).
     *  Fail-closed: false when Iris is off OR availability is not yet known. */
    isIrisEnabled(): boolean;
    isEgressEnabled(): boolean;
    /** True when a `.noai` marker file is present in the workspace (spec §9). */
    hasNoaiMarker(): boolean;
    getExerciseId(): number | undefined;
    getExerciseRoot(): Uri | undefined;
    collectFiles(root: Uri | undefined): Promise<Record<string, string>>;
    /**
     * Current in-memory buffer text of the anchor file (resolved exercise-root-relative, the same way
     * the anchor surfaces do), or undefined when the file is not open. Reads the editor buffer, NOT
     * disk, so unsaved edits are reflected. Used to rebase the server anchor line onto the live
     * document at delivery.
     */
    readFileContent(anchorFile: string): string | undefined;
    postIntervention(exerciseId: number, body: StruggleInterventionRequest): Promise<StruggleEgressResult>;
    /** Open/attach the proactive session by id + reload its history so the bubble shows (spec §5.5 active). */
    openSession(sessionId: number): Promise<void>;
    /** Show the ambient-hint lamp for a PARKED server hint (spec §5 pull model). No per-hint tooltip. */
    showLamp(): void;
    /**
     * Arm the jump lamp for an active hint carrying a code anchor (spec §4.1): a status-bar item that,
     * on click, opens the anchored file at the line so the student can find the (silent, possibly
     * off-screen) inline cue. The wiring snapshots the absolute Uri at arm time.
     */
    showActiveJump(anchorFile: string, anchorLine: number): void;
    /** Hide the status-bar lamp unconditionally (session/context reset so stale hints do not survive). */
    clearLamp(): void;
    /**
     * Clear the lamp ONLY when it shows an episode-scoped surface (parked / jump). Called from
     * per-episode teardown + the inline hide/dismiss paths.
     */
    clearEpisodeLamp(): void;
    /**
     * Arm the inline in-editor cue (gutter logo + after-line hint + hover) at the anchor (spec §4.1,
     * relaxed): the decoration renders whenever the anchored file is a visible editor, so a cue armed
     * while the student looks elsewhere appears as soon as they open the file.
     */
    showInline(anchorFile: string, anchorLine: number, inlineHint: string, message: string): void;
    /** Arm the ambient gutter-only decoration (gutter icon, NO after-line text) at the anchor (spec §5). */
    showGutterOnly(anchorFile: string, anchorLine: number): void;
    /** Remove any inline cue (session/context reset). */
    clearInline(): void;
    /** Durable per-exercise student opt-out (spec §12.2): false -> the orchestrator suppresses proactive for it. */
    isStudentProactiveOn(exerciseId: number): boolean;
    /**
     * Per-exercise proactive-help level (Off/Less/More, spec §12.2). Used by the client-side Pull
     * re-route: an inbound `active` event for a `less` exercise is downgraded to the ambient/PARKED
     * path so Less never surfaces a bubble/notification, even when the server decided `active`.
     */
    getProactiveLevel(exerciseId: number): ProactiveLevel;
    setBadge(on: boolean): void;
    /** Show the proactive nudge banner for the given (out-of-session, DELIVERED) episode. */
    showActiveBanner(episodeId: string | undefined): void;
    /** Hide the proactive nudge banner. */
    hideActiveBanner(): void;
    /**
     * Post an offer bubble (spec B+): an assistant row carrying a client-local `offer` marker
     * (no content) that renders with answer buttons until resolved. `episodeId` threads the row
     * into its episode group, same as `postBubble`.
     */
    postOfferBubble(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void;
    /**
     * Resolve an offer bubble (spec B+): the webview finds the bubble by `offerId` and sets its
     * `offer.answered` (renders the condensed line in C10).
     */
    resolveOfferBubble(offerId: string, answered: 'accept' | 'decline' | 'timeout'): void;
    /**
     * Show the proactive nudge banner as an offer (spec B+): carries `moment`/`offerId` context
     * so the banner can render offer-specific copy and echo the answer back on resolution.
     */
    showOfferBanner(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void;
    /**
     * Post an optimistic proactive bubble to the open chat. When `messageId` is set, a later server
     * message with the same id deduplicates on the webview side. When `messageId` is null
     * (server persist failed, A9), the bubble is runtime-only and carries no dedup tag.
     * `episodeId` threads the row into its episode group (live deliveries pass it; the reveal
     * path stays episode-less).
     */
    postBubble(text: string, messageId: number | null, episodeId?: string): void;
    /**
     * Push the host-authoritative live-episode snapshot to the chat webview: the DELIVERED
     * episode's id, or null when no episode is live. Called on every slot transition (coalesced
     * with the slot-change microtask, deduplicated by value). The provider caches the value and
     * replays it on webview init, so a re-created webview never folds the live episode.
     */
    setChatLiveEpisode(episodeId: string | null): void;
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
    foldEpisode(
        episodeId: string,
        outcome: 'RECOVERED' | 'DISMISSED' | 'ABANDONED',
        praise?: { episodeLabel: string; closeMessageId: number },
    ): void;
    // ---- C4: stale-row suppression ----
    /**
     * Post a host->webview removeMessage{id} so the webview removes the stale row (if present)
     * and suppresses any later chat-ws arrival of the same id (C4 stale-row suppression).
     */
    postRemoveMessage(id: number): void;
    /**
     * Durable delete of a superseded proactive row (A10). Server-guarded (null-outcome +
     * proactive-origin only) so this cannot remove a canonical outcome row.
     */
    deleteSupersededProactiveMessage(exerciseId: number, messageId: number): Promise<void>;
    log: InterventionEventLog;
    setTimeoutFn?: (fn: () => void, ms: number) => void;
    /** Developer-mode diagnostic sink (gated upstream); no-op when omitted. Pure string out, no effects. */
    devLog?(msg: string): void;
    /** Debug-only slot-state change sink (gated upstream); no-op when omitted. Best-effort, must not throw into a slot path. */
    onSlotChange?(): void;
    /** Idle watchdog config (idleAbandonMs). Consumed from TUNING.slot. */
    slotCfg?: StaleConfig;
    /** Progress-close latch config. Consumed from TUNING.slot. */
    progressCloseCfg?: ProgressCloseCfg;
}

// ---------------------------------------------------------------------------
// Default slot config (mirrors TUNING.slot; injected so tests can override)
// ---------------------------------------------------------------------------

const DEFAULT_SLOT_CFG: StaleConfig = {
    idleAbandonMs: 600_000,
    warnLeadMs: 60_000,
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

    // Most recent StruggleSignal from deliver(); reused for confirmClose POSTs
    _lastSignal: StruggleSignal | undefined;

    // Owed confirmClose (at most one; queued while the wire is busy)
    _owedConfirmClose: OwedConfirmClose | undefined;

    // Episode ids that have had at least one accepted POST (isNew flipped to false for future POSTs)
    private _continuedEpisodeIds = new Set<string>();

    // Per-episode accepted-offer count (the cap: Less 1 / More 3). The opening hint is NOT counted.
    _offeredHintCounts = new Map<string, number>();

    // Episodes for which a Moment-1 stuck offer was declined (no re-offer for that episode).
    _offersDeclined = new Set<string>();

    // The single in-flight Moment-1 offer awaiting an answer (accept/decline/timeout), if any.
    _outstandingOffer: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' } | undefined;

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
    _pendingOutcomes = new Map<string, { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }>();

    /**
     * Evidence gate after idle-abandon: set when the stale watchdog silently frees a slot
     * (force-free / free-silent). While set, non-hard-boundary alerts are dropped pre-throttle
     * (no POST, no delivery-budget consumption), so a walked-away session cannot re-hint on
     * idle alone. Cleared by fresh student activity: a typing tick (one-char inserts), a
     * hard-boundary alert, a new green test, or an explicit proactive re-enable. Session-only;
     * a reload is covered by the D1 warmup instead.
     */
    private _awaitingEvidence = false;

    // ---------------------------------------------------------------------------
    // Task 3: episode history ring buffer + slot-change notify
    // ---------------------------------------------------------------------------

    private _episodeHistory: EpisodeHistoryEntry[] = [];
    private static readonly HISTORY_CAP = 20;
    private _slotChangeScheduled = false;

    /** Last live-episode value pushed to the chat (SetLiveEpisode frame); dedups by value. */
    private _lastChatLiveEpisodeId: string | null = null;

    constructor(private readonly _deps: StruggleInterventionDeps) {
        this._latch = new ProgressCloseLatch(
            _deps.progressCloseCfg ?? DEFAULT_PROGRESS_CFG,
        );
    }

    // ---------------------------------------------------------------------------
    // Slot debug snapshot + episode history (read-only, never throw)
    // ---------------------------------------------------------------------------

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
            pendingOutcomes: this._pendingOutcomes.size,
            awaitingEvidence: this._awaitingEvidence,
            suppression: {
                serverAvailable: this._serverAvailable,
                courseProactiveOff: this._courseProactiveOff,
                studentProactiveOn: (() => {
                    const exId = this._deps.getExerciseId();
                    return exId === undefined ? true : this._deps.isStudentProactiveOn(exId);
                })(),
            },
        };
    }

    /** The in-memory, session-only episode history (newest last). */
    getEpisodeHistory(): readonly EpisodeHistoryEntry[] {
        return this._episodeHistory;
    }

    /** Append a terminal episode to the ring buffer; derives peakLevel + duration from the episode. */
    private recordTerminalEpisode(episode: Episode, outcome: EpisodeOutcomeLabel): void {
        const peakLevel: 'ambient' | 'active' = episode.hints.some(h => h.level === 'active') ? 'active' : 'ambient';
        this._episodeHistory.push({
            episodeId: episode.episodeId,
            peakLevel,
            outcome,
            hintCount: episode.hints.length,
            durationMs: Date.now() - episode.createdAtMs,
            startedAtMs: episode.createdAtMs,
        });
        if (this._episodeHistory.length > StruggleInterventionService.HISTORY_CAP) {
            this._episodeHistory.shift();
        }
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

    // ---------------------------------------------------------------------------
    // Notifying setters (complete-by-construction notify coverage)
    // ---------------------------------------------------------------------------

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

    private _setPendingOutcome(episodeId: string, outcome: { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }): void { this._pendingOutcomes.set(episodeId, outcome); this.notifySlotDebugChanged(); }
    private _deletePendingOutcome(episodeId: string): void { this._pendingOutcomes.delete(episodeId); this.notifySlotDebugChanged(); }
    private _clearPendingOutcomes(): void { this._pendingOutcomes.clear(); this.notifySlotDebugChanged(); }

    // ---------------------------------------------------------------------------
    // AlertSink
    // ---------------------------------------------------------------------------

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
        // Feed the latch: newGreenTest=true triggers a progress edge
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

    /** AlertSink.deliver -- the coordinator calls this ONLY when `enabled && showInterventions`. */
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
        if (!this._deps.isIrisEnabled()) {
            return '  -> SKIP (Iris not enabled for this course: no proactivity)';
        }
        if (this._courseProactiveOff) {
            return '  -> SKIP (course proactive disabled for this session)';
        }
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return '  -> SKIP (student turned proactive off for this exercise)';
        }
        if (this._awaitingEvidence && !isHardAlert(alert)) {
            return '  -> SKIP (awaiting fresh evidence after idle-abandon)';
        }
        // Delivered-slot POST gating: while the slot is DELIVERED, reconcile suppresses every
        // inbound result except the escalation case (revealed-ambient level + hard event).
        // When no result could surface, don't pay for the server pipeline run at all.
        const slot = this._slot.snapshot().state;
        if (slot.kind === 'delivered' && !(slot.level === 'ambient' && isHardAlert(alert))) {
            if (this._canRaiseStuckOfferNow(slot.episode.episodeId)) {
                return null;
            }
            return '  -> SKIP (delivered slot: reconcile would suppress any result, POST saved)';
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

        const preSlot = this._slot.snapshot().state;
        if (preSlot.kind === 'delivered'
            && !(preSlot.level === 'ambient' && isHardAlert(alert))
            && this._canRaiseStuckOfferNow(preSlot.episode.episodeId)) {
            this._raiseStuckOffer();
            return;
        }

        // A hard alert is itself fresh evidence (build/terminal/paste = student action).
        if (this._awaitingEvidence && isHardAlert(alert)) {
            this._setAwaitingEvidence(false, 'hard-boundary alert');
        }

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
            this._setInFlightMarker({ requestToken, episodeId: requestEpisode.episodeId, generation: snap.generation, intent: 'decide', localToken });

            const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
            // Stash the exact bytes we send as the rebase baseline for the eventual anchor reply. The
            // marker is stable across this await (the in-flight guard blocks a second decide, and no
            // reply for this POST can exist yet), but key on the requestToken to be defensive.
            if (this._inFlightMarker?.requestToken === requestToken) {
                this._inFlightMarker.baseline = uncommittedFiles;
            }
            await this._deps.log.record({ action: 'requested', finalAction: 'silent', surface: 'none', source: 'server', signal });

            const result = await this._deps.postIntervention(exerciseId, {
                struggleSignal: signal,
                uncommittedFiles,
                intent: 'decide',
                episode: requestEpisode,
                requestToken,
                proactivityMode: this._deps.getProactiveLevel(exerciseId) === 'less' ? 'pull' : 'push',
            });

            this._dbg(`  -> POST result: ${result}`);

            if (result === 'accepted') {
                // This episode has now been seen by Pyris: record it so later requests send isNew=false.
                this._continuedEpisodeIds.add(requestEpisode.episodeId);
                // _inFlightMarker stays set until the websocket reply arrives (onServerAmbient/Active/Silent)
            } else if (result === 'course-off') {
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
            this._setInFlightMarker(undefined);
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
        this._setServerAvailable(true);

        if (sessionId !== undefined) {
            this._frozenSessionId = sessionId;
        }

        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            this._clearInFlight();
            return;
        }

        // Read the sent snapshot BEFORE _acceptDecide clears the in-flight marker (it is the coord
        // system the server anchored against; the rebase happens once in _applyDecideAction).
        const baseline = this._inFlightMarker?.baseline;

        // Validate against the pending decide stamp (drop stale replies)
        const accepted = this._acceptDecide();
        if (accepted === null) {
            return; // stale: slot moved since POST, or no decide was outstanding
        }

        const snap = this._slot.snapshot();
        const decision = { action: 'ambient' as const, text: hint, hardEvent: accepted.hardEvent };
        const action = reconcile(snap.state, decision);

        this._applyDecideAction(action, hint, { level: 'ambient', text: hint, atSessionS: Date.now() / 1000 }, messageId ?? null, anchorFile, anchorLine, inlineHint, confidence, baseline);
    }

    /**
     * Inbound active event from the server (delivered, bubble+notification). Routes through reconcile;
     * may take-delivered (FREE), replace-delivered (PARKED), escalate (revealed-ambient DELIVERED +
     * hardEvent), or suppress (already-active DELIVERED, no hardEvent, etc.).
     * Pull re-route (spec §12.2): when the active exercise's level is `less`, this delegates to
     * {@link onServerAmbient} instead, so Less never creates a DELIVERED episode/bubble/notification.
     */
    onServerActive(sessionId: number, anchorFile?: string, anchorLine?: number, inlineHint?: string, confidence?: number, message?: string, messageId?: number | null): void {
        this._setServerAvailable(true);

        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            this._clearInFlight();
            return;
        }

        // Consented follow-up (help_request): an invited delivery. Bypass the Less reroute AND reconcile's
        // delivered-suppress; append to the open episode as a bubble. Disambiguated by the marker's intent.
        if (this._inFlightMarker?.intent === 'help_request') {
            const baseline = this._inFlightMarker.baseline;
            const accepted = this._acceptHelpRequest();
            if (accepted === null) {
                return;
            }
            const text = message ?? 'Iris has a suggestion for you.';
            let effectiveAnchorLine = anchorLine;
            if (anchorFile !== undefined && anchorLine !== undefined && isSafeAnchorPath(anchorFile)) {
                const base = baseline?.[anchorFile];
                const current = base !== undefined ? this._deps.readFileContent(anchorFile) : undefined;
                if (base !== undefined && current !== undefined) {
                    effectiveAnchorLine = rebaseAnchorLine(base, current, anchorLine);
                }
            }
            this._slot.appendFollowup({ level: 'active', text, atSessionS: Date.now() / 1000 });
            const episodeId = this._deliveredEpisodeId();
            if (episodeId) {
                this._offeredHintCounts.set(episodeId, (this._offeredHintCounts.get(episodeId) ?? 0) + 1);
            }
            this._watchdog?.resetProgress(Date.now());
            this._applyActiveSurface(text, messageId ?? null, anchorFile, effectiveAnchorLine, inlineHint, sessionId);
            return;
        }

        // Pull re-route (spec §12.2 Off/Less/More): Less may only surface quietly (lamp/gutter),
        // never a bubble/notification, even when the server decided `active`. Check the level BEFORE
        // _acceptDecide runs and hand the whole event to onServerAmbient, which does its own
        // _acceptDecide/baseline/_frozenSessionId bookkeeping -- falling through into the active
        // handling below would double-consume the in-flight marker (its _acceptDecide clears the
        // marker, so a second call here would read it as stale and silently drop the reply).
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
        if (level === 'less') {
            this.onServerAmbient(message ?? '', anchorFile, anchorLine, inlineHint, confidence, messageId, sessionId);
            return;
        }

        // Read the sent snapshot BEFORE _acceptDecide clears the in-flight marker (see onServerAmbient).
        const baseline = this._inFlightMarker?.baseline;

        const accepted = this._acceptDecide();
        if (accepted === null) {
            return;
        }

        const snap = this._slot.snapshot();
        const text = message ?? 'Iris has a suggestion for you.';
        const decision = { action: 'active' as const, text, hardEvent: accepted.hardEvent };
        const action = reconcile(snap.state, decision);

        this._applyDecideAction(action, text, { level: 'active', text, atSessionS: Date.now() / 1000 }, messageId ?? null, anchorFile, anchorLine, inlineHint, confidence, baseline, sessionId);
    }

    /**
     * Inbound silent event: server decided no intervention is needed.
     * Frees PARKED (discard-free), suppresses for DELIVERED (no-op).
     * C4: accepts `episodeId` echo (stale-drop if mismatch) and `messageId` for stale-row suppression.
     */
    onServerSilent(episodeId: string | undefined, messageId: number | undefined): void {
        this._setServerAvailable(true);

        // C4 echo check: verify the wire's episodeId matches what was requested.
        // Do this BEFORE _acceptDecide so a mismatch does NOT consume the in-flight marker
        // (the real reply for this episode may still arrive).
        const expectedEpisodeId = this._inFlightMarker?.episodeId;
        if (expectedEpisodeId === undefined || episodeId !== expectedEpisodeId) {
            if (messageId !== undefined) { this._dropStaleRow(messageId); }
            return;
        }

        // Consented follow-up that resolved silent: clear the help_request marker so the wire is not wedged,
        // and give an honest note. No cap slot is consumed.
        if (this._inFlightMarker?.intent === 'help_request') {
            const accepted = this._acceptHelpRequest();
            if (accepted === null) {
                if (messageId !== undefined) { this._dropStaleRow(messageId); }
                return;
            }
            this._deps.postBubble('Nothing more I can add right now.', null, this._deliveredEpisodeId());
            return;
        }

        const accepted = this._acceptDecide();
        if (accepted === null) {
            // Generation/token mismatch: stale. The marker was already cleared by _acceptDecide.
            if (messageId !== undefined) { this._dropStaleRow(messageId); }
            return;
        }

        const snap = this._slot.snapshot();
        const decision = { action: 'silent' as const, text: null, hardEvent: false };
        const action = reconcile(snap.state, decision);

        if (action.kind === 'discard-free') {
            this._dbg('  -> SILENT: discard PARKED -> FREE');
            if (snap.state.kind === 'parked') { this.recordTerminalEpisode(snap.state.episode, 'DISCARDED'); }
            this._slot.discardParkedToFree();
            this._clearEpisodeRuntime();
        } else {
            // 'suppress': DELIVERED + silent -> no-op (keep the live episode).
            // FREE + silent -> suppress -> discard the pending candidate.
            this._candidate = undefined;
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
        this._setServerAvailable(true);

        // C4 echo check: must be a confirm_close in-flight for the right episode.
        // Echo mismatch -> drop without consuming the marker (real reply may still arrive).
        const expectedEpisodeId = this._inFlightMarker?.episodeId;
        if (this._inFlightMarker?.intent !== 'confirm_close' || expectedEpisodeId === undefined || episodeId !== expectedEpisodeId) {
            if (closeMessageId !== undefined) { this._dropStaleRow(closeMessageId); }
            return;
        }

        // Clear the in-flight marker for the confirmClose intent
        this._setInFlightMarker(undefined);

        // Notify the latch
        this._latch.onConfirmResult(resolved);

        if (resolved) {
            const snap = this._slot.snapshot();
            const snapState = snap.state;
            const wasDelivered = snapState.kind === 'delivered';
            const wasParked = snapState.kind === 'parked';
            const liveEpisodeId = (wasDelivered || wasParked) ? snapState.episode.episodeId : undefined;

            // A confirmClose that resolves frees the slot; clear any owed confirmClose (one CLOSE total).
            this._setOwedConfirmClose(undefined);

            if (wasDelivered) {
                // DELIVERED resolved=true: free + RECOVERED outcome + fold with praise
                this._dbg(`  -> CLOSE resolved: DELIVERED -> FREE (RECOVERED) episodeId=${liveEpisodeId ?? 'n/a'}`);
                const exerciseId = this._deps.getExerciseId();
                this.recordTerminalEpisode((snapState as Extract<typeof snapState, { kind: 'delivered' }>).episode, 'RECOVERED');
                this._slot.free();
                this._clearEpisodeRuntime();
                if (liveEpisodeId) {
                    if (exerciseId !== undefined) {
                        this._writeOutcomeWithBackfill(exerciseId, liveEpisodeId, 'RECOVERED');
                    }
                    const praise = (episodeLabel && closeMessageId !== undefined)
                        ? { episodeLabel, closeMessageId }
                        : undefined;
                    this._deps.foldEpisode(liveEpisodeId, 'RECOVERED', praise);
                }
            } else if (wasParked) {
                // PARKED resolved=true: discard silently (no row, no fold, no outcome)
                this._dbg('  -> CLOSE resolved: PARKED -> FREE (silent discard)');
                this.recordTerminalEpisode((snapState as Extract<typeof snapState, { kind: 'parked' }>).episode, 'DISCARDED');
                this._slot.discardParkedToFree();
                this._clearEpisodeRuntime();
            } else {
                // Already free (race): just clear runtime
                this._clearEpisodeRuntime();
            }
        } else {
            // Not resolved: drain any queued work
            this._dbg('  -> CLOSE not resolved: latch re-arms, slot stays');
            void this._drainOwed();
        }
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
        baseline: Record<string, string> | undefined,
        sessionId?: number,
    ): void {
        const now = Date.now();

        // Rebase the server anchor line from the snapshot we SENT at trigger onto the live buffer at
        // delivery: the server picked the line against those exact bytes, but the student kept typing
        // in the ~10s round-trip. Done ONCE here so every surface (gutter, inline + jump, escalation)
        // shares the corrected line. undefined -> the anchored line is gone, so the surfaces'
        // `!== undefined` guards drop the cue while the bubble/message still shows (fail-safe). No
        // baseline (anchor on an unchanged file) or file not open -> keep the raw line (today's behaviour).
        let effectiveAnchorLine = anchorLine;
        if (anchorFile !== undefined && anchorLine !== undefined && isSafeAnchorPath(anchorFile)) {
            const base = baseline?.[anchorFile];
            const current = base !== undefined ? this._deps.readFileContent(anchorFile) : undefined;
            if (base !== undefined && current !== undefined) {
                effectiveAnchorLine = rebaseAnchorLine(base, current, anchorLine);
            }
        }

        switch (action.kind) {
            case 'take-parked': {
                const ep = this._candidate!;
                this._slot.takeParked(now, ep, hint);
                this._candidate = undefined;
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, true /* parked */);
                this._latch.reset();
                // Parked surface: badge + lamp (+ gutter when the reply carries an anchor)
                this._deps.setBadge(true);
                this._deps.showLamp();
                if (anchorFile && effectiveAnchorLine !== undefined && inlineHint && isSafeAnchorPath(anchorFile)) {
                    this._deps.showGutterOnly(anchorFile, effectiveAnchorLine);
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
                this._dbg(`  -> TAKE-DELIVERED bubble hint="${text}"`);
                this._candidate = undefined;
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, false /* delivered */);
                this._latch.reset();
                this._applyActiveSurface(text, messageId, anchorFile, effectiveAnchorLine, inlineHint, sessionId);
                void this._deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'replace-parked': {
                // KNOWN GAP (debug history): replace swaps the slot's episode without a
                // recordTerminalEpisode for the outgoing one (replace is not an enumerated terminal
                // site). Today replace reuses the same episodeId, so nothing is lost; only if a
                // replace ever carried a DISTINCT outgoing episodeId would that episode be absent
                // from the session history. Acceptable for a best-effort debug surface.
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
                if (anchorFile && effectiveAnchorLine !== undefined && inlineHint && isSafeAnchorPath(anchorFile)) {
                    this._deps.showGutterOnly(anchorFile, effectiveAnchorLine);
                } else {
                    this._deps.clearInline();
                }
                this._dbg(`  -> REPLACE-PARKED new hint="${text}"`);
                void this._deps.log.record({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'replace-delivered': {
                // KNOWN GAP (debug history): see replace-parked above; the outgoing episode is not
                // recorded to history (same-episodeId reuse means nothing is lost in practice).
                const ep = this._candidate!;
                this._slot.replaceWithDelivered(now, ep, hint);
                this._dbg(`  -> REPLACE-DELIVERED bubble hint="${text}"`);
                this._candidate = undefined;
                // Watchdog: fresh instance for the replacement episode
                this._watchdog?.disarm();
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, false /* delivered */);
                this._latch.reset();
                this._applyActiveSurface(text, messageId, anchorFile, effectiveAnchorLine, inlineHint, sessionId);
                void this._deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'escalate': {
                // DELIVERED ambient + hardEvent: escalate to active (same episode)
                this._slot.escalate(hint);
                this._dbg(`  -> ESCALATE ambient->active hint="${text}"`);
                const inSession = this._slot.snapshot().inSession;
                this._applyEscalation(inSession, text, anchorFile, effectiveAnchorLine, inlineHint, messageId);
                // Watchdog: resetProgress is NOT called here (escalation is not "hard progress")
                void this._deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'suppress':
            case 'discard-free':
                // Suppress: server decided no surface change for this slot state. If the reply still
                // carried a persisted proactive row (messageId), it will never be surfaced live, so
                // drop it -- otherwise it reappears as a chat row on the next history/chat-ws load,
                // reintroducing the duplicate hint the occupied-slot suppress rule is meant to block.
                if (messageId !== null) { this._dropStaleRow(messageId); }
                this._dbg(`  -> SUPPRESS (slot=${this._slot.snapshot().state.kind})`);
                break;
        }
        this.notifySlotDebugChanged();
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
        this._deps.postBubble(bubbleText, messageId, this._deliveredEpisodeId());
        if (sessionId !== undefined) {
            void this._deps.openSession(sessionId);
        }
        this._deps.setBadge(true);
        // The bubble already lands in the open chat, so the banner is redundant (and noisy) when the
        // chat view is open. Mirror the escalation path, which already suppresses the banner in-session.
        if (!this._slot.snapshot().inSession) {
            this._deps.showActiveBanner(this._deliveredEpisodeId());
        }
        if (anchorFile && anchorLine !== undefined && inlineHint && isSafeAnchorPath(anchorFile)) {
            this._deps.showInline(anchorFile, anchorLine, inlineHint, bubbleText);
            // Jump lamp: the persistent, discoverable way to reach the (silent, possibly off-screen)
            // inline cue. A fresh accepted active reply is authoritative server state, so clobbering
            // any stale lamp (incl. a recovered-from fallback) via showActiveJump is correct here.
            this._deps.showActiveJump(anchorFile, anchorLine);
        } else {
            this._deps.clearInline();
            this._deps.clearLamp();
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
        this._deps.postBubble(text, messageId, this._deliveredEpisodeId());
        const hasAnchor = !!anchorFile && anchorLine !== undefined && !!inlineHint && isSafeAnchorPath(anchorFile);
        // The jump lamp is a leiser, no-focus-steal code pointer, so arm it for an anchored
        // escalation regardless of in-session (the inline cue below stays in-session-suppressed).
        if (hasAnchor) {
            this._deps.showActiveJump(anchorFile, anchorLine);
        }
        if (inSession) {
            // Quiet in-session escalation: bubble + jump lamp only. Still retire any inline/gutter
            // cue carried over from the parked phase (revealParkedHint keeps the parked gutter cue),
            // so a stale pointer at the old anchor cannot outlive the escalation.
            this._deps.clearInline();
            return;
        }
        // Out-of-session: full active push
        this._deps.showActiveBanner(this._deliveredEpisodeId());
        if (hasAnchor) {
            this._deps.showInline(anchorFile, anchorLine, inlineHint, text);
        } else {
            // No-anchor escalation: retire any stale parked gutter cue (nothing fresh to arm).
            this._deps.clearInline();
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
            case 'pre-abandon-warn': {
                this._dbg('  -> WATCHDOG pre-abandon-warn: Moment-3 offer');
                const ep = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
                if (!ep || this._inFlightMarker !== undefined) { break; }
                // A stale stuck offer (an ignored in-session bubble has no countdown) must not block the
                // more-urgent Moment-3 presence check -- supersede it, then raise the abandon offer.
                if (this._outstandingOffer?.moment === 'stuck') {
                    this._clearOutstandingOffer();
                }
                if (this._outstandingOffer === undefined) {
                    this._raiseAbandonOffer(ep.episodeId);
                }
                break;
            }
            case 'force-free': {
                // DELIVERED terminal: free + ABANDONED + clearEpisodeRuntime + foldEpisode (no praise)
                // Scoped cancel is now hoisted into _clearEpisodeRuntime.
                this._dbg('  -> WATCHDOG force-free: DELIVERED -> FREE (ABANDONED)');
                const deliveredEp = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
                const episodeId = deliveredEp?.episodeId;

                if (deliveredEp) { this.recordTerminalEpisode(deliveredEp, 'ABANDONED'); }
                this._slot.free();
                this._clearEpisodeRuntime();

                if (episodeId && exerciseId !== undefined) {
                    this._writeOutcomeWithBackfill(exerciseId, episodeId, 'ABANDONED');
                    this._deps.foldEpisode(episodeId, 'ABANDONED');
                }
                this._setAwaitingEvidence(true, 'idle-abandon force-free');
                break;
            }
            case 'free-silent': {
                // PARKED terminal: free silently (no row, no foldEpisode)
                // Scoped cancel is now hoisted into _clearEpisodeRuntime.
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

    // ---------------------------------------------------------------------------
    // Consented follow-up (help_request)
    // ---------------------------------------------------------------------------

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
            || !this._deps.isStudentProactiveOn(exerciseId)
            || !this._serverAvailable) {
            this._deps.postBubble('Nothing more I can add right now.', null, this._deliveredEpisodeId());
            return;
        }
        const ep = snap.state.episode;
        const requestToken = crypto.randomUUID();
        const requestEpisode = { episodeId: ep.episodeId, isNew: !this._continuedEpisodeIds.has(ep.episodeId), hints: ep.hints };
        const stamp: PendingStamp = { episodeId: ep.episodeId, generation: snap.generation, hardEvent: false, requestToken };
        const localToken = this._guard.issue('help_request', stamp);
        this._setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'help_request', localToken });
        try {
            const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
            if (this._inFlightMarker?.requestToken === requestToken) {
                this._inFlightMarker.baseline = uncommittedFiles;   // rebase baseline for an anchored follow-up
            }
            const result = await this._deps.postIntervention(exerciseId, {
                struggleSignal: this._lastSignal,
                uncommittedFiles,
                intent: 'help_request',
                episode: requestEpisode,
                requestToken,
                proactivityMode: this._deps.getProactiveLevel(exerciseId) === 'less' ? 'pull' : 'push',
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

    // ---------------------------------------------------------------------------
    // Owed-request drain (confirmClose)
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
            this._setOwedConfirmClose({ confirmReason: 'progress' });
        } else if (kind === 'parked') {
            this._setOwedConfirmClose({ confirmReason: 'parked_progress' });
        }
    }

    private async _drainOwed(): Promise<void> {
        // Defense-in-depth: never egress code while Iris is disabled, mirrors the _suppressReason gate.
        if (!this._deps.isIrisEnabled()) { return; }
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
            this._setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'confirm_close', localToken });

            try {
                const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
                const result = await this._deps.postIntervention(exerciseId, {
                    struggleSignal: this._lastSignal,
                    uncommittedFiles,
                    intent: 'confirm_close',
                    episode: requestEpisode,
                    confirmReason,
                    requestToken,
                    proactivityMode: this._deps.getProactiveLevel(exerciseId) === 'less' ? 'pull' : 'push',
                });
                if (result === 'accepted') {
                    this._continuedEpisodeIds.add(ep.episodeId);
                    this._setOwedConfirmClose(undefined);
                    this._latch.onPosted();
                } else {
                    // Not accepted (job pending, course-off, etc.) -- retry next tick
                    this._setInFlightMarker(undefined);
                }
            } catch {
                this._setInFlightMarker(undefined);
            }
            return;
        }

    }

    // ---------------------------------------------------------------------------
    // clearEpisodeRuntime: tears down ALL per-episode runtime state
    // ---------------------------------------------------------------------------

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
        this._latch.reset();
        this._watchdog?.disarm();
        this._watchdog = undefined;
        this._setOwedConfirmClose(undefined);
        // Scoped server-side cancel: free the outstanding job before nulling the marker.
        // revealParkedHint (non-terminal) cancels its own in-flight and does NOT call here.
        // replace-parked / replace-delivered (non-terminal) do NOT call here either, so
        // the in-flight decide completing into the replacement is NOT cancelled.
        if (this._inFlightMarker) {
            const exerciseId = this._deps.getExerciseId();
            if (exerciseId !== undefined) {
                const token = this._inFlightMarker.requestToken;
                this._deps.cancelOutstandingStruggleJob(exerciseId, token).catch(() => { /* best-effort */ });
            }
        }
        // Clear the in-flight marker (slot is terminal, nothing to reply to)
        this._setInFlightMarker(undefined);
        // Null the candidate (always overwritten before next use, but cleaner to be explicit)
        this._candidate = undefined;
        // An offer still outstanding when the episode terminates (RECOVERED / DISMISSED / any
        // force-free) must be resolved + cleared here, the single terminal chokepoint. Otherwise
        // _outstandingOffer strands and _canRaiseStuckOfferNow blocks every future offer this exercise.
        this._clearOutstandingOffer();
        this.notifySlotDebugChanged();
    }

    // ---------------------------------------------------------------------------
    // Moment-1 "still stuck" offer (delivered-slot cap, one outstanding offer at a time)
    // ---------------------------------------------------------------------------

    private _offerCapForLevel(level: ProactiveLevel): number {
        return level === 'more' ? 3 : level === 'less' ? 1 : 0;
    }

    _canOfferStuck(episodeId: string): boolean {
        if (this._offersDeclined.has(episodeId)) { return false; }
        const exId = this._deps.getExerciseId();
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
        return (this._offeredHintCounts.get(episodeId) ?? 0) < this._offerCapForLevel(level);
    }

    private _canRaiseStuckOfferNow(episodeId: string): boolean {
        return this._outstandingOffer === undefined && this._inFlightMarker === undefined && this._canOfferStuck(episodeId);
    }

    /** Resolve (as timeout) + clear any outstanding offer. Idempotent. Used on teardown, supersede, opt-out. */
    private _clearOutstandingOffer(): void {
        if (this._outstandingOffer) {
            this._deps.resolveOfferBubble(this._outstandingOffer.offerId, 'timeout');
            this._outstandingOffer = undefined;
        }
    }

    private _raiseStuckOffer(): void {
        const snap = this._slot.snapshot();
        if (snap.state.kind !== 'delivered') { return; }
        const episodeId = snap.state.episode.episodeId;
        const exId = this._deps.getExerciseId();
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
        // Off = 0 offers. _raiseStuckOffer is already gated upstream via _suppressReason, but keep
        // this guard for defence and symmetry with _raiseAbandonOffer.
        if (level === 'off') { return; }
        // Less + chat closed: stay fully quiet. A badge-only offer can never be answered (opening the
        // chat later does not surface it) and would strand the single-offer slot -- so skip it entirely.
        if (!snap.inSession && level === 'less') { return; }
        const offerId = crypto.randomUUID();
        this._outstandingOffer = { offerId, episodeId, moment: 'stuck' };
        if (snap.inSession) {
            this._deps.postOfferBubble({ offerId, episodeId, moment: 'stuck' });
        } else {
            this._deps.showOfferBanner({ offerId, episodeId, moment: 'stuck' });   // level === 'more' here
            this._deps.setBadge(true);
        }
    }

    /** Moment-1 "Show me": generate + deliver the next hint. Guarded to the outstanding offer + live episode. */
    acceptOffer(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        // A request is already in flight (e.g. a concurrent escalation decide): single-flight
        // _sendHelpRequest would drop this. Leave the offer outstanding for a retry rather than
        // resolving to a false "accepted" with no follow-up hint.
        if (this._inFlightMarker !== undefined) { return; }
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'accept');
        void this._sendHelpRequest();
    }

    /** Moment-1 "Not now": quiet for this episode. */
    declineOffer(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._offersDeclined.add(episodeId);
        this._deps.resolveOfferBubble(offerId, 'decline');
    }

    /**
     * A stuck offer's out-of-session banner auto-closed (ignored). Clear the outstanding offer so a later
     * alert may offer again (spec: "Ignored -> short cooldown, may offer again"); NOT added to declined.
     * (An in-session stuck bubble has no countdown, so this only fires for the banner path.)
     */
    offerTimedOut(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'timeout');
    }

    // ---------------------------------------------------------------------------
    // Moment-3 "Still on this?" presence check (60s before the idle-abandon force-free)
    // ---------------------------------------------------------------------------

    private _raiseAbandonOffer(episodeId: string): void {
        const exId = this._deps.getExerciseId();
        const level = exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more';
        // Off = 0 offers.
        if (level === 'off') { return; }
        const inSession = this._slot.snapshot().inSession;
        // Less + chat closed: stay fully quiet (see _raiseStuckOffer).
        if (!inSession && level === 'less') { return; }
        const offerId = crypto.randomUUID();
        this._outstandingOffer = { offerId, episodeId, moment: 'abandon' };
        if (inSession) {
            this._deps.postOfferBubble({ offerId, episodeId, moment: 'abandon' });
        } else {
            this._deps.showOfferBanner({ offerId, episodeId, moment: 'abandon' });   // level === 'more' here
            this._deps.setBadge(true);
        }
    }

    /** Moment-3 "I'm still on it": keep watching, reset the idle clock, no hint, no POST. */
    stillOnIt(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'decline');
        this._watchdog?.resetProgress(Date.now());
    }

    /** Moment-3 "I need more help": deliver on demand, overriding an exhausted cap; reset idle. */
    needMoreHelp(offerId: string, episodeId: string): void {
        if (this._outstandingOffer?.offerId !== offerId || episodeId !== this._deliveredEpisodeId()) { return; }
        this._watchdog?.resetProgress(Date.now());   // student is present -> keep the episode alive even if the send defers
        if (this._inFlightMarker !== undefined) { return; }   // in flight: leave the offer outstanding for a retry
        this._outstandingOffer = undefined;
        this._deps.resolveOfferBubble(offerId, 'accept');
        void this._sendHelpRequest();
    }

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
     * RECOVERED outcome (positive — the fold line is a success summary and Pyris/eval see the hint as
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
            // Full DELIVERED resolution: free + runtime teardown + outcome + fold (no praise)
            this.recordTerminalEpisode((snapState as Extract<typeof snapState, { kind: 'delivered' }>).episode, outcome);
            this._slot.free();
            this._clearEpisodeRuntime();
            if (targetEpisodeId && exerciseId !== undefined) {
                this._writeOutcomeWithBackfill(exerciseId, targetEpisodeId, outcome);
                this._deps.foldEpisode(targetEpisodeId, outcome);
            }
        } else if (targetEpisodeId && exerciseId !== undefined) {
            // Slot already FREE, PARKED, or episodeId mismatch: idempotent outcome write only.
            this._writeOutcomeWithBackfill(exerciseId, targetEpisodeId, outcome);
        }
    }

    /**
     * True iff proactive is running in a degraded mode (spec §14 cases 4-5): no proactive-egress consent
     * OR a 404-latched server.
     */
    isProactiveDegraded(): boolean {
        return !this._deps.isEgressEnabled() || !this._serverAvailable;
    }

    setStudentProactive(exerciseId: number, on: boolean): void {
        if (this._deps.getExerciseId() !== exerciseId) { return; }
        if (on) {
            // Flipping the toggle back on is a deliberate user action (student is present).
            this._setAwaitingEvidence(false, 'proactive re-enabled');
        } else {
            this._deps.clearLamp();
            this._deps.clearInline();
            this._deps.setBadge(false);
            this._deps.hideActiveBanner();
            this._clearOutstandingOffer();
        }
    }

    /**
     * AlertSink.reset -- the coordinator's settings-toggle / context-clear path. Clears ALL surfaces
     * (incl. the lamp) + the in-flight slot, but DELIBERATELY KEEPS the per-session latches (404 /
     * course-off) and the active cap: a config-off->on toggle mid-session must not silently lift a latch.
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
     * New-exercise reset: clear the per-session latches (404 / course-off), then the UI/session state.
     * Also frees the slot, clears the frozen session id, and clears pending outcomes (C2: new exercise
     * = clean state).
     */
    resetSession(): void {
        this._setServerAvailable(true);
        this._courseProactiveOff = false;
        // C2: cancel any in-flight reveal-persist retry (generation bump invalidates stale closures)
        this._revealRetryGen++;
        // C3: clear all slot + episode runtime state
        if (!this._slot.isFree()) {
            const st = this._slot.snapshot().state;
            if (st.kind === 'delivered') { this.recordTerminalEpisode(st.episode, 'INTERRUPTED'); }
            else if (st.kind === 'parked') { this.recordTerminalEpisode(st.episode, 'DISCARDED'); }
            this._dbg('  -> RESET (new exercise): slot -> FREE');
            this._slot.free();
        }
        this._clearEpisodeRuntime();
        this._continuedEpisodeIds.clear();
        this._frozenSessionId = undefined;
        this._clearPendingOutcomes();
        this._offeredHintCounts.clear();
        this._offersDeclined.clear();
        this._outstandingOffer = undefined;
        this._setAwaitingEvidence(false, 'new exercise');
        this.reset();
        this.notifySlotDebugChanged();
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
                this._setOwedConfirmClose({ confirmReason: 'progress' });
            }
            // Clear the in-flight marker so the wire re-opens
            this._setInFlightMarker(undefined);
        }

        // Also reset the latch so it does not remain stuck in candidate-close
        this._latch.reset();
        // Clear any owed confirmClose (the re-owe above replaces it with the DELIVERED variant)
        // We set it above if needed; otherwise clear stale parked_progress
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

        void this._deps.openSession(sessionId);
        this._deps.postRevealBubble(frozenText, localId);
        this._dbg(`  -> REVEAL click: episodeId=${episodeId} sessionId=${sessionId} localId=${localId}`);
        await this._persistReveal(exerciseId, episodeId, frozenText, 'ambient', localId);
    }

    /**
     * Record the student's terminal outcome for the active episode (spec §7.5, A10 episode-keyed endpoint).
     * Used in test harnesses to directly drive outcome writes with back-fill semantics.
     */
    async applyEpisodeOutcome(
        episodeId: string,
        outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED',
    ): Promise<void> {
        const exerciseId = this._deps.getExerciseId();
        if (exerciseId === undefined) { return; }
        const { applied } = await this._deps.setEpisodeOutcome(exerciseId, episodeId, outcome);
        if (!applied) {
            this._setPendingOutcome(episodeId, { outcome });
            this._dbg(`  -> back-fill: outcome=${outcome} deferred for episodeId=${episodeId} (row not yet created)`);
        }
    }

    /**
     * Write a terminal episode outcome and record a pending back-fill entry when the canonical
     * row does not yet exist (setEpisodeOutcome returns applied=false). The flush fires in
     * _persistReveal once the reveal-persist retry creates the row (spec §12 back-fill contract).
     * Best-effort: errors are swallowed so callers never throw into a terminal teardown path.
     */
    private _writeOutcomeWithBackfill(
        exerciseId: number,
        episodeId: string,
        outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED',
    ): void {
        this._dbg(`  -> OUTCOME ${outcome} write (episodeId=${episodeId})`);
        void this._deps.setEpisodeOutcome(exerciseId, episodeId, outcome)
            .then(({ applied }) => {
                if (!applied) {
                    this._setPendingOutcome(episodeId, { outcome });
                    this._dbg(`  -> back-fill: outcome=${outcome} deferred for episodeId=${episodeId} (row not yet created)`);
                }
            })
            .catch(() => { /* best-effort */ });
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
                this._deletePendingOutcome(episodeId);
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
