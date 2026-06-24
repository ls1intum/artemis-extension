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
    | 'getSnapshot'
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
    /** Reconnect-aware websocket subscribe primitive for the per-user struggle
     *  topic. The seam calls `subscribeStruggleEvents` with this internally, so
     *  `extension.ts` never imports anything from `struggleIntervention/`. */
    subscribeStruggleTopic(topic: string, onFrame: (data: unknown) => void): { dispose(): void };
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
}
