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

export interface WorkspaceDetectionDeps {
    api: ArtemisApiService | undefined;
    registry: ExerciseRegistry;
    courseDataCache: CourseDataCache;
    sink: WorkspaceDetectionSink;
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
            },
            clearStaleWorkspaceContext: () => {
                if (disposed || token !== generation) {
                    return;
                }
                deps.sink.clearWorkspaceExercise();
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
