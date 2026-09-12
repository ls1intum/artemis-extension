import * as vscode from 'vscode';

import type { CourseDetailData, ExtensionToWebviewMessage, RecentCourseNode } from '@shared/messageContracts';
import { ExtensionMsg, toCourseDetailData } from '@shared/messageContracts';

import { AppStateManager } from '@extension/controller/appStateManager';
import type { WebViewMessageHandler } from '@extension/controller/webViewMessageHandler';
import type { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import { COURSE_ACCESS_DISPLAY_LIMIT, type CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import { LogCategory, logger } from '@extension/services/loggingService';
import { GitService } from '@extension/services/workspace/gitService';
import {
    collectExerciseSources,
    detectWorkspaceExercise,
    detectWorkspaceForRepoUris,
} from '@extension/services/workspace/workspaceDetectionService';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';
import { getTheiaEnvironment } from '@extension/theia/theiaEnvironment';
import type { CourseDashboardEntry, ExerciseDetail, ExerciseDetailsResponse } from '@extension/types';
import { resolveServerUrl } from '@extension/utils';

import { selectRecentCourses } from './recentCourseSelector';

/** Resolved workspace status for an exercise's repos, incl. the matched workspace URI (if any). */
type ExerciseRepoStatus = Awaited<ReturnType<typeof detectWorkspaceForRepoUris>>;

export class ViewInitDataService {
    private _initGeneration = 0;
    private readonly _gitService = new GitService();

    constructor(
        private readonly _appStateManager: AppStateManager,
        private readonly _struggleCoordinator: IStruggleCoordinator | undefined,
        private readonly _messageHandler: WebViewMessageHandler,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        private readonly _handoverFailures: HandoverFailureStore,
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
                hideDeveloperTools: !this._isDeveloperMode(),
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
                hideDeveloperTools: !this._isDeveloperMode(),
            });
        }).catch((error) => {
            if (gen !== this._initGeneration) { return; }
            logger.error('Failed to detect workspace exercise for dashboard', LogCategory.VIEW, error);
            this._postMessage({
                type: ExtensionMsg.DashboardInit,
                courses: recentCourseNodes,
                workspaceExercise: noMatch,
                hideDeveloperTools: !this._isDeveloperMode(),
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

    /**
     * Build the course-detail init payload used by BOTH the sidebar and the
     * fullscreen panel. Pure and total (never rejects): a workspace-detection
     * failure resolves to `workspaceExerciseId: null`.
     */
    public async buildCourseDetailInit(courseData: CourseDetailData): Promise<ExtensionToWebviewMessage> {
        const sources = collectExerciseSources([{
            course: courseData.course,
            exercises: courseData.course.exercises,
        }]);
        let workspaceExerciseId: number | null = null;
        try {
            const detectedExercise = await detectWorkspaceExercise(sources);
            workspaceExerciseId = detectedExercise?.id ?? null;
        } catch (error) {
            logger.error('Failed to detect workspace exercise for course detail', LogCategory.VIEW, error);
            workspaceExerciseId = null;
        }
        return {
            type: ExtensionMsg.CourseDetailInit,
            courseData,
            workspaceExerciseId,
            hideDeveloperTools: !this._isDeveloperMode(),
        };
    }

    public sendCourseDetailInit(): void {
        const courseData = this._appStateManager.currentCourseData;
        if (!courseData) {
            logger.error('Course detail state missing course data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Course data is not available. Please go back and try again.' });
            return;
        }
        const gen = this._initGeneration;
        void this.buildCourseDetailInit(courseData).then((msg) => {
            if (gen !== this._initGeneration) { return; }
            this._postMessage(msg);
        });
    }

    /**
     * Build the exercise-detail init payload used by BOTH the sidebar and the
     * fullscreen panel. Total: it never rejects (a workspace-detection failure
     * resolves to `repoStatus: undefined`) and it never posts, so the caller
     * owns posting and any repo-context wiring. `exerciseData` is passed
     * explicitly — the sidebar hands its app-state exercise, a panel hands its
     * own immutable snapshot.
     *
     * `ticket` is a workspace-mode probe claimed by the caller BEFORE the
     * detection starts. Supplying it makes this the one place that records what
     * the detection found, from in front of the caller's generation check, and
     * the returned `accepted` says whether a newer probe has since spoken. Read-
     * only callers (the fullscreen panel) omit it: they must not record a mode,
     * and their payload is never arbitrated away.
     *
     * The cached server-rendered problem statement lives in global app state, so
     * it is included ONLY when that cache belongs to THIS exercise; otherwise it
     * is omitted and the live `problemStatementRendered` broadcast fills it in.
     */
    public async buildExerciseDetailInit(
        exerciseData: ExerciseDetailsResponse,
        ticket?: number,
    ): Promise<{
        msg: ExtensionToWebviewMessage;
        repoStatus?: ExerciseRepoStatus;
        accepted: boolean;
        detectionFailed: boolean;
    }> {
        const isManagedEnvironment = getTheiaEnvironment().isManagedEnvironment;
        const hideDeveloperTools = !this._isDeveloperMode();
        const exerciseId = exerciseData.exercise?.id;

        const repoUris = (exerciseData.exercise?.studentParticipations ?? [])
            .map(p => p.repositoryUri)
            .filter((uri): uri is string => !!uri);

        let repoStatus: ExerciseRepoStatus | undefined;
        let detectionFailed = false;
        if (repoUris.length > 0) {
            try {
                repoStatus = await detectWorkspaceForRepoUris(repoUris);
            } catch (error) {
                logger.error('Failed to detect workspace status for exercise detail', LogCategory.VIEW, error);
                detectionFailed = true;
            }
        }

        // Recorded here, ahead of the caller's generation check, which answers "may I post the
        // payload I captured", not "is this the freshest thing known about the workspace".
        // A detection that threw records nothing: it must not erase what a newer one established.
        let accepted = true;
        if (ticket !== undefined) {
            if (detectionFailed) {
                accepted = false;
            } else if (repoStatus) {
                accepted = exerciseId === undefined
                    ? false
                    : this._appStateManager.recordWorkspaceMode(ticket, exerciseId, repoStatus.isPracticeRepo).accepted;
            } else {
                // An answer, not a failure: no repository to be in means not the practice one.
                accepted = exerciseId === undefined
                    ? true
                    : this._appStateManager.recordWorkspaceMode(ticket, exerciseId, false).accepted;
            }
        }

        // Read the SSR cache as LATE as possible (after the detection await), so a render that
        // completes while we await does not lose its broadcast to a stale init: an init posted
        // with an older `undefined` snapshot would otherwise clear the just-applied problem
        // statement. Still guarded to THIS exercise via a coherent post-await id snapshot.
        const currentId = this._appStateManager.currentExerciseData?.exercise?.id;
        const serverRenderedProblemStatement =
            currentId !== undefined && currentId === exerciseData.exercise?.id
                ? (this._appStateManager.serverRenderedProblemStatement ?? undefined)
                : undefined;

        return {
            msg: {
                type: ExtensionMsg.ExerciseDetailInit,
                exerciseData,
                hideDeveloperTools,
                isManagedEnvironment,
                // Omitted when a newer probe has spoken, or when the detection threw: the webview
                // then keeps what it has. The "no repositories" case is stated rather than omitted,
                // or the webview keeps a practice status from an earlier exercise while the host
                // has moved to graded.
                repoStatus: !accepted || detectionFailed
                    ? undefined
                    : (repoStatus ?? { isConnected: false, hasChanges: false, isPracticeRepo: false }),
                serverRenderedProblemStatement,
            },
            repoStatus,
            accepted,
            detectionFailed,
        };
    }

    public sendExerciseDetailInit(): void {
        const exerciseData = this._appStateManager.currentExerciseData;
        if (!exerciseData) {
            logger.error('Exercise detail state missing exercise data', LogCategory.VIEW);
            this._postMessage({ type: ExtensionMsg.ViewInitError, error: 'Exercise data is not available. Please go back and try again.' });
            return;
        }

        const gen = this._initGeneration;
        const exerciseId = exerciseData.exercise?.id;
        // Claimed before the detection starts, so the "no repositories" answer cannot be
        // outranked by a probe that started earlier and is still running.
        const ticket = this._appStateManager.beginWorkspaceModeProbe();
        void this.buildExerciseDetailInit(exerciseData, ticket).then(({ msg, repoStatus, accepted, detectionFailed }) => {
            // Repo context lets workspace listeners auto-detect changes on file save, so it is
            // wired up ahead of the generation check as well: the save and rename listeners
            // re-check against this context. A matched repo sets it; "no repositories" clears it;
            // a detection that threw, or one a newer probe has outranked, applies nothing.
            if (accepted) {
                if (repoStatus?.matchedUri && exerciseId !== undefined) {
                    this._messageHandler.setRepositoryContext(repoStatus.matchedUri, exerciseId);
                } else if (!repoStatus && !detectionFailed) {
                    this._messageHandler.clearRepositoryContext();
                }
            }
            if (gen !== this._initGeneration) {
                // The payload is stale, the detection is not. A mode the host accepted has to
                // reach the webview on some channel or the two select differently from here on.
                if (accepted && repoStatus) {
                    this._postMessage({
                        type: ExtensionMsg.UpdateRepoStatus,
                        isConnected: repoStatus.isConnected,
                        hasChanges: repoStatus.hasChanges,
                        isPracticeRepo: repoStatus.isPracticeRepo,
                    });
                }
                return;
            }
            this._postMessage(msg);
        });
    }

    public sendAiConfigInit(): void {
        const aiExtensions = this._appStateManager.aiExtensions || [];
        this._postMessage({ type: ExtensionMsg.AiConfigInit, aiExtensions });
    }

    /**
     * Build the struggle-detection init payload. `embedded` marks the standalone editor-tab copy
     * (the view then hides its back-link, the live chart, and the pop-out button). Exposed so the
     * fullscreen panel can be fed the SAME snapshot the sidebar renders from.
     */
    public buildStruggleDetectionInit(opts: { embedded?: boolean } = {}): ExtensionToWebviewMessage {
        const coordinator = this._struggleCoordinator;
        const snapshot = coordinator?.getSnapshot();
        const developerMode = this._isDeveloperMode();
        return {
            type: ExtensionMsg.StruggleDetectionInit,
            urgency: snapshot?.urgency ?? 0,
            isEnabled: coordinator?.isConsentGranted() ?? false,
            developerMode,
            // Dev dashboard only: the full timers/counters snapshot. Omitted for normal students.
            debug: developerMode ? coordinator?.getDebugSnapshot() : undefined,
            embedded: opts.embedded ?? false,
        };
    }

    public sendStruggleDetectionInit(): void {
        this._postMessage(this.buildStruggleDetectionInit());
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

        // Replayed rather than only announced live. A live message can be queued while the view is not
        // ready and then thrown away by the next `render()`, which a plain configuration change is
        // enough to trigger, and the credential it refers to is still committed. Every new document
        // asks for init, so this is the one channel that cannot be lost that way.
        const failure = this._handoverFailures.current;
        if (failure) {
            this._postMessage({
                type: ExtensionMsg.LoginHandoverFailedInit,
                error: failure.error,
                generation: failure.generation,
            });
        }
    }

    private _isDeveloperMode(): boolean {
        const config = vscode.workspace.getConfiguration('artemis');
        return config.get<boolean>('developerMode', false);
    }
}
