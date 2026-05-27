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

    const runDetection = async (): Promise<void> => {
        const token = ++generation;
        const callbacks = {
            registerExercise: (input: WorkspaceRegisterInput) => {
                if (token !== generation) return;
                deps.sink.registerWorkspaceExercise(input);
            },
            clearStaleWorkspaceContext: () => {
                if (token !== generation) return;
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
            folderSub.dispose();
            coursesSub.dispose();
        },
    };
}
