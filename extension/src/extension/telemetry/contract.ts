import type * as vscode from 'vscode';

import type { EpisodeHistoryEntry, ExtensionToWebviewMessage, ProactiveLevel, SlotDebugSnapshot, WebCmd } from '@shared/messageContracts';
import { WebviewCmd } from '@shared/messageContracts';

import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { SensorHub } from '@extension/services/sensing';
import type { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';

/**
 * Public contract of the struggle-detection engine (Schicht 2/3 owner).
 *
 * The `@telemetry` build seam swaps the real {@link StruggleCoordinator} for a
 * no-op in the Open VSX (clean / Theia-cloud / EduIDE) build, so every consumer
 * depends on this interface rather than the concrete class. Derived via `Pick`
 * from the class so the contract cannot drift: removing a public member from the
 * class breaks this type; the no-op must implement exactly this surface.
 *
 * TYPE-ONLY module — `import type { StruggleCoordinator }` is erased at build
 * time, so referencing the class here never pulls the engine into a bundle.
 */
export type IStruggleCoordinator = Pick<StruggleCoordinator,
    | 'setWebsocketService'
    | 'startExerciseSession'
    | 'endExerciseSession'
    | 'getSnapshot'
    | 'getDebugSnapshot'
    | 'isConsentGranted'
    | 'toggleSkipWarmup'
    | 'isSkipWarmup'
    | 'dispose'
    | 'onDidTick'
    | 'onDidAlert'
    | 'onDidStartSession'
    | 'onDidEndSession'
    | 'activeExerciseId'
>;

/**
 * A function that receives a live-feed message. Used as the unit of subscription
 * identity in the Map<Sink, refcount> model: each webview registers its own
 * stable send function as a sink so the feed can fan out to multiple panels.
 * Typed as ExtensionToWebviewMessage because the feed only ever posts protocol
 * messages; this matches the actual sender signatures and avoids contravariance
 * issues under strict TypeScript.
 */
export type Sink = (msg: ExtensionToWebviewMessage) => void;

/**
 * Live engine-decision feed for the developer-mode struggle view, behind the
 * `@telemetry` seam so the clean build never imports the real
 * {@link LiveEngineFeed} (it lives under the build-excluded
 * `services/struggle/` subtree). The full factory returns the real feed; the
 * no-op factory returns an inert stub.
 */
export interface ILiveEngineFeed {
    /** Reset the webview chart and stream the buffered + live ticks to this sink. */
    subscribe(sink: Sink): void;
    /** Decrement the ref-count for this sink; remove it when the count reaches zero. */
    unsubscribe(sink: Sink): void;
    /** Remove this sink unconditionally (host-teardown backstop). Silent no-op if absent. */
    dropSink(sink: Sink): void;
    /** Report whether an exercise session is active. A fresh session (false->true)
     *  resets the chart buffer; either transition updates the webview's session
     *  indicator (when subscribed in developer mode). */
    setSessionActive(active: boolean): void;
    /** Register the slot debug snapshot provider; called once after the engine handle is wired. */
    setSlotProvider(provider: () => { snapshot: SlotDebugSnapshot; episodes: EpisodeHistoryEntry[] } | null): void;
    /** Push the current slot debug snapshot to all subscribed webviews (no-op when none subscribed or devMode off). */
    pushSlotUpdate(): void;
    dispose(): void;
}

/**
 * Non-engine dependencies the full-build factory needs to construct the live
 * engine + the proactive intervention orchestrator. The no-op factory ignores
 * them. The struggle/intervention value graph itself lives ONLY inside the full
 * `@telemetry` module — these closures only reach always-bundled collaborators
 * (the API service, the chat provider, the websocket service), so the clean
 * build never imports `services/struggle|intervention|struggleIntervention`.
 *
 * The struggle-intervention wire types are referenced TYPE-ONLY here (erased at
 * build time), so naming them never pulls `struggleIntervention/` into a bundle.
 */
export interface StruggleEngineDeps {
    hub: SensorHub;
    exerciseRegistry: ExerciseRegistry;
    /** True iff Iris is enabled for the active exercise's course (global profile + course chat).
     *  Fail-closed: false when Iris is off OR availability is not yet known. */
    isIrisEnabled(): boolean;
    /** Registers the lifetime of the intervention service + delivery sink. */
    context: vscode.ExtensionContext;
    /** POST the proactive struggle signal to Artemis (egress); returns the egress result. */
    postIntervention(
        exerciseId: number,
        body: import('@extension/services/struggleIntervention/struggleContract').StruggleInterventionRequest,
    ): Promise<import('@extension/services/struggleIntervention/struggleContract').StruggleEgressResult>;
    /** Open/attach the Iris session carrying a proactive bubble. Lazy: the chat
     *  provider is constructed after the engine, so this is only called later. */
    openProactiveSession(sessionId: number): Promise<void>;
    /** Set/clear the proactive badge on the Iris view. Lazy (see above). */
    setProactiveBadge(on: boolean): void;
    /**
     * Post an optimistic proactive bubble to the open chat. `messageId` enables webview-side
     * dedup against a later server-pushed message with the same id (one bubble). Null = runtime-only.
     * `episodeId` threads the row into its episode group (live deliveries only; the reveal path
     * stays episode-less). Lazy: the chat provider is constructed after the engine.
     */
    postOptimisticBubble(text: string, messageId: number | null, episodeId?: string): void;
    /**
     * Push the host-authoritative live-episode snapshot to the chat webview (SetLiveEpisode
     * state frame): the DELIVERED episode's id, or null when no episode is live. The provider
     * caches the value and replays it on webview init, so a re-created webview renders the
     * live episode open instead of auto-folding it. Lazy (see above).
     */
    postLiveEpisode(episodeId: string | null): void;
    /** Reconnect-aware websocket subscribe primitive for the per-user struggle
     *  topic. The seam calls `subscribeStruggleEvents` with this internally, so
     *  `extension.ts` never imports anything from `struggleIntervention/`. */
    subscribeStruggleTopic(topic: string, onFrame: (data: unknown) => void): { dispose(): void };
    /** Durable single student opt-out (spec §12.2, issue #341): false → the orchestrator suppresses proactive. */
    isStudentProactiveOn(): boolean;
    /**
     * The single proactive-help level (Off/Less/More, spec §12.2, issue #341) — the level-aware form of
     * `isStudentProactiveOn` above. Resolves the {@link StruggleEngineHandle.getActiveProactiveLevel} accessor.
     */
    getProactiveLevel(): ProactiveLevel;
    // ---- C2: reveal + episode-outcome ----
    /**
     * Reveal a hidden ambient hint by persisting it (A10). Delegates to ArtemisApiService.revealAmbient.
     * Passed through the seam so the orchestrator never imports the API service directly.
     */
    revealAmbient(
        exerciseId: number,
        episodeId: string,
        hintText: string,
        level: 'ambient' | 'active',
        clientMessageId: string,
    ): Promise<import('@shared/types').IrisChatMessage>;
    /**
     * Record the student's terminal outcome for an episode-keyed proactive row (A10).
     * Delegates to ArtemisApiService.setEpisodeOutcome.
     */
    setEpisodeOutcome(
        exerciseId: number,
        episodeId: string,
        outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED',
    ): Promise<{ applied: boolean }>;
    /**
     * Post an optimistic reveal bubble with a string local id (C2 pull-reveal flow).
     * Distinct from postOptimisticBubble (which uses a numeric message id). The reveal
     * flow uses a uuid localId for idempotent reconcile.
     */
    postRevealBubble(text: string, localId: string): void;
    /**
     * Reconcile the reveal bubble after server persist confirms the canonical row.
     * Updates the bubble matched by localId to the real server id + proactiveEpisodeId + sentAt.
     */
    reconcileOptimisticBubble(localId: string, serverId: number, proactiveEpisodeId: string | undefined, sentAt: string): void;
    // C3: slot-continuity seam
    /**
     * Cancel an outstanding struggle job by its per-POST requestToken (A10 scoped cancel).
     * Delegates to ArtemisApiService.cancelOutstandingStruggleJob.
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
    // C4: stale-row suppression
    /**
     * Post a host->webview removeMessage{id} (C4 stale-row suppression).
     * The webview removes the row if present and suppresses future chat-ws arrivals of that id.
     */
    postRemoveMessage(id: number): void;
    /**
     * Durable delete of a superseded proactive row (A10 server-guarded).
     * Delegates to ArtemisApiService.deleteSupersededProactiveMessage.
     */
    deleteSupersededProactiveMessage(exerciseId: number, messageId: number): Promise<void>;
    /** Show the proactive nudge banner over the Artemis sidebar page (reveals it if hidden). Lazy. */
    showNudgeBanner(text: import('@extension/services/ui/nudgeBannerText').NudgeText, episodeId: string | undefined, timerMs: number): void;
    /** Hide the proactive nudge banner. Lazy. */
    hideNudgeBanner(): void;
    // ---- C5: offer-bubble transport (C6-C10 producers) ----
    /** Post an offer bubble to the open chat (spec B+). Lazy: the chat provider is constructed after the engine. */
    postOfferBubble(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void;
    /** Resolve an offer bubble by id (spec B+). Lazy (see {@link postOfferBubble}). */
    resolveOfferBubble(offerId: string, answered: 'accept' | 'decline' | 'timeout'): void;
    /** Show the proactive nudge banner as an offer (spec B+), revealing the sidebar if hidden. Lazy (see {@link postOfferBubble}). */
    showOfferBanner(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void;
}

/**
 * What the full `createStruggleEngine` returns: the coordinator (the only struggle
 * surface `extension.ts` keeps a reference to) plus a post-auth consent prompt
 * hook. The server-event subscription is wired INSIDE the seam, so no receiver is
 * exposed (and `IStruggleCoordinator` stays free of server-event members).
 */
export interface StruggleEngineHandle {
    coordinator: IStruggleCoordinator;
    /** Ask once, post-auth, whether to enable proactive help (local struggle detection +
     *  trigger-gated code reading, #349); no-op once decided. */
    promptConsentIfAsk(): Promise<void>;
    /**
     * The single remembered proactive-help level (Off/Less/More, spec §12.2, issue #341).
     * The full build reads `getProactiveLevel()` live; the clean/no-op build returns the
     * default `more`. Used by consumers such as the delivery throttle and Pull re-route.
     */
    getActiveProactiveLevel(): ProactiveLevel;
    /**
     * Proactive control (AskIris Off/Less/More, spec §12.2). These are ABSENT in the clean (no-engine) build:
     * extension.ts only assembles a `proactiveControl` capability when they are present, so the clean build never
     * surfaces a control for a feature it doesn't ship.
     */
    /**
     * Apply the transient effects of a level change: On marks the student present only
     * when `exerciseId` is active; global Off clears the active exercise's live surfaces
     * regardless of which exercise triggered it.
     */
    setStudentProactive?(exerciseId: number, on: boolean): void;
    /**
     * The two §14 gate causes, independently (spec §14 cases 4-5): `consentMissing` = no proactive-egress
     * consent (student-fixable → consent-missing card + forced-Off level, #342), `serverUnavailable` =
     * 404-latched server (→ limited card). Session-global, no exercise id. ABSENT in the clean build
     * (like the members above), so extension.ts assembles no `proactiveControl` capability there.
     */
    getProactiveGateState?(): { consentMissing: boolean; serverUnavailable: boolean };
    /**
     * C3: toggle the in-session flag on the slot (NON-semantic, no generation bump).
     * Called by extension.ts when the chat-view visibility changes so escalation can
     * choose quiet (bubble-only) vs loud (toast + inline) rendering. ABSENT in the
     * clean (no-engine) build, so extension.ts guards with `if (setInSession)`.
     */
    setInSession?(open: boolean): void;
    /**
     * C8: Episode-scoped dismiss. Frees the slot, tears down episode runtime, writes
     * the DISMISSED outcome (best-effort), and folds the episode without praise.
     * Called by the chat-card Dismiss (via setStruggleCallbacks.onEpisodeDismiss) and by
     * the banner's "Not now" action (directly in the telemetry seam closure).
     * ABSENT in the clean (no-engine) build; callers guard with optional chaining.
     */
    dismissEpisode?(episodeId?: string): void;
    /**
     * Manual "Solved it" close: like {@link dismissEpisode} but records a RECOVERED (success) outcome.
     * Called by the chat-card "Solved it" action (via setStruggleCallbacks.onEpisodeResolve).
     * ABSENT in the clean (no-engine) build; callers guard with optional chaining.
     */
    resolveEpisode?(episodeId?: string): void;
    /**
     * Slot debug: return the current slot state snapshot (Task 3 orchestrator). ABSENT in the
     * clean (no-engine) build; callers guard with optional chaining or presence checks.
     */
    getSlotDebugSnapshot?(): SlotDebugSnapshot;
    /**
     * Slot debug: return the ordered episode history (Task 3 orchestrator). ABSENT in the
     * clean (no-engine) build; callers guard with optional chaining or presence checks.
     */
    getEpisodeHistory?(): readonly EpisodeHistoryEntry[];
    /**
     * Register the sink that the orchestrator calls (coalesced) on every slot state change.
     * The extension entry point uses this to route slot updates to the webview feed.
     * ABSENT in the clean (no-engine) build; callers guard with optional chaining.
     */
    setSlotChangeSink?(fn: () => void): void;
    /** Route a nudge-banner button back to the engine outcome (full build only; omitted by the noop). */
    handleBannerAction?(payload: WebCmd<typeof WebviewCmd.NudgeBannerAction>['payload']): void;
}
