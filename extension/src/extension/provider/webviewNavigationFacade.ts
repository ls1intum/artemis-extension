import * as vscode from 'vscode';

import type { CourseDetailData, ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg, toCourseDetailData } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import type { AppStateManager, UserInfo } from '@extension/controller/appStateManager';
import { fetchAndEnrichExerciseDetails } from '@extension/controller/exerciseDataLoader';
import type { WebViewActionHandler } from '@extension/controller/types';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { LogCategory, logger } from '@extension/services/loggingService';
import type {
    ExerciseOpeningService,
    FullscreenPanelManager,
    StartPageResolver,
} from '@extension/services/ui';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import {
    collectExerciseSources,
    findExerciseByRepositoryUrl,
    findWorkspaceCourseInArchive,
    getWorkspaceRepositoryUrl,
} from '@extension/services/workspace';
import type { ExerciseDetailsResponse } from '@extension/types';
import {
    AI_EXTENSIONS_BLOCKLIST,
    getRecommendedExtensionsByCategory,
    VSCODE_CONFIG,
} from '@extension/utils';

/**
 * Dependencies for `WebviewNavigationFacade`. The callbacks bridge back to the
 * provider, which owns the webview surface and the SSR coordination path.
 */
export interface WebviewNavigationFacadeDeps {
    appStateManager: AppStateManager;
    artemisApi: ArtemisApiService;
    websocketService: ArtemisWebsocketService;
    courseAccessStorage: CourseAccessStorageService;
    fullscreenPanelManager: FullscreenPanelManager;
    exerciseOpeningService: ExerciseOpeningService;
    startPageResolver: StartPageResolver;
    courseCatalog?: CourseCatalog;
    postMessage: (msg: ExtensionToWebviewMessage) => void;
    render: () => void;
    sendInitData: () => void;
    backgroundRenderProblemStatement: () => void;
    getServerUrl: () => string;
}

/**
 * Concentrates all navigation actions and server-URL plumbing. Implements
 * `WebViewActionHandler` so the webview message handler can route commands here
 * without going through `ArtemisWebviewProvider`.
 *
 * The facade does not own a `vscode.WebviewView`. All view-level concerns
 * (rendering HTML, posting messages, scheduling SSR) are exposed as callbacks
 * via `WebviewNavigationFacadeDeps`.
 */
export class WebviewNavigationFacade implements WebViewActionHandler {
    constructor(private readonly deps: WebviewNavigationFacadeDeps) { }

    public async openExerciseDetails(exerciseId: number): Promise<void> {
        // Captured before the fetch below, not after it: the supplemental
        // write at the end of this method carries it, and reading it there
        // would stamp an identity change that happened mid-fetch onto data
        // this session never asked for.
        const epoch = this.deps.courseCatalog?.currentEpoch ?? 0;
        // Split fetch failures (user-facing I/O errors) from state-transition
        // failures (programmer errors that violate the navigation invariant):
        // only the fetch is caught and user-reported; invariant breaks propagate.
        let data: ExerciseDetailsResponse;
        try {
            data = await fetchAndEnrichExerciseDetails(this.deps.artemisApi, exerciseId);
        } catch (error) {
            logger.error('Error fetching exercise details:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to fetch exercise details');
            return;
        }
        this.deps.appStateManager.showExerciseDetail(data);
        this.deps.render();

        this.deps.backgroundRenderProblemStatement();

        if (this.deps.websocketService && !this.deps.websocketService.isConnected()) {
            logger.websocket('Exercise opened - ensuring WebSocket connection for real-time updates...');
            try {
                await this.deps.websocketService.connect();
            } catch (error) {
                logger.websocketWarn('Failed to connect WebSocket', error);
            }
        }

        // Handle post-open side effects (registry, telemetry, chat notify).
        const exerciseData = this.deps.appStateManager.currentExerciseData;
        if (exerciseData?.exercise) {
            this.deps.exerciseOpeningService.handleExerciseOpened(exerciseData, exerciseId, epoch);
        }
    }

    public async showCourseList(): Promise<void> {
        try {
            if (this.deps.courseCatalog) {
                await this.deps.courseCatalog.fetch();
            }
            this.deps.appStateManager.showCourseList();
            this.deps.render();
        } catch (error) {
            logger.error('Error loading courses', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to load courses');
        }
    }

    public async showDashboard(userInfo: UserInfo): Promise<void> {
        // Captured before anything is awaited, because the archive search below
        // is the longest-running producer in the extension: it issues one
        // detail request per archived course, and a logout, a 401 or a
        // server-URL change during it must not let the old server's course
        // into the new session.
        const epoch = this.deps.courseCatalog?.currentEpoch ?? 0;
        // Set state immediately so concurrent logic sees 'dashboard' during fetch
        this.deps.appStateManager.showDashboard(userInfo);

        // Error swallowed: the dashboard renders with an empty state.
        try {
            await this.deps.courseCatalog?.fetch();
        } catch (error) {
            logger.error('Error loading courses for dashboard', LogCategory.VIEW, error);
        }

        this.deps.render();

        // Check archived courses in the background.
        // Flag prevents sendDashboardInit from publishing workspace result too early.
        this.deps.appStateManager.archiveCheckComplete = false;
        void findWorkspaceCourseInArchive(
            this.deps.artemisApi, this.deps.appStateManager.coursesData?.courses || []
        ).then(archivedEntry => {
            if (archivedEntry) {
                this.deps.appStateManager.injectCourseEntry(archivedEntry, epoch);
            }
        }).catch((err: unknown) => {
            logger.error('Failed to check archived courses for dashboard', LogCategory.VIEW, err);
        }).finally(() => {
            this.deps.appStateManager.archiveCheckComplete = true;
            this.deps.sendInitData();
            void this._suggestWorkspaceStartPage().catch((err: unknown) => {
                logger.error('Failed to suggest workspace start page', LogCategory.VIEW, err);
            });
        });
    }

    public async navigateToStartPage(userInfo: UserInfo): Promise<void> {
        // Everything `resolve()` returns was fetched under THIS session, so
        // the epoch that guards writing it back has to be read before the
        // request, not after the answer.
        const epoch = this.deps.courseCatalog?.currentEpoch ?? 0;
        const result = await this.deps.startPageResolver.resolve();

        switch (result.type) {
            case 'course-list':
                this.deps.appStateManager.seedAuthenticatedSession(userInfo);
                this.deps.appStateManager.showCourseList();
                this.deps.render();
                return;

            case 'workspace-exercise': {
                this.deps.appStateManager.seedAuthenticatedSession(userInfo);
                const entry = result.allCourses.find(e => e.course?.id === result.courseId);
                const detail = toCourseDetailData(entry?.course);
                if (detail) {
                    this.deps.appStateManager.showCourseDetail(detail);
                    this.deps.postMessage({ type: ExtensionMsg.UpdateLoading, message: 'Loading exercise...' });
                    await this.openExerciseDetails(result.exerciseId);
                    if (this.deps.appStateManager.currentState === 'exercise-detail') {
                        return;
                    }
                } else {
                    logger.viewError(`workspace-exercise start: course ${result.courseId} resolved without a valid id; falling back to dashboard`);
                }
                break;
            }

            case 'workspace-course': {
                this.deps.appStateManager.seedAuthenticatedSession(userInfo);
                const entry = result.allCourses.find(e => e.course?.id === result.courseId);
                const detail = toCourseDetailData(entry?.course);
                if (detail) {
                    this.deps.courseAccessStorage.onCourseAccessed(result.courseId, epoch);
                    this.showCourseDetail(detail, epoch);
                    return;
                }
                logger.viewError(`workspace-course start: course ${result.courseId} resolved without a valid id; falling back to dashboard`);
                break;
            }

            case 'dashboard':
                break;
        }

        // Default: full dashboard with archive check
        await this.showDashboard(userInfo);
    }

    public showLogin(): void {
        this.deps.appStateManager.showLogin();
        this.deps.render();
        // The login page needs the server URL for its status check.
        this.postServerUrl();
    }

    public showAiConfig(): void {
        const installedExtensions = new Map<string, vscode.Extension<unknown>>();
        for (const ext of vscode.extensions.all) {
            installedExtensions.set(ext.id.toLowerCase(), ext);
        }

        const aiExtensions = Object.entries(AI_EXTENSIONS_BLOCKLIST)
            .flatMap(([providerName, providerData]) => {
                return providerData.extensions.map(blocklistExt => {
                    const installedExt = installedExtensions.get(blocklistExt.id.toLowerCase());
                    const packageJson = (installedExt?.packageJSON ?? {}) as { publisher?: string; version?: string };

                    return {
                        id: blocklistExt.id,
                        name: blocklistExt.name,
                        publisher: packageJson.publisher ?? 'Not installed',
                        version: packageJson.version ?? '-',
                        description: blocklistExt.description,
                        isInstalled: installedExt !== undefined,
                        provider: providerName,
                        providerColor: providerData.color
                    };
                });
            });

        this.deps.appStateManager.showAiConfig(aiExtensions);
        this.deps.render();
    }

    public showRecommendedExtensions(): void {
        const installedExtensions = new Map<string, vscode.Extension<unknown>>();
        for (const ext of vscode.extensions.all) {
            installedExtensions.set(ext.id.toLowerCase(), ext);
        }

        const recommendedCategories = getRecommendedExtensionsByCategory().map(category => ({
            ...category,
            extensions: category.extensions.map(extension => {
                const installedExt = installedExtensions.get(extension.id.toLowerCase());
                const packageJson = (installedExt?.packageJSON ?? {}) as { version?: string };

                return {
                    ...extension,
                    isInstalled: installedExt !== undefined,
                    version: packageJson.version ?? extension.version
                };
            })
        }));

        this.deps.appStateManager.showRecommendedExtensions(recommendedCategories);
        this.deps.render();
    }

    public showServiceStatus(): void {
        this.deps.appStateManager.showServiceStatus();
        this.deps.render();
    }

    public showStruggleDetection(): void {
        this.deps.appStateManager.showStruggleDetection();
        this.deps.render();
    }

    public showGitCredentials(): void {
        this.deps.appStateManager.showGitCredentials();
        this.deps.render();
    }

    /**
     * `epoch` is a parameter rather than a live read, and required rather than
     * defaulted: the only caller reaches this after awaiting the fetch that
     * produced `courseData`, so the generation that data belongs to is the
     * caller's to remember.
     */
    public showCourseDetail(courseData: CourseDetailData, epoch: number): void {
        this.deps.appStateManager.showCourseDetail(courseData);

        // The registry is rebuilt destructively from the catalog projection on
        // every catalog write, so a direct registry write here would be dropped
        // by the next one with nothing to restore it. Write the catalog
        // instead; `courseData.course` already matches `CourseDashboardCourse`.
        this.deps.courseCatalog?.upsertSupplemental({ kind: 'course', entry: { course: courseData.course } }, epoch);

        this.deps.render();
    }

    public async openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): Promise<void> {
        this.deps.fullscreenPanelManager.openExerciseFullscreen(exerciseData);
    }

    public async openCourseFullscreen(courseData: CourseDetailData): Promise<void> {
        this.deps.fullscreenPanelManager.openCourseFullscreen(courseData);
    }

    public async openCourseListFullscreen(): Promise<void> {
        const coursesData = this.deps.appStateManager.coursesData;
        const courses = coursesData?.courses || [];
        const archivedCourses = this.deps.appStateManager.archivedCoursesData || undefined;

        const mappedCourses: CourseDetailData[] = courses.flatMap((entry) => {
            const detail = toCourseDetailData(entry.course);
            if (!detail) {
                logger.warn(`Course list fullscreen: dropping course without numeric id (title=${entry.course?.title ?? '<unknown>'})`, LogCategory.VIEW);
                return [];
            }
            return [detail];
        });

        this.deps.fullscreenPanelManager.openCourseListFullscreen(mappedCourses, archivedCourses);
    }

    public async openJsonInEditor(data: Record<string, unknown>): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument({
                content: JSON.stringify(data, null, 2),
                language: 'json',
            });
            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One,
            });
        } catch (error) {
            logger.error('Error opening JSON in editor:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to open JSON in editor');
        }
    }

    public render(): void {
        this.deps.render();
    }

    public sendInitData(): void {
        this.deps.sendInitData();
    }

    public backgroundRenderProblemStatement(): void {
        this.deps.backgroundRenderProblemStatement();
    }

    /**
     * Public because the provider's AuthFlowHandler callback bag invokes this
     * through the facade reference. No other call sites exist.
     */
    public hideLoadingAndSendServerUrl(): void {
        this.deps.postMessage({ type: ExtensionMsg.HideLoading });
        this.postServerUrl();
    }

    private postServerUrl(serverUrl?: string): void {
        this.deps.postMessage({
            type: ExtensionMsg.SetServerUrl,
            serverUrl: serverUrl ?? this.deps.getServerUrl(),
        });
    }

    /**
     * Shows a one-time notification suggesting workspace-aware start page
     * when a workspace exercise is detected on the dashboard.
     */
    private async _suggestWorkspaceStartPage(): Promise<void> {
        if (!this._isStartPageSuggestionWanted()) { return; }

        const repoUrl = await getWorkspaceRepositoryUrl();
        if (!repoUrl) { return; }

        const courses = this.deps.appStateManager.coursesData?.courses || [];
        if (courses.length === 0) { return; }

        const detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources(courses));
        if (!detected) { return; }

        // The lookup above spawns git, which is long enough for the student to configure the
        // start page themselves. Suggesting what they just did would be wrong, and accepting
        // the suggestion would overwrite their choice.
        if (!this._isStartPageSuggestionWanted()) { return; }

        const result = await vscode.window.showInformationMessage(
            `Detected "${detected.title}" in your workspace. You can configure Artemis to open it automatically on login. You can change this later in Settings.`,
            'Always open exercise',
            "Don't show again"
        );

        if (result === 'Always open exercise') {
            await vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
                .update(VSCODE_CONFIG.START_PAGE_KEY, 'workspace-exercise', vscode.ConfigurationTarget.Global);
        } else if (result === "Don't show again") {
            await vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
                .update(VSCODE_CONFIG.SHOW_START_PAGE_SUGGESTION_KEY, false, vscode.ConfigurationTarget.Global);
        }
    }

    /**
     * Whether the student is still on the default start page and has not silenced the suggestion.
     *
     * Reads the settings fresh on every call, so a caller can re-check them across an await.
     */
    private _isStartPageSuggestionWanted(): boolean {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.START_PAGE_KEY, 'dashboard') === 'dashboard'
            && config.get<boolean>(VSCODE_CONFIG.SHOW_START_PAGE_SUGGESTION_KEY, true);
    }
}
