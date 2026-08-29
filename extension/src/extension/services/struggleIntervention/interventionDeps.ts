import type { Uri } from 'vscode';

import type { ProactiveLevel } from '@shared/messageContracts';

import type { IrisChatMessage } from '@extension/types';

import type { InterventionEventLog } from './interventionEventLog';
import type { Level } from './slot/episode';
import type { ProgressCloseCfg } from './slot/progressClose';
import type { StaleConfig } from './slot/staleWatchdog';
import type { StruggleEgressResult, StruggleInterventionRequest } from './struggleContract';

/**
 * The orchestrator's injected surface and its private wire bookkeeping.
 *
 * Split out of `struggleInterventionService.ts` verbatim: the deps interface is
 * the whole boundary between the orchestrator and the rest of the extension, and
 * at ~150 lines of contract it crowded out the state machine it belongs to. No
 * member changed. `StruggleInterventionDeps` is re-exported from the service so
 * existing importers (five test suites among them) keep their import path.
 */

/** The in-flight marker tracks the outstanding struggle POST (single-outstanding). */
export interface InFlightMarker {
    requestToken: string;
    episodeId: string;
    generation: number;
    intent: 'decide' | 'confirm_close' | 'help_request';
    /** Local token from InFlightGuard.issue() for accept() call. */
    localToken: number;
    /** The exercise that owns this in-flight request, so a teardown after an exercise switch cancels the
     *  job under the OWNING exercise rather than getExerciseId() (which is the newly-opened one). (#350) */
    exerciseId?: number;
    /**
     * The exact working-copy snapshot (`uncommittedFiles`) this decide POST sent, keyed by the same
     * path the server anchors against. Used at delivery to rebase the server anchor line onto the
     * live buffer (the coord system it was picked in). Set after collectFiles; dropped with the
     * marker. Only decide POSTs carry an anchor reply, so confirm_close leaves it undefined.
     */
    baseline?: Record<string, string>;
}

/** A queued confirmClose reason waiting to be POSTed. */
export interface OwedConfirmClose {
    confirmReason: 'progress' | 'parked_progress';
}

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
    /**
     * Opens (or attaches to) a proactive conversation and reloads its history, so the bubble shows
     * (spec §5.5 active). Carries the course as well as the session because the server API scopes
     * session lookup by course, and nothing here establishes that a proactive session id is
     * globally unique or belongs to the course currently on screen.
     */
    openSession(courseId: number, sessionId: number): Promise<void>;
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
    /** Durable single student opt-out (spec §12.2, issue #341): false -> the orchestrator suppresses proactive. */
    isStudentProactiveOn(): boolean;
    /**
     * The single proactive-help level (Off/Less/More, spec §12.2, issue #341). Used by the client-side Pull
     * re-route: an inbound `active` event while the level is `less` is downgraded to the ambient/PARKED path.
     */
    getProactiveLevel(): ProactiveLevel;
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
     * Mirror "a hint the student asked for is being prepared" into the chat, so an accepted offer
     * gets feedback during the seconds the round trip takes. Derived from the in-flight marker, see
     * `StruggleInterventionService._syncHelpPending`. Optional: the chat provider is constructed
     * after the engine, and the engine is fully usable without a chat.
     */
    setProactiveThinking?(on: boolean): void;
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
    /** Reconcile the reveal bubble after server persist confirms the canonical row. */
    reconcileOptimisticBubble(localId: string, serverId: number, proactiveEpisodeId: string | undefined, sentAt: string): void;
    /**
     * Resolve the owning course + display title of a parked hint's exercise (#364 spec C).
     * Synchronous local lookup; undefined when the exercise is untracked, or the tracked entry
     * lacks a courseId (optional) or a title, so the reveal aborts cleanly before any transition.
     */
    resolveRevealTarget(exerciseId: number): { courseId: number; title: string } | undefined;
    /** The provider's current navigation generation (#364 spec A/C), captured before the persist await. */
    currentNavToken(): number;
    /**
     * Navigate to the hint's exercise + proactive session as if the student switched there (#364
     * spec A). Returns false when expectedNavToken no longer matches (the student navigated away).
     */
    openRevealSession(courseId: number, exerciseId: number, sessionId: number, title: string, expectedNavToken: number): Promise<boolean>;
    /** Notify the student that a parked hint cannot be opened because its exercise is untracked (#364 spec C.3). */
    notifyRevealUnavailable(): void;
    /** Notify the student that a parked hint could not be persisted, so the reveal permanently gave up (#364). */
    notifyRevealFailed(): void;
    /** Reveal the hidden ambient hint by persisting it as a chat message in the proactive session (A10). */
    revealAmbient(exerciseId: number, episodeId: string, hintText: string, level: Level, clientMessageId: string): Promise<IrisChatMessage>;
    /** Record the student's terminal outcome for an episode-keyed proactive row (A10). */
    setEpisodeOutcome(exerciseId: number, episodeId: string, outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' | 'INTERRUPTED'): Promise<{ applied: boolean }>;
    /** Cancel an outstanding struggle job by its per-POST requestToken (A10 scoped cancel). */
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

// Default slot config (mirrors TUNING.slot; injected so tests can override).
// Default slot config (mirrors TUNING.slot; injected so tests can override).
export const DEFAULT_SLOT_CFG: StaleConfig = {
    idleAbandonMs: 600_000,
    warnLeadMs: 60_000,
};

export const DEFAULT_PROGRESS_CFG: ProgressCloseCfg = {
    reArmSBase: 0.6,
    reArmHoldMs: 30_000,
};
