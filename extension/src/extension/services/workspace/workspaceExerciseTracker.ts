import * as vscode from 'vscode';

/**
 * The exercise this folder is a checkout of. Derived from the git remote by
 * workspace detection, so `courseId` is always known: detection refuses a
 * match without one.
 */
export interface WorkspaceExercise {
    id: number;
    title: string;
    shortName?: string;
    courseId: number;
    repositoryUri?: string;
}

/**
 * Memory-only, one record, re-derived per activation. Nothing else about the
 * exercise is cached here; the rest is fetched from the server.
 */
export class WorkspaceExerciseTracker implements vscode.Disposable {
    private _current: WorkspaceExercise | undefined;

    /**
     * Fires on a change of EXERCISE, not of record: the struggle detector
     * starts a session on it, and re-announcing the same exercise because its
     * title changed would restart that session for nothing.
     */
    private readonly _onDidChange = new vscode.EventEmitter<WorkspaceExercise | undefined>();
    public readonly onDidChange = this._onDidChange.event;

    public get current(): WorkspaceExercise | undefined { return this._current; }
    public get exerciseId(): number | undefined { return this._current?.id; }

    public set(exercise: WorkspaceExercise): void {
        const previousId = this._current?.id;
        this._current = exercise;
        if (previousId !== exercise.id) { this._onDidChange.fire(exercise); }
    }

    public clear(): void {
        if (this._current === undefined) { return; }
        this._current = undefined;
        this._onDidChange.fire(undefined);
    }

    public dispose(): void {
        this._onDidChange.dispose();
    }
}
