import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import {
    collectExerciseSources,
    type DetectedExercise,
    findExerciseByRepositoryUrl,
    findWorkspaceCourseInArchive,
    getWorkspaceRepositoryUrl,
} from '@extension/services/workspace';
import type { CourseDashboardEntry, CourseDashboardResponse } from '@extension/types';
import { VSCODE_CONFIG } from '@extension/utils';

// ── Result types ─────────────────────────────────────────────────────

export type StartPageResult =
    | { type: 'dashboard' }
    | { type: 'course-list'; coursesData: CourseDashboardResponse }
    | { type: 'workspace-exercise'; courseId: number; exerciseId: number; coursesData: CourseDashboardResponse; allCourses: CourseDashboardEntry[] }
    | { type: 'workspace-course'; courseId: number; coursesData: CourseDashboardResponse; allCourses: CourseDashboardEntry[] };

// ── Resolver ─────────────────────────────────────────────────────────

export class StartPageResolver {
    constructor(
        private readonly _artemisApi: ArtemisApiService,
        private readonly _courseDataCache?: CourseDataCache,
    ) {}

    /**
     * Determine which start page to show based on user config and workspace state.
     * Returns a typed result — the provider decides how to render it.
     */
    public async resolve(): Promise<StartPageResult> {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const value = config.get<string>(VSCODE_CONFIG.START_PAGE_KEY);

        if (value === 'course-list') {
            const coursesData = await this._fetchCourses().catch(() => undefined);
            if (coursesData?.courses) {
                return { type: 'course-list', coursesData };
            }
            // Course load failed — fall through to dashboard
        }

        if (value === 'workspace-exercise' || value === 'workspace-course') {
            const result = await this._resolveWorkspace(value);
            if (result) { return result; }
        }

        return { type: 'dashboard' };
    }

    private async _resolveWorkspace(
        mode: 'workspace-exercise' | 'workspace-course',
    ): Promise<StartPageResult | null> {
        const [coursesData, repoUrl] = await Promise.all([
            this._fetchCourses().catch(() => undefined),
            getWorkspaceRepositoryUrl(),
        ]);

        const activeCourses = coursesData?.courses || [];
        const allCourses = [...activeCourses];
        let detected: DetectedExercise | null = null;

        // 1) Search active courses
        if (activeCourses.length > 0 && repoUrl) {
            detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources(activeCourses));
        }

        // 2) Fallback: search archived courses
        if (!detected && repoUrl) {
            try {
                const archivedEntry = await findWorkspaceCourseInArchive(this._artemisApi, activeCourses);
                if (archivedEntry) {
                    detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources([archivedEntry]));
                    if (detected) { allCourses.push(archivedEntry); }
                }
            } catch { /* archived search failed — fall through */ }
        }

        if (!detected?.courseId || !coursesData) { return null; }

        if (mode === 'workspace-exercise') {
            return {
                type: 'workspace-exercise',
                courseId: detected.courseId,
                exerciseId: detected.id,
                coursesData,
                allCourses,
            };
        }

        return {
            type: 'workspace-course',
            courseId: detected.courseId,
            coursesData,
            allCourses,
        };
    }

    private async _fetchCourses(): Promise<CourseDashboardResponse> {
        if (this._courseDataCache) {
            const cached = await this._courseDataCache.fetch();
            if (cached) { return cached; }
        }
        // Cache unavailable or returned undefined — should not happen in production
        // since activate() always creates the cache before StartPageResolver is used.
        throw new Error('Course data unavailable');
    }
}
