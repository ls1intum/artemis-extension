import type * as vscode from 'vscode';

import { buildCourseAccessKey } from '@extension/services/session/identityKeys';

import { LogCategory, logger } from './loggingService';

/** Already-normalized identity. Normalization happens once, in the coordinator. */
export interface CourseAccessScope {
    serverKey: string;
    principal: string;
}

export type CourseAccessMap = Record<number, number>;

export const COURSE_ACCESS_STORAGE_LIMIT = 20;
export const COURSE_ACCESS_DISPLAY_LIMIT = 3;

/**
 * Invariant: sync read-after-write. `onCourseAccessed` must be observable by an
 * immediate `getLastAccessedCourses()` call, but `globalState.update()` is async.
 * The shadow map is the authoritative in-memory state; the write chain serializes
 * persistence without blocking reads.
 */
export class CourseAccessStorageService {
    private readonly _shadow = new Map<string, CourseAccessMap>();
    private readonly _writeChain = new Map<string, Promise<unknown>>();

    constructor(
        private readonly _globalState: vscode.Memento,
        private readonly _getScope: () => CourseAccessScope | null,
    ) {}

    public onCourseAccessed(courseId: number): void {
        if (!Number.isFinite(courseId) || courseId <= 0) { return; }
        const scopeKey = this._currentScopeKey();
        if (!scopeKey) { return; }

        const current = this._getShadow(scopeKey);
        const next: CourseAccessMap = { ...current, [courseId]: Date.now() };

        const ids = Object.keys(next);
        if (ids.length > COURSE_ACCESS_STORAGE_LIMIT) {
            let oldestId = ids[0]!;
            let oldestTs = next[Number(oldestId)]!;
            for (const id of ids) {
                const ts = next[Number(id)]!;
                if (ts < oldestTs) { oldestTs = ts; oldestId = id; }
            }
            delete next[Number(oldestId)];
        }

        this._shadow.set(scopeKey, next);

        const snapshot = { ...next };
        const prev = this._writeChain.get(scopeKey) ?? Promise.resolve();
        const chained = prev
            .catch(() => undefined)
            .then(() => this._globalState.update(scopeKey, snapshot))
            .catch((err: unknown) => {
                logger.warn('Failed to persist recent-course access', LogCategory.VIEW, err);
            });
        this._writeChain.set(scopeKey, chained);
    }

    public getLastAccessedCourses(): number[] {
        const scopeKey = this._currentScopeKey();
        if (!scopeKey) { return []; }
        const map = this._getShadow(scopeKey);
        return Object.entries(map)
            .sort((a, b) => b[1] - a[1])
            .slice(0, COURSE_ACCESS_DISPLAY_LIMIT)
            .map(([id]) => Number(id));
    }

    /**
     * When this course was last opened, for the chat picker's course order.
     * `undefined` for a course outside the stored window, which sorts it after
     * every remembered one: the same rule the Artemis client uses.
     */
    public getAccessTimestamp(courseId: number): number | undefined {
        const scopeKey = this._currentScopeKey();
        if (!scopeKey) { return undefined; }
        return this._getShadow(scopeKey)[courseId];
    }

    private _currentScopeKey(): string | null {
        const scope = this._getScope();
        if (!scope) { return null; }
        return buildCourseAccessKey(scope.serverKey, scope.principal);
    }

    private _getShadow(scopeKey: string): CourseAccessMap {
        const cached = this._shadow.get(scopeKey);
        if (cached) { return cached; }
        const persisted = this._globalState.get<CourseAccessMap>(scopeKey, {});
        const copy: CourseAccessMap = {};
        for (const [id, ts] of Object.entries(persisted)) {
            const idNum = Number(id);
            if (Number.isFinite(idNum) && typeof ts === 'number') { copy[idNum] = ts; }
        }
        this._shadow.set(scopeKey, copy);
        return copy;
    }
}
