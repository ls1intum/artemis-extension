import type { Uri } from 'vscode';

import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import type { IrisChatMessage } from '@extension/types';

import { buildStruggleSignal } from './buildStruggleSignal';
import { decideOutcome } from './decideOutcome';
import type { InterventionEventLog, InterventionLogEvent } from './interventionEventLog';
import type { EpisodeHint, Level } from './slot/episode';
import { SlotManager } from './slot/slotManager';
import type { StruggleEgressResult, StruggleInterventionRequest, StruggleSignal } from './struggleContract';
import { templateForSignal } from './struggleTemplates';
import { TickRingBuffer } from './tickRingBuffer';

type SurfaceMeta = Pick<InterventionLogEvent, 'action' | 'finalAction' | 'surface' | 'source' | 'confidence'>;

const MAX_ACTIVE_PER_SESSION = 3;
const INFLIGHT_TIMEOUT_MS = 30_000;
/** Delay between reveal-persist retries. The server upsert is idempotent (A10), so retries are safe. */
const REVEAL_RETRY_MS = 5_000;

export interface StruggleInterventionDeps {
    isEgressEnabled(): boolean;
    /** True when a `.noai` marker file is present in the workspace → forces the deterministic no-AI path (spec §9). */
    hasNoaiMarker(): boolean;
    getExerciseId(): number | undefined;
    getExerciseRoot(): Uri | undefined;
    collectFiles(root: Uri | undefined): Promise<Record<string, string>>;
    postIntervention(exerciseId: number, body: StruggleInterventionRequest): Promise<StruggleEgressResult>;
    /** Open/attach the proactive session by id + reload its history so the bubble shows (spec §5.5 active). */
    openSession(sessionId: number): Promise<void>;
    /** opensChat: true → click focuses Iris chat (server hint); false → click shows the local template (no AI bounce). */
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
    /** Durable per-exercise student opt-out (spec §12.2): false → the orchestrator suppresses proactive for it. */
    isStudentProactiveOn(exerciseId: number): boolean;
    /** Reject-backoff thresholds (spec §5.2): annoyance owes a soft skip past `softThreshold`; `pauseStrikes`
     *  consecutive dismisses hard-pause proactive for the exercise. */
    softThreshold: number;
    pauseStrikes: number;
    setBadge(on: boolean): void;
    showActiveNotification(): void;
    /**
     * Post an optimistic proactive bubble to the open chat. When `messageId` is set, a later server
     * message with the same id deduplicates on the webview side (one bubble). When `messageId` is
     * null (server persist failed, A9), the bubble is runtime-only and carries no dedup tag.
     */
    postBubble(text: string, messageId: number | null): void;
    // ---- C2: reveal flow ----
    /** Generate a unique local id for an optimistic reveal bubble (injectable for deterministic tests). */
    generateLocalId(): string;
    /**
     * Post an optimistic reveal bubble with a string local id (C2 pull-reveal flow). The bubble
     * appears immediately in the chat with `sending` status; reconcileOptimisticBubble later
     * promotes it to `sent` with the real server id once the persist confirms.
     * Named distinctly from postBubble (numeric id) to avoid signature collision with the seam.
     */
    postRevealBubble(text: string, localId: string): void;
    /**
     * Reconcile the reveal bubble after server persist confirms the canonical row. Updates the bubble
     * that matched `localId` to the real server `id`, `proactiveEpisodeId`, and `sentAt` in-place
     * (no duplicate row, no orphan bubble). Mirror of the sendChatMessage optimistic-reconcile pattern.
     */
    reconcileOptimisticBubble(localId: string, serverId: number, proactiveEpisodeId: string | undefined, sentAt: string): void;
    /**
     * Reveal the hidden ambient hint by persisting it as a chat message in the proactive session (A10).
     * POST api/iris/chat/exercises/{exerciseId}/episodes/{episodeId}/reveal
     * Returns the persisted IrisChatMessage (id + proactiveEpisodeId + sentAt) for bubble reconcile.
     */
    revealAmbient(exerciseId: number, episodeId: string, hintText: string, level: Level, clientMessageId: string): Promise<IrisChatMessage>;
    /**
     * Record the student's terminal outcome for an episode-keyed proactive row (A10).
     * PUT api/iris/chat/exercises/{exerciseId}/episodes/{episodeId}/proactive-outcome
     * Returns { applied: boolean } — applied=false when the canonical row does not yet exist.
     * The back-fill loop in the orchestrator records pending outcomes and re-applies them once the row lands.
     */
    setEpisodeOutcome(exerciseId: number, episodeId: string, outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED'): Promise<{ applied: boolean }>;
    log: InterventionEventLog;
    setTimeoutFn?: (fn: () => void, ms: number) => void;
    /** Developer-mode diagnostic sink (gated upstream); no-op when omitted. Pure string out, no effects. */
    devLog?(msg: string): void;
}

/**
 * Orchestrates the proactive struggle intervention on the client (spec §4). Implements {@link AlertSink}, so
 * the coordinator's `enabled`/`showInterventions` gating AND its `reset()` on session change stay authoritative
 * (we do NOT subscribe the raw, ungated engine event). Ticks are fed via {@link onTick} (wired in extension.ts
 * from `coordinator.onDidTick`). vscode-free at runtime — only type imports; all effects injected.
 */
export class StruggleInterventionService implements AlertSink {
    private readonly _buffer = new TickRingBuffer(12);
    private _inFlight = false;
    private _inFlightGen = 0;
    private _activeCount = 0;
    private _serverAvailable = true;
    private _courseProactiveOff = false;
    private _pendingSignal: StruggleSignal | undefined;
    private _lastSurface: SurfaceMeta | undefined;
    private _lastSurfaceSignal: StruggleSignal | undefined;
    // Reject backoff (delivery-layer, spec §5.2). Only an explicit dismiss moves these; engagement/new exercise clear them.
    private _annoyance = 0;
    private _dismissStrikes = 0;
    private _softSkipBudget = 0;

    // C2: slot + frozen-hint state. Not marked private so tests can drive the slot and inspect state directly.
    readonly _slot = new SlotManager();
    /**
     * The proactive session id from the last inbound ambient event (spec §5, A9).
     * Stored here because the SlotManager does not hold session ids. Cleared on resetSession.
     * Used by revealParkedHint to open the right session and target the reveal endpoint.
     */
    _frozenSessionId: number | undefined;
    /**
     * Per-exercise pending terminal outcomes. Keyed by episodeId. Lives at the orchestrator level
     * so it survives a slot free (teardown). Populated when setEpisodeOutcome returns applied=false
     * (canonical row not yet created). Flushed when the reveal-persist retry creates the row.
     * Cleared on resetSession (new exercise = fresh state).
     */
    _pendingOutcomes = new Map<string, { sessionId: number; outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }>();

    constructor(private readonly _deps: StruggleInterventionDeps) {}

    private _surface(meta: SurfaceMeta, signal: StruggleSignal | undefined): void {
        this._lastSurface = meta;
        this._lastSurfaceSignal = signal;
        void this._deps.log.record({ ...meta, signal, studentOutcome: 'shown' });
    }

    /** Fed every engine tick (ungated buffer fill). Wired externally so we don't bypass coordinator gating. */
    onTick(tick: TickRecord): void {
        this._buffer.push(tick);
    }

    /** AlertSink.deliver — the coordinator calls this ONLY when `enabled && showInterventions`. */
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
        this._dbg(`  ↳ FALLBACK (no egress): local lamp template "${template}"`);
        this._deps.showAmbient(template, false);
        this._surface({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'template' }, signal);
    }

    /**
     * Pre-throttle suppression (the BackoffSource predicate {@link shouldSuppress} wraps this). An alert that will
     * NEVER surface, dropped ABOVE the throttle so it does not burn delivery budget. Three cases:
     *  - a non-edit (discrete, e.g. test-stagnation) alert — Phase 0: never produces a proactive surface;
     *  - the course-off latch (§13) — proactive disabled for this course this session;
     *  - the per-exercise student opt-out (§12.2; default-on, so an unset exercise is unaffected).
     * Returns the dev-log reason, or null when the alert may proceed.
     */
    private _suppressReason(alert: AlertRecord): string | null {
        if (alert.kind !== 'edit') {
            return `alert kind=${alert.kind} skipped (only edit-path alerts intervene)`;
        }
        if (this._courseProactiveOff) {
            return '  ↳ SKIP (course proactive disabled for this session)';
        }
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return '  ↳ SKIP (student turned proactive off for this exercise)';
        }
        return null;
    }

    /** BackoffSource: drop a suppressed alert above the throttle so it does not consume delivery budget. */
    shouldSuppress(alert: AlertRecord): boolean {
        return this._suppressReason(alert) !== null;
    }

    private async _handleAlert(alert: AlertRecord): Promise<void> {
        // Pre-throttle suppression (also enforced by BackoffGate above the throttle, so a suppressed alert never
        // burns delivery budget): non-edit / course-off / student-opt-out drop with no POST and no surface. Kept
        // here too as the backstop for the direct dev-force path, which calls deliver() and bypasses the gate.
        const suppressed = this._suppressReason(alert);
        if (suppressed !== null) {
            this._dbg(suppressed);
            return;
        }
        // Narrowing for the type system only: _suppressReason already dropped every non-edit alert above, so this
        // is unreachable at runtime — it tells TS that `alert` is the edit variant for buildStruggleSignal below.
        if (alert.kind !== 'edit') {
            return;
        }
        try {
            const signal = buildStruggleSignal(alert, this._buffer.snapshot());
            const optedIn = this._deps.isEgressEnabled();
            const hasExercise = this._deps.getExerciseId() !== undefined;
            const noaiMarker = this._deps.hasNoaiMarker();
            const outcome = decideOutcome({
                optedIn,
                inFlight: this._inFlight,
                hasExercise,
                noaiMarker,
                serverAvailable: this._serverAvailable,
            });
            this._dbg(`▶ ALERT t=${signal.alert.tSessionS}s boundary=${signal.alert.primaryBoundary} `
                + `severity=${signal.alert.severity.toFixed(2)} `
                + `top=[${signal.dominantComponents.map(c => `${c.name}=${c.value.toFixed(2)}`).join(', ')}] `
                + `→ decision=${outcome} `
                + `(egressOptIn=${optedIn}, hasExercise=${hasExercise}, noai=${noaiMarker}, serverUp=${this._serverAvailable}, inFlight=${this._inFlight})`);
            if (outcome === 'fallback') {
                this._fallback(signal);
                return;
            }
            if (outcome === 'skip') {
                this._dbg('  ↳ SKIP (no POST, no surface)');
                return;
            }
            const exerciseId = this._deps.getExerciseId() as number;
            // Claim the in-flight slot BEFORE the async file collection: a second alert arriving while
            // collectFiles() is still pending must see _inFlight=true and skip (close the TOCTOU race so the
            // client guard, like the server's authoritative single-flight, never double-POSTs).
            this._pendingSignal = signal;
            this._setInFlight(true);
            const uncommittedFiles = await this._deps.collectFiles(this._deps.getExerciseRoot());
            const paths = Object.keys(uncommittedFiles);
            const bytes = paths.reduce((n, p) => n + uncommittedFiles[p].length, 0);
            this._dbg(`  ↳ POST exercise=${exerciseId} → ${paths.length} file(s), ${bytes}B egress`
                + (paths.length ? `: [${paths.map(p => `${p} (${uncommittedFiles[p].length}B)`).join(', ')}]` : ''));
            await this._deps.log.record({ action: 'requested', finalAction: 'silent', surface: 'none', source: 'server', signal });
            const result = await this._deps.postIntervention(exerciseId, { struggleSignal: signal, uncommittedFiles });
            this._dbg(`  ↳ POST result: ${result}`);
            if (result === 'course-off') {
                // Deliberate instructor opt-out (§13): pause proactive for the session with NO fallback lamp, and
                // release the slot (there is no pending job). The latch keeps it paused even if the in-flight
                // watchdog later fires, and survives a settings-toggle reset(); resetSession() re-probes next exercise.
                this._dbg('  ↳ COURSE-OFF: proactive disabled for this course → pause session, no lamp');
                this._courseProactiveOff = true;
                this._setInFlight(false);
                return;
            }
            if (result === 'unavailable') {
                this._serverAvailable = false;
                this._setInFlight(false);
                this._fallback(signal);
            }
            if (result === 'failed') {
                // Transient 4xx/5xx/network (contract: treat as silent — no fallback lamp), but RELEASE the
                // in-flight slot now so the next alert can retry, instead of being skipped until the 30s watchdog.
                this._setInFlight(false);
            }
        }
        catch (err) {
            this._dbg(`  ↳ ERROR during intervention: ${err instanceof Error ? err.message : String(err)}`);
            this._setInFlight(false);
        }
    }

    /**
     * Inbound ambient event from the server (ambient is NOT capped, spec §10).
     * Ambient = PARKED pointer only (spec §5 pull model): badge + status-bar lamp + gutter icon
     * at the live anchor. NO inline text, NO toast, NO bubble. The hint text stays hidden until
     * the student clicks (reveal is C2). `messageId` is forwarded for future slot correlation (C3).
     * `sessionId` is stored as the frozen session id for the reveal flow (C2 spec §5).
     * C3 inbound routing (takeParked) is wired here in the next task; C2 only stores the session id.
     */
    onServerAmbient(hint: string, anchorFile: string | undefined, anchorLine: number | undefined, inlineHint: string | undefined, confidence?: number, messageId?: number | null, sessionId?: number): void {
        this._serverAvailable = true;
        this._setInFlight(false);
        // Store the frozen session id for the reveal flow (C2) before any early return.
        if (sessionId !== undefined) {
            this._frozenSessionId = sessionId;
        }
        // The student may have toggled proactive off for this exercise while this POST was in flight (spec §12.2):
        // drop the surface. The slot is already released above.
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return;
        }
        // Always show the badge and lamp (the two universal ambient pointers).
        this._deps.setBadge(true);
        this._deps.showLamp();
        // Also show the gutter icon when the anchor is live (an additional, anchor-specific pointer).
        if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
            this._deps.showGutterOnly(anchorFile, anchorLine);
        } else {
            this._deps.clearInline(); // clear any stale inline cue from a previous active episode
        }
        this._dbg(`  ↳ AMBIENT (PARKED) badge+lamp${anchorFile ? '+gutter' : ''} hint="${hint}" messageId=${messageId ?? 'none'}`);
        this._surface({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', confidence }, this._pendingSignal);
    }

    /**
     * Inbound `active` struggle event (per-user topic). Posts an optimistic bubble from the event
     * `message` text (tagged with `messageId` for webview-side dedup against the later chat-ws row;
     * null `messageId` = server persist failed (A9) = runtime-only fallback bubble). Then opens the
     * session, fires the toast notification + badge, and drops the inline breadcrumb at the live anchor
     * (spec §6.1). Hides the ambient lamp (the louder active surface supersedes it). CAPPED at
     * MAX active/session.
     */
    onServerActive(sessionId: number, anchorFile?: string, anchorLine?: number, inlineHint?: string, confidence?: number, message?: string, messageId?: number | null): void {
        this._serverAvailable = true;
        this._setInFlight(false);
        // Student opted out mid-flight (spec §12.2): drop the surface (slot already released).
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return;
        }
        if (this._activeCount >= MAX_ACTIVE_PER_SESSION) {
            this._deps.clearInline();   // capped → lamp only; no breadcrumb either
            this._dbg(`  ↳ ACTIVE session=${sessionId} CAPPED (${this._activeCount}/${MAX_ACTIVE_PER_SESSION} this session) → lamp only`);
            this._deps.showAmbient('Iris added a suggestion to the chat.', true);
            this._surface({ action: 'active', finalAction: 'ambient', surface: 'lamp', source: 'server', confidence }, this._pendingSignal);
            return;
        }
        this._activeCount += 1;
        this._dbg(`  ↳ ACTIVE → opening proactive session=${sessionId} (#${this._activeCount}/${MAX_ACTIVE_PER_SESSION}) messageId=${messageId ?? 'null'}`);
        // Post the optimistic bubble before opening the session so it appears immediately.
        // messageId=null means server persist failed (A9): still post a runtime-only fallback bubble.
        const bubbleText = message ?? 'Iris has a suggestion for you.';
        const bubbleId = messageId ?? null;
        this._deps.postBubble(bubbleText, bubbleId);
        void this._deps.openSession(sessionId);
        this._deps.setBadge(true);
        this._deps.showActiveNotification();
        // Active hides the parked ambient lamp (the louder active surface takes over).
        this._deps.clearLamp();
        // Spec §6.1: a localized active nudge ALSO leaves the inline breadcrumb at the live line; otherwise clear
        // any stale inline cue (the active surface supersedes a previous one).
        if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
            this._deps.showInline(anchorFile, anchorLine, inlineHint, message ?? inlineHint);
        } else {
            this._deps.clearInline();
        }
        this._surface({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', confidence }, this._pendingSignal);
    }

    /**
     * Apply an escalation (PARKED -> DELIVERED transition, driven by C3 slot reconcile).
     * Computes loudness from `inSession`: when the chat view is open (in-session), the escalation
     * drops quietly as a bubble with no toast or inline push; otherwise it fires the full active
     * surface (toast + inline). In both cases the optimistic bubble is posted with `messageId` for
     * webview-side dedup. This method does NOT touch the slot state (C3 owns that).
     */
    applyEscalation(
        inSession: boolean,
        hint: string,
        anchorFile: string | undefined,
        anchorLine: number | undefined,
        inlineHint: string | undefined,
        messageId: number | null,
    ): void {
        this._deps.postBubble(hint, messageId);
        if (inSession) {
            // Quiet: in-session bubble only (chat is open, no interruption needed).
            return;
        }
        // Out-of-session: full active push.
        this._deps.showActiveNotification();
        if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
            this._deps.showInline(anchorFile, anchorLine, inlineHint, hint);
        }
    }

    /**
     * A surfaced intervention was engaged (lamp click / toast action / inline command). Replays the LAST surfaced
     * metadata and feeds the reject backoff (dismiss escalates, click clears). Single-shot: the surface is
     * snapshotted and cleared synchronously up front, so a surface yields exactly one outcome and any
     * retriggered command or duplicate/stale callback on an already-consumed surface is a no-op (functional
     * backoff state, not just telemetry, now rides on this). NOTE (Slice 4b): the FIRST stale callback that
     * arrives after a later surface has overwritten `_lastSurface` is still misattributed to that newer surface;
     * closing that needs per-surface identity tokens, which Slice 4b introduces.
     */
    recordOutcome(outcome: 'clicked' | 'dismissed'): void {
        const surface = this._lastSurface;
        if (!surface) {
            return;
        }
        const signal = this._lastSurfaceSignal;
        this._lastSurface = undefined;
        this._lastSurfaceSignal = undefined;
        if (outcome === 'clicked') {
            this._annoyance = 0;
            this._dismissStrikes = 0;
            this._softSkipBudget = 0;
        }
        else {
            this._dismissStrikes += 1;
            this._annoyance += 2;
            if (this._annoyance >= this._deps.softThreshold) {
                this._softSkipBudget += 1;   // escalating: one more owed per dismiss past the threshold
            }
        }
        void this._deps.log.record({ ...surface, signal, studentOutcome: outcome });
    }

    /**
     * An explicit chat-bubble dismiss (spec §6.3). Unlike {@link recordOutcome}, this is NOT gated on a live
     * surface: a persisted bubble can be dismissed after a reload when `_lastSurface` is already cleared, and the
     * delivery backoff must still register it. Bumps the Slice-4a counters directly; eval-logs best-effort.
     */
    recordChatDismiss(): void {
        this._dismissStrikes += 1;
        this._annoyance += 2;
        if (this._annoyance >= this._deps.softThreshold) {
            this._softSkipBudget += 1;
        }
        if (this._lastSurface) {
            void this._deps.log.record({ ...this._lastSurface, signal: this._lastSurfaceSignal, studentOutcome: 'dismissed' });
        }
    }

    /** True while proactive is paused for this exercise (only an explicit dismiss can trigger this, spec §5.2). */
    isPaused(): boolean {
        return this._dismissStrikes >= this._deps.pauseStrikes;
    }

    /** True iff the delivery backoff is currently paused for the active exercise (drives the AskIris "Auto-paused" badge, §12.2). */
    isProactivePaused(exerciseId: number): boolean {
        return this._deps.getExerciseId() === exerciseId && this.isPaused();
    }

    /**
     * True iff proactive is running in a *degraded* mode (spec §14 cases 4-5): no proactive-egress consent
     * (local-template-only) OR a 404-latched server (no-AI lamp fallback). Drives the AskIris "Degraded" card.
     * Session-global (not exercise-scoped): both signals are per-session, like the course-off / 404 latches.
     * Distinct from "paused" (§5.2 backoff) and from the student/course "off" states.
     */
    isProactiveDegraded(): boolean {
        return !this._deps.isEgressEnabled() || !this._serverAvailable;
    }

    /** Clear the Slice-4a session backoff counters. Private: the public methods add the active-exercise guard. */
    private _clearBackoff(): void {
        this._dismissStrikes = 0;
        this._annoyance = 0;
        this._softSkipBudget = 0;
    }

    /** "Resume" action: clear the auto-pause backoff — but ONLY when the active session is the one being resumed. The
     *  backoff is session-scoped, so resuming exercise A while B is active must not clear B's backoff (codex review). */
    resumeProactive(exerciseId: number): void {
        if (this._deps.getExerciseId() !== exerciseId) {
            return;
        }
        this._clearBackoff();
    }

    /** Immediate effect of the AskIris On/Off switch. The durable preference is persisted by the caller; here we only
     *  touch the LIVE surfaces, and ONLY when the toggled exercise is the active one — a toggle on exercise A must not
     *  clear exercise B's lamp/inline/badge/backoff (codex review). Off clears the lamp, the inline cue (a proactive
     *  ambient can be an inline decoration) AND the badge; On clears any auto-pause. */
    setStudentProactive(exerciseId: number, on: boolean): void {
        if (this._deps.getExerciseId() !== exerciseId) {
            return;
        }
        if (on) {
            this._clearBackoff();
        }
        else {
            this._deps.clearLamp();
            this._deps.clearInline();
            this._deps.setBadge(false);
        }
    }

    /** Consume one owed soft skip; returns true if a skip was owed (caller drops the alert). */
    tryConsumeSoftSkip(): boolean {
        if (this._softSkipBudget > 0) {
            this._softSkipBudget -= 1;
            return true;
        }
        return false;
    }

    /**
     * AlertSink.reset — the coordinator's settings-toggle / context-clear path. Clears ALL surfaces (incl. the
     * lamp) + the in-flight slot, but DELIBERATELY KEEPS the per-session latches (404 / course-off) and the active
     * cap: a config-off→on toggle mid-session must not silently lift a latch or refill the cap. Those clear only on
     * {@link resetSession} (a new exercise).
     */
    reset(): void {
        this._buffer.clear();
        this._setInFlight(false);            // also invalidates any pending in-flight timeout (gen bump)
        this._pendingSignal = undefined;
        this._lastSurface = undefined;
        this._lastSurfaceSignal = undefined;
        this._deps.setBadge(false);
        this._deps.clearLamp();
        this._deps.clearInline();
    }

    /**
     * New-exercise reset: clear the per-exercise backoff AND the per-session latches (404 / course-off) + the
     * active cap, then the UI/session state. The plain {@link reset} (the coordinator's settings-toggle path)
     * deliberately KEEPS all of those so toggling interventions off/on cannot silently lift a pause earned by
     * repeated dismisses (spec §5.2), re-probe a latched-off server (§11), un-latch course-off (§13), or refill
     * the active cap.
     * Also frees the slot, clears the frozen session id, and clears pending outcomes (C2 — new exercise = clean state).
     */
    resetSession(): void {
        this._annoyance = 0;
        this._dismissStrikes = 0;
        this._softSkipBudget = 0;
        this._activeCount = 0;
        this._serverAvailable = true;        // re-probe the server next session: a 404 latch is per-session (spec §11)
        this._courseProactiveOff = false;    // course-off is also a per-session latch (spec §13): re-probe next exercise
        // C2: clean up the slot and frozen-hint state for the new exercise.
        if (!this._slot.isFree()) {
            this._slot.free();
        }
        this._frozenSessionId = undefined;
        this._pendingOutcomes.clear();
        this.reset();
    }

    // -------------------------------------------------------------------------
    // C2: reveal-on-click + episode-outcome back-fill
    // -------------------------------------------------------------------------

    /**
     * Reveal the parked ambient hint (spec §5.2 pull reveal). Called when the student clicks the lamp,
     * gutter icon, or badge. Transitions the slot PARKED -> DELIVERED (generation bump), opens the
     * proactive session, posts an optimistic bubble with a generated localId, and calls revealAmbient
     * to persist the canonical row. On persist success the bubble is reconciled (real id + proactiveEpisodeId
     * + sentAt). On failure the bubble stays runtime-only and a best-effort retry is scheduled with the
     * SAME localId (the server upsert is idempotent, A10 — the retry returns the same row). The slot is
     * NEVER reverted to PARKED: reveal is immediate, protection starts at show (spec §5.2).
     */
    async revealParkedHint(): Promise<void> {
        const snap = this._slot.snapshot();
        if (snap.state.kind !== 'parked') {
            return;
        }
        const { episode, frozenText } = snap.state;
        const episodeId = episode.episodeId;
        const sessionId = this._frozenSessionId;
        const exerciseId = this._deps.getExerciseId();
        if (sessionId === undefined || exerciseId === undefined) {
            this._dbg('revealParkedHint: missing sessionId or exerciseId — cannot reveal');
            return;
        }
        const localId = this._deps.generateLocalId();
        // Transition PARKED -> DELIVERED before the async persist. The reveal is immediate and is
        // never reverted: if the persist fails, the bubble stays runtime-only and the slot stays DELIVERED.
        const hint: EpisodeHint = { level: 'ambient', text: frozenText, atSessionS: 0 };
        this._slot.revealParked(hint);
        void this._deps.openSession(sessionId);
        this._deps.postRevealBubble(frozenText, localId);
        this._dbg(`  ↳ REVEAL click: episodeId=${episodeId} sessionId=${sessionId} localId=${localId}`);
        await this._persistReveal(exerciseId, episodeId, frozenText, 'ambient', localId);
    }

    /**
     * Record the student's terminal outcome for the active episode (spec §7.5, A10 episode-keyed endpoint).
     * If setEpisodeOutcome returns applied=false (the canonical reveal row does not yet exist), the outcome
     * is stored in _pendingOutcomes and flushed automatically once the reveal-persist retry creates the row.
     * This ensures an explicit DISMISSED or ABANDONED is never lost even when the student acts before the
     * network lag resolves. C5/C8 call this method; the back-fill loop is owned here (C2).
     */
    async applyEpisodeOutcome(
        episodeId: string,
        sessionId: number,
        outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED',
    ): Promise<void> {
        const exerciseId = this._deps.getExerciseId();
        if (exerciseId === undefined) {
            return;
        }
        const { applied } = await this._deps.setEpisodeOutcome(exerciseId, episodeId, outcome);
        if (!applied) {
            // No canonical row yet: defer until the reveal-persist retry creates it.
            this._pendingOutcomes.set(episodeId, { sessionId, outcome });
            this._dbg(`  ↳ back-fill: outcome=${outcome} deferred for episodeId=${episodeId} (row not yet created)`);
        }
    }

    /**
     * Persist the revealed hint as a canonical chat message row. On success, reconciles the optimistic bubble
     * and flushes any pending terminal outcome recorded while the row did not yet exist. On failure, schedules
     * a best-effort retry with the SAME localId (server upsert is idempotent, A10).
     */
    private async _persistReveal(
        exerciseId: number,
        episodeId: string,
        hintText: string,
        level: Level,
        localId: string,
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
            this._dbg(`  ↳ reveal persisted: serverId=${serverId} proactiveEpisodeId=${proactiveEpisodeId ?? 'none'}`);
            // Flush any pending terminal outcome that was recorded before the canonical row existed.
            const pending = this._pendingOutcomes.get(episodeId);
            if (pending) {
                this._pendingOutcomes.delete(episodeId);
                this._dbg(`  ↳ back-fill flush: outcome=${pending.outcome} for episodeId=${episodeId}`);
                try {
                    await this._deps.setEpisodeOutcome(exerciseId, episodeId, pending.outcome);
                } catch (flushErr) {
                    // Best-effort: the flush failure is logged and swallowed. The outcome is lost only
                    // in this case (spec §12 attrition — the genuinely unrecoverable scenario).
                    this._dbg(`  ↳ back-fill flush failed (best-effort): ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
                }
            }
        } catch (err) {
            this._dbg(`  ↳ reveal persist failed, scheduling retry in ${REVEAL_RETRY_MS}ms: ${err instanceof Error ? err.message : String(err)}`);
            const schedule = this._deps.setTimeoutFn ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
            schedule(() => {
                void this._persistReveal(exerciseId, episodeId, hintText, level, localId);
            }, REVEAL_RETRY_MS);
        }
    }

    private _setInFlight(on: boolean): void {
        this._inFlight = on;
        // Version the in-flight window so a stale 30s timeout from a PRIOR request cannot clear the flag of a
        // newer one (the same marker-release race fixed server-side). Any transition bumps the generation;
        // a scheduled timeout only clears if its generation is still current.
        const gen = ++this._inFlightGen;
        if (on) {
            const schedule = this._deps.setTimeoutFn ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
            schedule(() => { if (this._inFlightGen === gen) { this._inFlight = false; } }, INFLIGHT_TIMEOUT_MS);
        }
    }
}
