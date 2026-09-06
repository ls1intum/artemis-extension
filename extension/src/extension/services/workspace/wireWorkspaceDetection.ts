import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { SessionState } from '@extension/services/session/sessionIdentityCoordinator';

import type { DetectionOutcome } from './detectionOutcome';
import { detectAndRegisterWorkspaceExercise } from './workspaceDetectionService';

export interface WorkspaceRegisterInput {
    id: number;
    title: string;
    shortName?: string;
    courseId: number;
    repositoryUri?: string;
}

export interface WorkspaceDetectionSink {
    registerWorkspaceExercise(input: WorkspaceRegisterInput): void;
    clearWorkspaceExercise(): void;
}

interface WorkspaceDetectionDeps {
    api: ArtemisApiService | undefined;
    registry: ExerciseRegistry;
    courseCatalog: CourseCatalog;
    sink: WorkspaceDetectionSink;
    /**
     * Optional: start struggle detection for a passively-detected workspace exercise. Bound to the
     * (telemetry-seam-gated) struggle coordinator in extension.ts; left undefined in the clean Open VSX
     * build, so no struggle code is imported here. Without this, reopening VS Code on an already-cloned
     * exercise activates Iris chat but never starts the struggle session (only the active webview
     * "open exercise" flow did), so the engine has no active exercise and stays silent.
     */
    onWorkspaceExerciseDetected?: (exerciseId: number, exerciseRoot?: vscode.Uri) => void;
    /**
     * Optional, symmetric to {@link onWorkspaceExerciseDetected}: end the struggle session when detection
     * finds no workspace exercise (folder removed, switched to a non-Artemis repo). Without this the
     * coordinator keeps a stale active exercise after the student leaves it, so `hasExercise` stays true and
     * the engine would attribute edits / gate a POST against the exercise that is no longer open. Idempotent
     * (the coordinator no-ops an end when no session is active); undefined in the clean Open VSX build.
     */
    onWorkspaceExerciseCleared?: () => void;
    session: {
        readonly state: SessionState;
        readonly epoch: number;
        onDidChangeSession: vscode.Event<SessionState>;
        onDidStallResolution: vscode.Event<void>;
        resolvePrincipal(): Promise<void>;
    };
}

export function wireWorkspaceDetection(
    deps: WorkspaceDetectionDeps,
): vscode.Disposable & { onDetectionSettled: vscode.Event<DetectionOutcome>; retry(): void } {
    let generation = 0;
    let disposed = false;
    const settled = new vscode.EventEmitter<DetectionOutcome>();

    const runDetection = async (): Promise<void> => {
        const token = ++generation;
        if (disposed) {
            // Torn down before this deferred (or event-triggered) run even
            // started. Every other exit path below routes through `stale()`,
            // which checks `disposed` too; the resolving and anonymous
            // branches return before ever reaching it, so they need the same
            // check up front to honour disposal uniformly.
            return;
        }
        const epoch = deps.session.epoch;
        const kind = deps.session.state.kind;
        if (kind === 'resolving') {
            // Not an answer and not a failure. Publishing anything here would
            // either tell the student this folder has no exercise or offer a
            // Retry for a question nobody has asked yet.
            return;
        }
        if (kind === 'anonymous') {
            // Settled, and server-independent: with no account there is
            // nothing to match against, so the chooser is the right screen.
            deps.sink.clearWorkspaceExercise();
            settled.fire({ kind: 'no-match' });
            return;
        }
        const stale = () => disposed || token !== generation || epoch !== deps.session.epoch;
        const callbacks = {
            registerExercise: (input: WorkspaceRegisterInput) => {
                if (stale()) {
                    return;
                }
                deps.sink.registerWorkspaceExercise(input);
                // Symmetric with the active open flow (ExerciseOpeningService.handleExerciseOpened): a
                // passively-detected workspace exercise must also start the struggle session. Idempotent
                // downstream (the coordinator no-ops a re-start of the same exercise id).
                deps.onWorkspaceExerciseDetected?.(input.id, vscode.workspace.workspaceFolders?.[0]?.uri);
            },
            clearStaleWorkspaceContext: () => {
                if (stale()) {
                    return;
                }
                deps.sink.clearWorkspaceExercise();
                // Symmetric with onWorkspaceExerciseDetected: no workspace exercise anymore -> end the
                // struggle session so a stale exercise/root cannot linger (see the dep's doc comment).
                deps.onWorkspaceExerciseCleared?.();
            },
        };
        const outcome = await detectAndRegisterWorkspaceExercise(
            deps.api, callbacks, deps.registry, deps.courseCatalog,
        );
        if (stale()) {
            return;
        }
        settled.fire(outcome);
    };

    // Deferred, not `void runDetection()`. The anonymous branch answers
    // without awaiting anything, and a synchronous answer arrives before the
    // caller holds the event to hear it. One microtask is enough:
    // `attachStartupDetection` subscribes in the same synchronous activation
    // block.
    queueMicrotask(() => void runDetection());
    const folderSub = vscode.workspace.onDidChangeWorkspaceFolders(() => void runDetection());
    const coursesSub = deps.courseCatalog.onCoursesLoaded(() => void runDetection());
    const sessionSub = deps.session.onDidChangeSession(() => void runDetection());
    // Identity resolution gave up, so the `resolving` branch above will keep
    // returning without publishing anything. Left alone that is a chat stuck
    // on its startup spinner for the rest of the window, with no Retry, for
    // what is usually one failed request at activation. `unavailable` says
    // exactly what happened, and it is the one state that comes with a Retry.
    const stallSub = deps.session.onDidStallResolution(() => {
        if (disposed || deps.session.state.kind !== 'resolving') { return; }
        settled.fire({ kind: 'unavailable' });
    });

    return {
        onDetectionSettled: settled.event,
        retry: () => {
            if (deps.session.state.kind === 'resolving') {
                // Detection has nothing to re-run: it never started. What
                // failed is the identity lookup, so that is what the Retry
                // repeats. A resolution that then settles fires
                // `onDidChangeSession`, and the subscription above runs
                // detection from there.
                void deps.session.resolvePrincipal();
                return;
            }
            void runDetection();
        },
        dispose: () => {
            disposed = true;
            folderSub.dispose();
            coursesSub.dispose();
            sessionSub.dispose();
            stallSub.dispose();
            settled.dispose();
        },
    };
}

/**
 * Build a WorkspaceDetectionSink that routes register/clear calls through a
 * ChatWebviewProvider (or any object with the same two methods). Extracted so
 * the sink construction is unit-testable and so `extension.ts` does not contain
 * untestable inline closures.
 */
export function buildChatProviderSink(provider: {
    registerWorkspaceExercise: WorkspaceDetectionSink['registerWorkspaceExercise'];
    clearWorkspaceExercise: WorkspaceDetectionSink['clearWorkspaceExercise'];
}): WorkspaceDetectionSink {
    return {
        registerWorkspaceExercise: (input) => provider.registerWorkspaceExercise(input),
        clearWorkspaceExercise: () => provider.clearWorkspaceExercise(),
    };
}
