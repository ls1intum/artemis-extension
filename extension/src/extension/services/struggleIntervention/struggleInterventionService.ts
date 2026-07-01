import type { Uri } from 'vscode';

import type { EpisodeHistoryEntry, EpisodeOutcomeLabel, SlotDebugSnapshot } from '@shared/messageContracts';

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
import { DeadlineLatch, InFlightGuard } from './slot/guard';
import type { ProgressCloseCfg } from './slot/progressClose';
import { ProgressCloseLatch } from './slot/progressClose';
import type { ReconcileAction } from './slot/reconcile';
import { reconcile } from './slot/reconcile';
import { routeReply } from './slot/replyRouting';
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
const NON_RETRIABLE_REVEAL_STATUSES = new Set([400, 403, 404, 422]);

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
    foldEpisode(
        episodeId: string,
        outcome: 'RECOVERED' | 'DISMISSED' | 'ABANDONED',
        praise?: { episodeLabel: string; closeMessageId: number },
    ): void;
    // ---- C4: stale-row suppression + stale-ask ----
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
    /**
     * Post host->webview addStaleAsk{episodeId, askId, messageId, question} (C5 renders the
     * quick-reply buttons; C4 mints the askId and binds it to the event's messageId).
     */
    postStaleAsk(episodeId: string, askId: string, messageId: number, question: string): void;
    log: InterventionEventLog;
    setTimeoutFn?: (fn: () => void, ms: number) => void;
    /** Developer-mode diagnostic sink (gated upstream); no-op when omitted. Pure string out, no effects. */
    devLog?(msg: string): void;
    /** Debug-only slot-state change sink (gated upstream); no-op when omitted. Best-effort, must not throw into a slot path. */
    onSlotChange?(): void;
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
    // C5: ABANDON timer defaults (mirrors TUNING.slot; injected so tests can override)
    abandonInitialMs: 60_000,
    abandonFreeTextMs: 30_000,
    abandonCeilingMs: 300_000,
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

    // C5: monotonic abandon-timer for the live stale-ask (re-armed per ask, neutralised on clearEpisodeRuntime)
    readonly _deadlineLatch = new DeadlineLatch();

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
    _pendingOutcomes = new Map<string, { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }>();

    // ---------------------------------------------------------------------------
    // Task 3: episode history ring buffer + slot-change notify
    // ---------------------------------------------------------------------------

    private _episodeHistory: EpisodeHistoryEntry[] = [];
    private static readonly HISTORY_CAP = 20;
    private _slotChangeScheduled = false;

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
            isNew: episode?.isNew ?? false,
            inSession: snap.inSession,
            watchdog: {
                armed: this._watchdog?.isArmed() ?? false,
                staleDeadlineMs: this._watchdog?.staleDeadlineMs() ?? null,
            },
            abandon: {
                armed: this._liveAskBinding !== undefined,
                deadlineMs: this._liveAskBinding !== undefined ? this._deadlineLatch.current() : null,
            },
            inFlight: m
                ? { intent: m.intent, localToken: m.localToken, episodeId: m.episodeId, generation: m.generation, requestToken: m.requestToken }
                : null,
            owed: { confirmClose: this._owedConfirmClose !== undefined, staleCheck: this._owedStaleCheck },
            pendingOutcomes: this._pendingOutcomes.size,
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

    /** Coalesced, best-effort debug notification (one push per sync mutation branch). */
    private notifySlotDebugChanged(): void {
        if (!this._deps.onSlotChange || this._slotChangeScheduled) { return; }
        this._slotChangeScheduled = true;
        queueMicrotask(() => {
            this._slotChangeScheduled = false;
            try { this._deps.onSlotChange?.(); } catch { /* best-effort: debug push must never break the feature */ }
        });
    }

    // ---------------------------------------------------------------------------
    // Notifying setters (complete-by-construction notify coverage)
    // ---------------------------------------------------------------------------

    private _setInFlightMarker(v: InFlightMarker | undefined): void { this._inFlightMarker = v; this.notifySlotDebugChanged(); }
    private _setOwedConfirmClose(v: OwedConfirmClose | undefined): void { this._owedConfirmClose = v; this.notifySlotDebugChanged(); }
    private _setOwedStaleCheck(v: boolean): void { this._owedStaleCheck = v; this.notifySlotDebugChanged(); }
    private _setLiveAskBinding(v: LiveAskBinding | undefined): void { this._liveAskBinding = v; this.notifySlotDebugChanged(); }
    private _setPendingOutcome(episodeId: string, outcome: { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }): void { this._pendingOutcomes.set(episodeId, outcome); this.notifySlotDebugChanged(); }
    private _deletePendingOutcome(episodeId: string): void { this._pendingOutcomes.delete(episodeId); this.notifySlotDebugChanged(); }
    private _clearPendingOutcomes(): void { this._pendingOutcomes.clear(); this.notifySlotDebugChanged(); }

    // ---------------------------------------------------------------------------
    // AlertSink
    // ---------------------------------------------------------------------------

    /** Fed every engine tick (ungated buffer fill). Wired externally so we don't bypass coordinator gating. */
    onTick(tick: TickRecord): void {
        this._buffer.push(tick);
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
            this._setInFlightMarker({ requestToken, episodeId: requestEpisode.episodeId, generation: snap.generation, intent: 'decide', localToken });

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
                this._setInFlightMarker(undefined);
                this._candidate = undefined;
            } else if (result === 'unavailable') {
                this._serverAvailable = false;
                this._setInFlightMarker(undefined);
                this._candidate = undefined;
                this._fallback(signal);
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
     * C4: accepts `episodeId` echo (stale-drop if mismatch) and `messageId` for stale-row suppression.
     */
    onServerSilent(episodeId: string | undefined, messageId: number | undefined): void {
        this._serverAvailable = true;

        // C4 echo check: verify the wire's episodeId matches what was requested.
        // Do this BEFORE _acceptDecide so a mismatch does NOT consume the in-flight marker
        // (the real reply for this episode may still arrive).
        const expectedEpisodeId = this._inFlightMarker?.episodeId;
        if (expectedEpisodeId === undefined || episodeId !== expectedEpisodeId) {
            if (messageId !== undefined) { this._dropStaleRow(messageId); }
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
        this._serverAvailable = true;

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

            // Handle queued stale_solved that arrived while this confirmClose was in flight:
            // slot-free clears it (one CLOSE total)
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

    /**
     * Inbound staleCheck response from the server (C4 dispatch).
     * `ask=true`: a question row was persisted -- mint a runtime askId, bind it to messageId,
     * and post addStaleAsk so the webview attaches buttons to the row.
     * `ask=false`: noop (do NOT consume staleAskCount; watchdog may re-check).
     */
    onServerStale(
        episodeId: string | undefined,
        ask: boolean,
        messageId: number | undefined,
        question: string | undefined,
    ): void {
        this._serverAvailable = true;

        // C4 echo check: must be a stale_check in-flight for the right episode.
        const expectedEpisodeId = this._inFlightMarker?.episodeId;
        if (this._inFlightMarker?.intent !== 'stale_check' || expectedEpisodeId === undefined || episodeId !== expectedEpisodeId) {
            if (messageId !== undefined) { this._dropStaleRow(messageId); }
            return;
        }

        // Clear the in-flight staleCheck marker
        this._setInFlightMarker(undefined);

        if (ask && this._watchdog && messageId !== undefined && question !== undefined) {
            this._dbg(`  -> STALE ask=true: post question + arm ABANDON (episodeId=${episodeId ?? 'n/a'})`);
            // Mint a runtime askId and bind it to the persisted row
            const askId = this._deps.generateLocalId();
            const latchedEpisodeId = episodeId!;
            this._setLiveAskBinding({ askId, messageId, episodeId: latchedEpisodeId });
            this._watchdog.onAskPosted();
            this._deps.postStaleAsk(latchedEpisodeId, askId, messageId, question);
            // C5: arm the ABANDON latch and schedule the initial per-ask timeout
            const now = Date.now();
            const cfg = this._deps.slotCfg ?? DEFAULT_SLOT_CFG;
            const abandonInitialMs = cfg.abandonInitialMs ?? 60_000;
            const abandonCeilingMs = cfg.abandonCeilingMs ?? 300_000;
            const deadline = this._deadlineLatch.arm(now, abandonInitialMs, abandonCeilingMs);
            this._scheduleAbandon(deadline, latchedEpisodeId, now);
        }
        // ask=false: do NOT call onAskPosted (watchdog may re-check)

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
                this._dbg(`  -> TAKE-DELIVERED bubble hint="${text}"`);
                this._candidate = undefined;
                this._watchdog = new StaleWatchdog(this._deps.slotCfg ?? DEFAULT_SLOT_CFG);
                this._watchdog.arm(now, false /* delivered */);
                this._latch.reset();
                this._applyActiveSurface(text, messageId, anchorFile, anchorLine, inlineHint, sessionId);
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
                this._applyActiveSurface(text, messageId, anchorFile, anchorLine, inlineHint, sessionId);
                void this._deps.log.record({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', signal: this._lastSignal, confidence });
                break;
            }

            case 'escalate': {
                // DELIVERED ambient + hardEvent: escalate to active (same episode)
                this._slot.escalate(hint);
                this._dbg(`  -> ESCALATE ambient->active hint="${text}"`);
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
            case 'fire-stale-check': {
                // Window already incremented inside tick() (wire-independent)
                if (this._watchdog.canPostAsk() && !this._liveAskBinding) {
                    this._setOwedStaleCheck(true);
                }
                // _drainOwed() is called after onTick returns
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
            this._setOwedConfirmClose({ confirmReason: 'progress' });
        } else if (kind === 'parked') {
            this._setOwedConfirmClose({ confirmReason: 'parked_progress' });
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

        // Priority 2: owed staleCheck
        if (this._owedStaleCheck && !this._liveAskBinding) {
            const epState2 = snap.state;
            const ep = epState2.kind === 'delivered' ? epState2.episode : null;
            if (!ep) { this._setOwedStaleCheck(false); return; }

            const requestToken = crypto.randomUUID();
            const requestEpisode = {
                episodeId: ep.episodeId,
                isNew: !this._continuedEpisodeIds.has(ep.episodeId),
                hints: ep.hints,
            };
            const stamp: PendingStamp = { episodeId: ep.episodeId, generation: snap.generation, hardEvent: false, requestToken };
            const localToken = this._guard.issue('stale_check', stamp);
            this._setInFlightMarker({ requestToken, episodeId: ep.episodeId, generation: snap.generation, intent: 'stale_check', localToken });

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
                    this._setOwedStaleCheck(false);
                } else {
                    this._setInFlightMarker(undefined);
                }
            } catch {
                this._setInFlightMarker(undefined);
            }
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
     * Clears the episode-scoped inline cue too: the after-line hint (DELIVERED) or gutter pointer
     * (PARKED) belongs to the episode, so every terminal exit (RECOVERED close, watchdog/ABANDON
     * force-free, dismiss, stale-ask "something-else", new-exercise) retires it here in one place.
     * Previously this relied on the student's next file edit firing the decoration's own edit
     * listener, which left a stale cue when the episode resolved without an edit (e.g. solved in chat).
     */
    private _clearEpisodeRuntime(): void {
        this._deps.clearInline();
        this._latch.reset();
        this._watchdog?.disarm();
        this._watchdog = undefined;
        this._setOwedConfirmClose(undefined);
        this._setOwedStaleCheck(false);
        // Cancel any in-flight staleCheck (guard cancel, not scoped-cancel -- the job was cleared on guard)
        this._guard.cancel('stale_check');
        // Clear the live-ask binding: neutralises any pending ABANDON setTimeout
        this._setLiveAskBinding(undefined);
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
        this.notifySlotDebugChanged();
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

    /**
     * C8: Episode-scoped dismiss. Called by the card Dismiss button (via the provider callback
     * seam) and by the active-toast "Not now" action (via the telemetry closure).
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
     *
     * Backoff is NOT bumped here. Callers handle it to avoid double-counting:
     *   Card: _onDidDismissProactive.fire() -> recordProactiveDismiss() -> recordChatDismiss()
     *   Toast: recordOutcome('dismissed') kept alongside in the telemetry seam closure.
     */
    public dismissEpisode(episodeId?: string): void {
        const snapState = this._slot.snapshot().state;
        const liveEpisodeId = snapState.kind === 'delivered' ? snapState.episode.episodeId : undefined;
        const exerciseId = this._deps.getExerciseId();
        this._dbg(`  -> DISMISS episode=${episodeId ?? liveEpisodeId ?? 'n/a'} (slot=${snapState.kind})`);

        // Determine the target for the outcome write (passed arg wins; fall back to live)
        const targetEpisodeId = episodeId ?? liveEpisodeId;

        // Free the slot only if DELIVERED and the passed id matches (or none passed)
        const matchesLive = episodeId === undefined || episodeId === liveEpisodeId;
        const shouldFreeSlot = snapState.kind === 'delivered' && matchesLive;

        if (shouldFreeSlot) {
            // Full DELIVERED resolution: free + runtime teardown + outcome + fold (no praise)
            this.recordTerminalEpisode((snapState as Extract<typeof snapState, { kind: 'delivered' }>).episode, 'DISMISSED');
            this._slot.free();
            this._clearEpisodeRuntime();
            if (targetEpisodeId && exerciseId !== undefined) {
                this._writeOutcomeWithBackfill(exerciseId, targetEpisodeId, 'DISMISSED');
                this._deps.foldEpisode(targetEpisodeId, 'DISMISSED');
            }
        } else if (targetEpisodeId && exerciseId !== undefined) {
            // Slot already FREE, PARKED, or episodeId mismatch: idempotent outcome write only.
            this._writeOutcomeWithBackfill(exerciseId, targetEpisodeId, 'DISMISSED');
        }
    }

    /**
     * C8 stub: the student clicked "I solved this" on a stale-ask or a delivered hint.
     * Queues a `stale_solved` confirmClose (overrides any pending progress close -- one CLOSE
     * total per episode). NON-terminal on its own; a server confirmClose reply frees the slot.
     * C8 will wire this to the webview "solved" command; callable directly in tests.
     */
    recordSolvedClick(): void {
        const snap = this._slot.snapshot();
        if (snap.state.kind === 'free') { return; }
        this._dbg('  -> SOLVED click: queue stale_solved close');
        this._setOwedConfirmClose({ confirmReason: 'stale_solved' });
        void this._drainOwed();
    }

    // ---------------------------------------------------------------------------
    // C5: stale-ask reply routing (button clicks + free-text grace hook)
    // ---------------------------------------------------------------------------

    /**
     * Cancel an in-flight staleCheck (guard cancel + scoped server cancel + clear marker).
     * Called when a button resolves the ask so no second question can post.
     */
    private _cancelStaleCheckInFlight(): void {
        this._guard.cancel('stale_check');
        this._setOwedStaleCheck(false);
        if (this._inFlightMarker?.intent === 'stale_check') {
            const exerciseId = this._deps.getExerciseId();
            if (exerciseId !== undefined) {
                void this._deps.cancelOutstandingStruggleJob(exerciseId, this._inFlightMarker.requestToken).catch(() => { /* best-effort */ });
            }
            this._setInFlightMarker(undefined);
        }
    }

    /**
     * Schedule an ABANDON timeout for the current stale-ask.
     * The callback is guarded by `isCurrent(capturedDeadline)` (superseded timers are no-ops)
     * AND `_liveAskBinding.episodeId === episodeId` (freed slot = no-op).
     */
    private _scheduleAbandon(deadline: number, episodeId: string, fromNow: number): void {
        const schedule = this._deps.setTimeoutFn ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
        const capturedDeadline = deadline;
        const delayMs = Math.max(0, deadline - fromNow);
        schedule(() => {
            if (!this._deadlineLatch.isCurrent(capturedDeadline)) { return; }
            if (!this._liveAskBinding || this._liveAskBinding.episodeId !== episodeId) { return; }
            // ABANDON teardown -- same path as the watchdog force-free
            this._dbg(`  -> ABANDON fired (episodeId=${episodeId}) -> FREE + ABANDONED`);
            const exerciseId = this._deps.getExerciseId();
            const snap = this._slot.snapshot();
            const deliveredEp = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
            const epId = deliveredEp?.episodeId ?? episodeId;
            if (deliveredEp) { this.recordTerminalEpisode(deliveredEp, 'ABANDONED'); }
            this._slot.free();
            this._clearEpisodeRuntime();
            if (exerciseId !== undefined) {
                this._writeOutcomeWithBackfill(exerciseId, epId, 'ABANDONED');
                this._deps.foldEpisode(epId, 'ABANDONED');
            }
        }, delayMs);
    }

    /**
     * C5: Route a stale-ask quick-reply button click.
     * - solved: queues a `stale_solved` confirmClose, cancels any in-flight staleCheck, closes the ask.
     * - still-on-it: cancels staleCheck, closes the ask, resets watchdog progress window.
     * - something-else: frees the slot silently (ABANDONED) + `setEpisodeOutcome(ABANDONED)`.
     * - stale or absent askId: no-op.
     */
    public onStaleAskButton(askId: string, button: 'solved' | 'still-on-it' | 'something-else'): void {
        const askOpen = this._liveAskBinding !== undefined;
        const liveAskId = this._liveAskBinding?.askId ?? null;
        const effect = routeReply({ kind: 'button', button, askId }, askOpen, liveAskId);
        const now = Date.now();
        this._dbg(`  -> STALE-ASK button="${button}" -> ${effect.kind}`);

        switch (effect.kind) {
            case 'confirm-close': {
                // Queue a stale_solved close (overrides any pending progress close -- one CLOSE total per episode).
                // Existing drain/clear in onServerClose handles the "already in-flight confirm_close" queuing rule.
                this._setOwedConfirmClose({ confirmReason: 'stale_solved' });
                this._cancelStaleCheckInFlight();
                // Clear the ask binding so the ABANDON latch neutralises on next fire
                this._setLiveAskBinding(undefined);
                void this._drainOwed();
                break;
            }
            case 'stay': {
                this._cancelStaleCheckInFlight();
                this._setLiveAskBinding(undefined);
                // Fresh stale window -- the watchdog will re-fire and may post ask#2
                this._watchdog?.resetProgress(now);
                break;
            }
            case 'free-silent': {
                // Something-else: abandon silently (student chose a different path)
                const snap = this._slot.snapshot();
                const deliveredEp = snap.state.kind === 'delivered' ? snap.state.episode : undefined;
                const episodeId = deliveredEp?.episodeId;
                const exerciseId = this._deps.getExerciseId();
                if (deliveredEp) { this.recordTerminalEpisode(deliveredEp, 'ABANDONED'); }
                this._slot.free();
                this._clearEpisodeRuntime();
                if (episodeId && exerciseId !== undefined) {
                    this._writeOutcomeWithBackfill(exerciseId, episodeId, 'ABANDONED');
                    this._deps.foldEpisode(episodeId, 'ABANDONED');
                }
                break;
            }
            default:
                // 'none': stale/absent askId -- no-op
                // 'reset-abandon-timer': only returned for free-text, not buttons
                break;
        }
    }

    /**
     * C5: Free-text grace hook. Call immediately before a chat POST when a stale ask is open.
     * Advances the ABANDON timer (provisional) so a slow network does not fire ABANDON mid-engagement.
     * On a hard POST failure the caller must call the returned `revoke()` to roll back the advance.
     * Returns `undefined` when no stale ask is open (no-op path for the caller).
     */
    public onFreeTextReply(): { revoke: () => void } | undefined {
        const askOpen = this._liveAskBinding !== undefined;
        const liveAskId = this._liveAskBinding?.askId ?? null;
        const effect = routeReply({ kind: 'free-text', text: '' }, askOpen, liveAskId);

        if (effect.kind !== 'reset-abandon-timer') {
            return undefined;
        }

        // Capture current deadline before advance so we can roll back on POST failure
        const prev = this._deadlineLatch.current();
        const now = Date.now();
        const cfg = this._deps.slotCfg ?? DEFAULT_SLOT_CFG;
        const abandonFreeTextMs = cfg.abandonFreeTextMs ?? 30_000;
        const newDeadline = this._deadlineLatch.advance(now, abandonFreeTextMs);
        const liveAskEpisodeId = this._liveAskBinding!.episodeId;
        this._scheduleAbandon(newDeadline, liveAskEpisodeId, now);
        this._dbg(`  -> FREE-TEXT grace: ABANDON advanced (episodeId=${liveAskEpisodeId})`);
        this.notifySlotDebugChanged();

        return {
            revoke: () => {
                this._deadlineLatch.restore(prev);
                // Reschedule for the restored deadline (supersedes the advance timer via isCurrent)
                this._scheduleAbandon(prev, liveAskEpisodeId, Date.now());
                this.notifySlotDebugChanged();
            },
        };
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
        this._setInFlightMarker(undefined);
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
