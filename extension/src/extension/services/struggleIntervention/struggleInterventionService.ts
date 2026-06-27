import type { Uri } from 'vscode';

import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';

import { buildStruggleSignal } from './buildStruggleSignal';
import { decideOutcome } from './decideOutcome';
import type { InterventionEventLog, InterventionLogEvent } from './interventionEventLog';
import type { StruggleEgressResult, StruggleInterventionRequest, StruggleSignal } from './struggleContract';
import { templateForSignal } from './struggleTemplates';
import { TickRingBuffer } from './tickRingBuffer';

type SurfaceMeta = Pick<InterventionLogEvent, 'action' | 'finalAction' | 'surface' | 'source' | 'confidence'>;

const MAX_ACTIVE_PER_SESSION = 3;
const INFLIGHT_TIMEOUT_MS = 30_000;

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
    /** Hide the status-bar lamp (called on session/context reset so stale hints do not survive). */
    clearLamp(): void;
    /** Render the inline in-editor cue (gutter logo + after-line hint + hover) at the live anchor (spec §4.1). */
    showInline(anchorFile: string, anchorLine: number, inlineHint: string, message: string): void;
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

    private async _handleAlert(alert: AlertRecord): Promise<void> {
        // Phase 0: only edit-path alerts produce a proactive intervention. Discrete
        // add-on alerts (e.g. test-stagnation) are fully skipped here: no POST, no
        // wire signal, no local fallback surface.
        if (alert.kind !== 'edit') {
            this._dbg(`alert kind=${alert.kind} skipped (only edit-path alerts intervene)`);
            return;
        }
        // Proactive is off for this course (§13): pause for the session — no POST, no surface, no lamp. Cleared on
        // reset() (next exercise re-probes), like the 404 latch.
        if (this._courseProactiveOff) {
            this._dbg('  ↳ SKIP (course proactive disabled for this session)');
            return;
        }
        // Student turned proactive off for this exercise (spec §12.2): no POST, no surface. Default-on, so an unset
        // exercise is unaffected.
        const studentExerciseId = this._deps.getExerciseId();
        if (studentExerciseId !== undefined && !this._deps.isStudentProactiveOn(studentExerciseId)) {
            this._dbg('  ↳ SKIP (student turned proactive off for this exercise)');
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
                // watchdog later fires; reset() re-probes next exercise.
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
        }
        catch (err) {
            this._dbg(`  ↳ ERROR during intervention: ${err instanceof Error ? err.message : String(err)}`);
            this._setInFlight(false);
        }
    }

    /**
     * Inbound ambient event from the server (ambient is NOT capped — spec §10). Renders the inline in-editor cue
     * when the gate localized the nudge to a line that is currently live on screen (spec §4); otherwise the lamp.
     */
    onServerAmbient(hint: string, anchorFile: string | undefined, anchorLine: number | undefined, inlineHint: string | undefined, confidence?: number): void {
        this._serverAvailable = true;
        this._setInFlight(false);
        // The student may have toggled proactive off for this exercise while this POST was in flight (spec §12.2):
        // drop the surface. The slot is already released above.
        const exId = this._deps.getExerciseId();
        if (exId !== undefined && !this._deps.isStudentProactiveOn(exId)) {
            return;
        }
        if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
            this._deps.clearLamp();   // exclusive surface: an inline cue supersedes any standing lamp
            this._deps.showInline(anchorFile, anchorLine, inlineHint, hint);
            this._surface({ action: 'ambient', finalAction: 'ambient', surface: 'inline', source: 'server', confidence }, this._pendingSignal);
            return;
        }
        this._deps.clearInline();     // exclusive surface: the lamp supersedes any standing inline cue
        this._deps.showAmbient(hint, true);
        this._surface({ action: 'ambient', finalAction: 'ambient', surface: 'lamp', source: 'server', confidence }, this._pendingSignal);
    }

    /**
     * Inbound `active` struggle event (per-user topic). Open/attach + fetch the session so the persisted bubble
     * shows regardless of websocket timing; add the intrusive notification + badge, CAPPED at MAX active/session.
     * Per spec §6.1, when the gate localized the nudge to a live line the active path ALSO drops the inline
     * breadcrumb there, so a missed (auto-dismissing) toast still leaves a contextual pointer at the code.
     */
    onServerActive(sessionId: number, anchorFile?: string, anchorLine?: number, inlineHint?: string, confidence?: number): void {
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
        this._dbg(`  ↳ ACTIVE → opening proactive session=${sessionId} (#${this._activeCount}/${MAX_ACTIVE_PER_SESSION})`);
        void this._deps.openSession(sessionId);
        this._deps.setBadge(true);
        this._deps.showActiveNotification();
        // Spec §6.1: a localized active nudge ALSO leaves the inline breadcrumb at the live line; otherwise clear
        // any stale inline cue (the active surface supersedes a previous one).
        if (anchorFile && anchorLine !== undefined && inlineHint && this._deps.isAnchorLive(anchorFile, anchorLine)) {
            this._deps.clearLamp();   // exclusive surface: the inline breadcrumb supersedes any standing lamp (mirrors onServerAmbient)
            this._deps.showInline(anchorFile, anchorLine, inlineHint, inlineHint);
        } else {
            this._deps.clearInline();
        }
        this._surface({ action: 'active', finalAction: 'active', surface: 'bubble', source: 'server', confidence }, this._pendingSignal);
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

    /** AlertSink.reset — the coordinator calls this on session/context change. Clears ALL surfaces (incl. the lamp). */
    reset(): void {
        this._buffer.clear();
        this._setInFlight(false);            // also invalidates any pending in-flight timeout (gen bump)
        this._activeCount = 0;
        this._serverAvailable = true;        // re-probe the server next session: a 404 latch is per-session (spec §11)
        this._courseProactiveOff = false;    // course-off is also a per-session latch (spec §13): re-probe next exercise
        this._pendingSignal = undefined;
        this._lastSurface = undefined;
        this._lastSurfaceSignal = undefined;
        this._deps.setBadge(false);
        this._deps.clearLamp();
        this._deps.clearInline();
    }

    /**
     * New-exercise reset: clear the per-exercise backoff, then the UI/session state. The plain {@link reset} (the
     * coordinator's settings-toggle path) deliberately KEEPS the backoff so toggling interventions off/on cannot
     * silently lift a pause earned by repeated dismisses (spec §5.2).
     */
    resetSession(): void {
        this._annoyance = 0;
        this._dismissStrikes = 0;
        this._softSkipBudget = 0;
        this.reset();
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
