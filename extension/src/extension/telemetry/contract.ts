import type * as vscode from 'vscode';

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
    | 'isEnabled'
    | 'dispose'
    | 'onDidTick'
    | 'onDidAlert'
    | 'onDidStartSession'
    | 'onDidEndSession'
>;

/**
 * Live engine-decision feed for the developer-mode struggle view, behind the
 * `@telemetry` seam so the clean build never imports the real
 * {@link LiveEngineFeed} (it lives under the build-excluded
 * `services/struggle/` subtree). The full factory returns the real feed; the
 * no-op factory returns an inert stub.
 */
export interface ILiveEngineFeed {
    /** Reset the webview chart and stream the buffered + live ticks. */
    subscribe(): void;
    /** Stop streaming live ticks (the buffer keeps filling). */
    unsubscribe(): void;
    /** Report whether an exercise session is active. A fresh session (false→true)
     *  resets the chart buffer; either transition updates the webview's session
     *  indicator (when subscribed in developer mode). */
    setSessionActive(active: boolean): void;
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
     * Lazy: the chat provider is constructed after the engine.
     */
    postOptimisticBubble(text: string, messageId: number | null): void;
    /** Reconnect-aware websocket subscribe primitive for the per-user struggle
     *  topic. The seam calls `subscribeStruggleEvents` with this internally, so
     *  `extension.ts` never imports anything from `struggleIntervention/`. */
    subscribeStruggleTopic(topic: string, onFrame: (data: unknown) => void): { dispose(): void };
    /** Durable per-exercise student opt-out (spec §12.2): false → the orchestrator suppresses proactive for it. */
    isStudentProactiveOn(exerciseId: number): boolean;
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
     * Distinct from postOptimisticBubble (which uses a numeric message id) — the reveal
     * flow uses a uuid localId for idempotent reconcile.
     */
    postRevealBubble(text: string, localId: string): void;
    /**
     * Reconcile the reveal bubble after server persist confirms the canonical row.
     * Updates the bubble matched by localId to the real server id + proactiveEpisodeId + sentAt.
     */
    reconcileOptimisticBubble(localId: string, serverId: number, proactiveEpisodeId: string | undefined, sentAt: string): void;
}

/**
 * What the full `createStruggleEngine` returns: the coordinator (the only struggle
 * surface `extension.ts` keeps a reference to) plus a post-auth consent prompt
 * hook. The server-event subscription is wired INSIDE the seam, so no receiver is
 * exposed (and `IStruggleCoordinator` stays free of server-event members).
 */
export interface StruggleEngineHandle {
    coordinator: IStruggleCoordinator;
    /** Ask once, post-auth, whether Iris may proactively read code; no-op once decided. */
    promptConsentIfAsk(): Promise<void>;
    /** Record a chat-bubble dismiss into the delivery backoff (Slice 4a). No-op in the clean build. */
    recordProactiveDismiss(): void;
    /**
     * Proactive control (AskIris On/Off switch, spec §12.2). These three are ABSENT in the clean (no-engine) build:
     * extension.ts only assembles a `proactiveControl` capability when they are present, so the clean build never
     * surfaces a switch for a feature it doesn't ship.
     */
    /** True iff the delivery backoff is paused for this exercise ("Auto-paused" badge). */
    isProactivePaused?(exerciseId: number): boolean;
    /** Apply the AskIris switch for an exercise: off clears its live surfaces, on clears any auto-pause. */
    setStudentProactive?(exerciseId: number, on: boolean): void;
    /** "Resume" action: clear the auto-pause backoff for an exercise. */
    resumeProactive?(exerciseId: number): void;
    /**
     * True iff proactive is degraded (no proactive-egress consent OR a 404-latched server). Drives the AskIris
     * "Degraded" card (spec §14 cases 4-5). Session-global, no exercise id. ABSENT in the clean build (like the
     * three above), so extension.ts assembles no `proactiveControl` capability there.
     */
    isProactiveDegraded?(): boolean;
}
