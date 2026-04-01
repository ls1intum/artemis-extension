import * as vscode from 'vscode';
import type { ArtemisApiService } from '../api';
import type { CourseDashboardResponse } from '../types';
import { logger, LogCategory } from './loggingService';

/**
 * Single source of truth for course dashboard data.
 *
 * Deduplicates concurrent fetches, caches the result, and fires an event
 * so all consumers (AppStateManager, ExerciseRegistry, ContextStore) stay
 * aligned without making independent API calls.
 */
export class CourseDataCache implements vscode.Disposable {
    private _data: CourseDashboardResponse | undefined;
    private _inflightFetch: Promise<CourseDashboardResponse | undefined> | undefined;

    private readonly _onCoursesLoaded = new vscode.EventEmitter<CourseDashboardResponse>();
    public readonly onCoursesLoaded = this._onCoursesLoaded.event;

    constructor(private readonly _api: ArtemisApiService) {}

    /** Returns the cached dashboard data, or undefined if not yet fetched. */
    public get(): CourseDashboardResponse | undefined {
        return this._data;
    }

    /**
     * Fetches course dashboard data from the API (or returns cached data).
     *
     * - Deduplicates: concurrent callers share the same in-flight request.
     * - Fires `onCoursesLoaded` every time fresh data arrives.
     * - Pass `force: true` to bypass the cache (e.g. user-triggered reload).
     */
    public async fetch(options?: { force?: boolean }): Promise<CourseDashboardResponse | undefined> {
        if (this._data && !options?.force) {
            return this._data;
        }

        // Deduplicate concurrent fetches
        if (this._inflightFetch && !options?.force) {
            return this._inflightFetch;
        }

        this._inflightFetch = this._doFetch();
        try {
            return await this._inflightFetch;
        } finally {
            this._inflightFetch = undefined;
        }
    }

    private async _doFetch(): Promise<CourseDashboardResponse | undefined> {
        try {
            const data = await this._api.getCoursesForDashboard();
            this._data = data;
            logger.info(
                `CourseDataCache: loaded ${data.courses?.length ?? 0} courses`,
                LogCategory.GENERAL,
            );
            this._onCoursesLoaded.fire(data);
            return data;
        } catch (error) {
            logger.error('CourseDataCache: failed to fetch courses', LogCategory.GENERAL, error);
            return undefined;
        }
    }

    /** Clears the cache (e.g. on logout). */
    public clear(): void {
        this._data = undefined;
    }

    public dispose(): void {
        this._onCoursesLoaded.dispose();
    }
}
