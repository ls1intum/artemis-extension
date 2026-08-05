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
    courseId?: number;
    repositoryUri?: string;
    source: 'workspace-detected';
    isWorkspace: true;
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
    session: {
        readonly state: SessionState;
        readonly epoch: number;
        onDidChangeSession: vscode.Event<SessionState>;
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
            // nothing to match against. The chooser is the right screen; the
            // Retry banner for a 401 dashboard fetch was not.
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
            },
            clearStaleWorkspaceContext: () => {
                if (stale()) {
                    return;
                }
                deps.sink.clearWorkspaceExercise();
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

    return {
        onDetectionSettled: settled.event,
        retry: () => void runDetection(),
        dispose: () => {
            disposed = true;
            folderSub.dispose();
            coursesSub.dispose();
            sessionSub.dispose();
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
