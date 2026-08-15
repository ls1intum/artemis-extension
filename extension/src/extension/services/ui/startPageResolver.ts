import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import {
    collectExerciseSources,
    type DetectedExercise,
    findExerciseByRepositoryUrl,
    findWorkspaceCourseInArchive,
    getWorkspaceRepositoryUrl,
} from '@extension/services/workspace';
import type { CourseDashboardEntry, CourseDashboardResponse } from '@extension/types';
import { VSCODE_CONFIG } from '@extension/utils';

type StartPageResult =
    | { type: 'dashboard' }
    | { type: 'course-list'; coursesData: CourseDashboardResponse }
    | { type: 'workspace-exercise'; courseId: number; exerciseId: number; coursesData: CourseDashboardResponse; allCourses: CourseDashboardEntry[] }
    | { type: 'workspace-course'; courseId: number; coursesData: CourseDashboardResponse; allCourses: CourseDashboardEntry[] };

export class StartPageResolver {
    constructor(
        private readonly _artemisApi: ArtemisApiService,
        private readonly _courseCatalog?: CourseCatalog,
    ) {}

    /**
     * Picks the start page from user config and workspace state. The provider
     * decides how to render the returned result.
     */
    public async resolve(): Promise<StartPageResult> {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const value = config.get<string>(VSCODE_CONFIG.START_PAGE_KEY);

        if (value === 'course-list') {
            const coursesData = await this._fetchCourses().catch(() => undefined);
            if (coursesData?.courses) {
                return { type: 'course-list', coursesData };
            }
            // Course load failed; fall through to the dashboard.
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

        if (activeCourses.length > 0 && repoUrl) {
            detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources(activeCourses));
        }

        if (!detected && repoUrl) {
            try {
                const archivedEntry = await findWorkspaceCourseInArchive(this._artemisApi, activeCourses);
                if (archivedEntry) {
                    detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources([archivedEntry]));
                    if (detected) { allCourses.push(archivedEntry); }
                }
            } catch { /* archived search failed; fall through */ }
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
        if (this._courseCatalog) {
            const cached = await this._courseCatalog.fetch();
            if (cached) { return cached; }
        }
        // Should not happen in production: activate() always creates the cache
        // before StartPageResolver is used.
        throw new Error('Course data unavailable');
    }
}
