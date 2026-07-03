import * as vscode from 'vscode';

import type { CourseDetailData, ExtensionToWebviewMessage, RecentCourseNode } from '@shared/messageContracts';
import { ExtensionMsg, toCourseDetailData } from '@shared/messageContracts';

import { AppStateManager } from '@extension/controller/appStateManager';
import type { WebViewMessageHandler } from '@extension/controller/webViewMessageHandler';
import { COURSE_ACCESS_DISPLAY_LIMIT, type CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ITelemetryManager } from '@extension/services/telemetry';
import { GitService } from '@extension/services/workspace/gitService';
import {
    collectExerciseSources,
    detectWorkspaceExercise,
    detectWorkspaceForRepoUris,
} from '@extension/services/workspace/workspaceDetectionService';
import { getTheiaEnvironment } from '@extension/theia/theiaEnvironment';
import type { CourseDashboardEntry, ExerciseDetail } from '@extension/types';
import { resolveServerUrl } from '@extension/utils';

import { selectRecentCourses } from './recentCourseSelector';

export class ViewInitDataService {
    private _initGeneration = 0;
    private readonly _gitService = new GitService();

    constructor(
        private readonly _appStateManager: AppStateManager,
        private readonly _telemetryManager: ITelemetryManager | undefined,
        private readonly _messageHandler: WebViewMessageHandler,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        private readonly _courseAccessStorage?: CourseAccessStorageService,
    ) {}

    public sendInitData(): void {
        ++this._initGeneration;
        const state = this._appStateManager.currentState;
        if (state !== 'exercise-detail') {
            this._messageHandler.clearRepositoryContext();
        }
        switch (state) {
            case 'dashboard':              return this.sendDashboardInit();
            case 'course-list':            return this.sendCourseListInit();
            case 'course-detail':          return this.sendCourseDetailInit();
            case 'exercise-detail':        return this.sendExerciseDetailInit();
            case 'ai-config':              return this.sendAiConfigInit();
            case 'struggle-detection':     return this.sendStruggleDetectionInit();
            case 'service-status':         return this.sendServiceStatusInit();
            case 'recommended-extensions': return this.sendRecommendedExtensionsInit();
            case 'git-credentials':        return this.sendGitCredentialsInit();
            case 'login':                  return this.sendLoginInit();
        }
    }

    public sendDashboardInit(): void {
        const coursesData = this._appStateManager.coursesData;
        const courses = coursesData?.courses || [];

        const accessedIds = this._courseAccessStorage?.getLastAccessedCourses() ?? [];
        const selectedCourses = selectRecentCourses(courses, accessedIds, COURSE_ACCESS_DISPLAY_LIMIT);

        const recentCourseNodes: RecentCourseNode[] = selectedCourses.flatMap((courseItem: CourseDashboardEntry) => {
            const course = courseItem.course ?? courseItem;
            const exercises = course.exercises ?? [];

            const recentExercises = [...exercises]
                .sort((a: ExerciseDetail, b: ExerciseDetail) => {
                    const aDate = a.releaseDate || a.startDate || a.dueDate || '';
                    const bDate = b.releaseDate || b.startDate || b.dueDate || '';
                    if (aDate && bDate) { return bDate.localeCompare(aDate); }
                    if (aDate && !bDate) { return -1; }
                    if (!aDate && bDate) { return 1; }
                    return (b.id ?? 0) - (a.id ?? 0);
                });

            const detail = toCourseDetailData(course);
            if (!detail) {
                logger.warn(`Dashboard init: dropping course without numeric id (title=${course?.title ?? '<unknown>'})`, LogCategory.VIEW);
                return [];
            }
            return [{ courseData: detail, exercises: recentExercises }];
        });

        // Collect typed ExerciseSource list across all courses for workspace detection.
        // Replaces the previous `as ExerciseSource[]` cast at the detectWorkspaceExercise
        // call site below.
        const allExerciseSources = collectExerciseSources(courses);

        // null = "no match" (shown to user), undefined = "still loading" (keeps skeleton).
        // We only publish null once the archived-course check has finished,
        // so the UI doesn't flash "no exercise" before a late-arriving archived match.
        const noMatch = this._appStateManager.archiveCheckComplete ? null : undefined;

        if (allExerciseSources.length === 0) {
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: noMatch,
            });
            return;
        }

        const gen = this._initGeneration;
        detectWorkspaceExercise(allExerciseSources).then((detectedExercise) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: detectedExercise
                    ? { id: detectedExercise.id, title: detectedExercise.title }
                    : noMatch,
            });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to detect workspace exercise for dashboard', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: noMatch,
            });
        });
    }

    public sendCourseListInit(): void {
        const appState = this._appStateManager;
        const coursesData = appState.coursesData;
        const courses = coursesData?.courses || [];
        const archivedCourses = appState.archivedCoursesData || undefined;

        const mappedCourses: CourseDetailData[] = courses.flatMap((entry: CourseDashboardEntry) => {
            const detail = toCourseDetailData(entry.course);
            if (!detail) {
                logger.warn(`Course list init: dropping course without numeric id (title=${entry.course?.title ?? '<unknown>'})`, LogCategory.VIEW);
                return [];
            }
            return [detail];
        });

        this._postMessage({
            type: ExtensionMsg.CourseListInit,
            courses: mappedCourses, archivedCourses,
        });
    }

    public sendCourseDetailInit(): void {
        const courseData = this._appStateManager.currentCourseData;
        if (!courseData) {
            logger.error('Course detail state missing course data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Course data is not available. Please go back and try again.' });
            return;
        }

        const sources = collectExerciseSources([{
            course: courseData.course,
            exercises: courseData.course.exercises,
        }]);

        const gen = this._initGeneration;
        detectWorkspaceExercise(sources).then((detectedExercise) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage({
                type: ExtensionMsg.CourseDetailInit,
                courseData,
                workspaceExerciseId: detectedExercise?.id ?? null,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to detect workspace exercise for course detail', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.CourseDetailInit,
                courseData,
                workspaceExerciseId: null,
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        });
    }

    public sendExerciseDetailInit(): void {
        const exerciseData = this._appStateManager.currentExerciseData;
        if (!exerciseData) {
            logger.error('Exercise detail state missing exercise data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Exercise data is not available. Please go back and try again.' });
            return;
        }

        const isManagedEnvironment = getTheiaEnvironment().isManagedEnvironment;

        const participations = exerciseData.exercise?.studentParticipations ?? [];
        const repoUris = participations
            .map(p => p.repositoryUri)
            .filter((uri): uri is string => !!uri);

        if (repoUris.length > 0) {
            const exerciseId = exerciseData.exercise?.id;
            const gen = this._initGeneration;
            detectWorkspaceForRepoUris(repoUris).then((repoStatus) => {
                if (gen !== this._initGeneration) { return; }
                // Set repo context so workspace listeners can auto-detect changes on file save
                if (repoStatus.matchedUri && exerciseId !== undefined) {
                    const handler = this._messageHandler;
                    handler.setRepositoryContext(repoStatus.matchedUri, exerciseId);
                }
                this._postMessage({
                    type: ExtensionMsg.ExerciseDetailInit,
                    exerciseData,
                    hideDeveloperTools: !this._isDeveloperMode(),
                    isManagedEnvironment,
                    repoStatus,
                    serverRenderedProblemStatement: this._appStateManager.serverRenderedProblemStatement ?? undefined,
                });
            }).catch((error) => {
                if (gen !== this._initGeneration) { return; }
                logger.error('Failed to detect workspace status for exercise detail', LogCategory.VIEW, error);
                this._messageHandler.clearRepositoryContext();
                this._postMessage({
                    type: ExtensionMsg.ExerciseDetailInit,
                    exerciseData,
                    hideDeveloperTools: !this._isDeveloperMode(),
                    isManagedEnvironment,
                    serverRenderedProblemStatement: this._appStateManager.serverRenderedProblemStatement ?? undefined,
                });
            });
        } else {
            this._messageHandler.clearRepositoryContext();
            this._postMessage({
                type: ExtensionMsg.ExerciseDetailInit,
                exerciseData,
                hideDeveloperTools: !this._isDeveloperMode(),
                isManagedEnvironment,
                serverRenderedProblemStatement: this._appStateManager.serverRenderedProblemStatement ?? undefined,
            });
        }
    }

    public sendAiConfigInit(): void {
        const aiExtensions = this._appStateManager.aiExtensions || [];
        this._postMessage({ type: ExtensionMsg.AiConfigInit, aiExtensions });
    }

    public sendStruggleDetectionInit(): void {
        const telemetry = this._telemetryManager;
        const ctx = telemetry?.getStruggleContext();
        this._postMessage({
            type: ExtensionMsg.StruggleDetectionInit,
            isStruggling: ctx?.isStruggling ?? false,
            eq: ctx?.eq ?? 0,
            eqConfidence: ctx?.eqConfidence ?? 'insufficient',
            triggerType: ctx?.triggerType,
            recommendedAction: ctx?.recommendedAction ?? 'none',
            isEnabled: telemetry?.isEnabled() ?? false,
            developerMode: this._isDeveloperMode(),
        });
    }

    public sendServiceStatusInit(): void {
        const serverUrl = this._appStateManager.userInfo?.serverUrl;
        this._postMessage({ type: ExtensionMsg.ServiceStatusInit, serverUrl });
    }

    public sendRecommendedExtensionsInit(): void {
        const categories = this._appStateManager.recommendedExtensions || [];
        const mappedCategories = categories.map(category => ({
            ...category,
            extensions: category.extensions.map(ext => ({
                ...ext,
                isInstalled: ext.isInstalled ?? false
            }))
        }));
        this._postMessage({ type: ExtensionMsg.RecommendedExtensionsInit, categories: mappedCategories });
    }

    public sendGitCredentialsInit(): void {
        const gen = this._initGeneration;
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        this._gitService.readIdentity(cwd).then(({ name, email }) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage({ type: ExtensionMsg.GitIdentityInfo, name, email });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to read git identity', LogCategory.VIEW, error);
            this._postMessage({ type: ExtensionMsg.GitIdentityInfo, name: '', email: '' });
        });
    }

    public sendLoginInit(): void {
        this._postMessage({ type: ExtensionMsg.SetServerUrl, serverUrl: resolveServerUrl() });
    }

    private _isDeveloperMode(): boolean {
        const config = vscode.workspace.getConfiguration('artemis');
        return config.get<boolean>('developerMode', false);
    }
}
