import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';

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
    courseDataCache: CourseDataCache;
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
}

export function wireWorkspaceDetection(deps: WorkspaceDetectionDeps): vscode.Disposable {
    let generation = 0;
    let disposed = false;

    const runDetection = async (): Promise<void> => {
        const token = ++generation;
        const callbacks = {
            registerExercise: (input: WorkspaceRegisterInput) => {
                if (disposed || token !== generation) {
                    return;
                }
                deps.sink.registerWorkspaceExercise(input);
                // Symmetric with the active open flow (ExerciseOpeningService.handleExerciseOpened): a
                // passively-detected workspace exercise must also start the struggle session. Idempotent
                // downstream (the coordinator no-ops a re-start of the same exercise id).
                deps.onWorkspaceExerciseDetected?.(input.id, vscode.workspace.workspaceFolders?.[0]?.uri);
            },
            clearStaleWorkspaceContext: () => {
                if (disposed || token !== generation) {
                    return;
                }
                deps.sink.clearWorkspaceExercise();
                // Symmetric with onWorkspaceExerciseDetected: no workspace exercise anymore -> end the
                // struggle session so a stale exercise/root cannot linger (see the dep's doc comment).
                deps.onWorkspaceExerciseCleared?.();
            },
        };
        await detectAndRegisterWorkspaceExercise(
            deps.api, callbacks, deps.registry, deps.courseDataCache,
        );
    };

    void runDetection();
    const folderSub = vscode.workspace.onDidChangeWorkspaceFolders(() => void runDetection());
    const coursesSub = deps.courseDataCache.onCoursesLoaded(() => void runDetection());

    return {
        dispose: () => {
            disposed = true;
            folderSub.dispose();
            coursesSub.dispose();
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
