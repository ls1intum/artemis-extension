import * as vscode from 'vscode';

import type { CourseDetailData, ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg, toCourseDetailData } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import type { AppStateManager, UserInfo } from '@extension/controller/appStateManager';
import { fetchAndEnrichExerciseDetails } from '@extension/controller/exerciseDataLoader';
import type { WebViewActionHandler } from '@extension/controller/types';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
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
 * Dependencies for `WebviewNavigationFacade`.
 *
 * Services are passed in as already-constructed instances. The 5 callbacks
 * (postMessage, render, sendInitData, backgroundRenderProblemStatement,
 * getServerUrl) bridge back to the provider, which still owns the webview
 * surface and the SSR coordination path.
 */
export interface WebviewNavigationFacadeDeps {
    appStateManager: AppStateManager;
    artemisApi: ArtemisApiService;
    websocketService: ArtemisWebsocketService;
    exerciseRegistry: ExerciseRegistry;
    courseAccessStorage: CourseAccessStorageService;
    fullscreenPanelManager: FullscreenPanelManager;
    exerciseOpeningService: ExerciseOpeningService;
    startPageResolver: StartPageResolver;
    courseDataCache?: CourseDataCache;
    postMessage: (msg: ExtensionToWebviewMessage) => void;
    render: () => void;
    sendInitData: () => void;
    backgroundRenderProblemStatement: () => void;
    getServerUrl: () => string;
    /** Open the developer struggle view in its own editor tab. Supplied by the provider (which owns the
     *  struggle coordinator behind the @telemetry seam); absent in the clean build. */
    openStruggleFullscreen?: () => void;
}

/**
 * Concentrates all navigation actions and server-URL plumbing that used to
 * live on `ArtemisWebviewProvider`. Implements `WebViewActionHandler` so the
 * webview message handler can route commands here without going through the
 * provider.
 *
 * The facade does not own a `vscode.WebviewView`. All view-level concerns
 * (rendering HTML, posting messages, scheduling SSR) are exposed as callbacks
 * via `WebviewNavigationFacadeDeps`.
 */
export class WebviewNavigationFacade implements WebViewActionHandler {
    constructor(private readonly deps: WebviewNavigationFacadeDeps) { }

    public async openExerciseDetails(exerciseId: number): Promise<void> {
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

        // Fire background server render for progressive enhancement
        this.deps.backgroundRenderProblemStatement();

        // Ensure WebSocket is connected for real-time updates
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
            this.deps.exerciseOpeningService.handleExerciseOpened(exerciseData, exerciseId);
        }
    }

    public async showCourseList(): Promise<void> {
        try {
            // Ensure courses are in the cache before navigating
            if (this.deps.courseDataCache) {
                await this.deps.courseDataCache.fetch();
            }
            this.deps.appStateManager.showCourseList();
            this.deps.render();
        } catch (error) {
            logger.error('Error loading courses', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to load courses');
        }
    }

    public async showDashboard(userInfo: UserInfo): Promise<void> {
        // Set state immediately so concurrent logic sees 'dashboard' during fetch
        this.deps.appStateManager.showDashboard(userInfo);

        // Fetch courses into the shared cache (swallow error - dashboard renders with empty state)
        try {
            await this.deps.courseDataCache?.fetch();
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
                this.deps.appStateManager.injectCourseEntry(archivedEntry);
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
                    this.deps.courseAccessStorage.onCourseAccessed(result.courseId);
                    this.showCourseDetail(detail);
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
        // Send the server URL to the login page for status checking
        this.postServerUrl();
    }

    public showAiConfig(): void {
        // Map installed extensions by ID for quick lookup
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
        // Developer-only page: block navigation entirely when developer mode is off, so the route
        // cannot be reached via the command/action path (the dashboard button is also hidden, but
        // this is the primary gate). The view itself shows a "developer mode only" backstop.
        if (!vscode.workspace.getConfiguration('artemis').get<boolean>('developerMode', false)) {
            logger.warn('showStruggleDetection ignored: developer mode is off (developer-only view)', LogCategory.VIEW);
            return;
        }
        this.deps.appStateManager.showStruggleDetection();
        this.deps.render();
    }

    public showGitCredentials(): void {
        this.deps.appStateManager.showGitCredentials();
        this.deps.render();
    }

    public showCourseDetail(courseData: CourseDetailData): void {
        this.deps.appStateManager.showCourseDetail(courseData);

        // Populate exercise registry with repository URLs for workspace matching
        const registry = this.deps.exerciseRegistry;
        const courseName = courseData?.course?.title || 'Unknown Course';
        logger.info(`Loading course: ${courseName}`, LogCategory.VIEW);

        registry.registerFromCourseData(courseData);

        // Log what was registered
        const allExercises = registry.getAllExercises();
        logger.info(`Registry now contains ${allExercises.length} exercises total`, LogCategory.VIEW);
        if (allExercises.length > 0) {
            logger.debug('Exercises in registry:', LogCategory.VIEW);
            allExercises.forEach(ex => {
                logger.debug(`   - ${ex.id}: ${ex.title}`, LogCategory.VIEW);
                logger.debug(`     Repository: ${ex.repositoryUri}`, LogCategory.VIEW);
            });
        }

        this.deps.render();
    }

    public async openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): Promise<void> {
        this.deps.fullscreenPanelManager.openExerciseFullscreen(exerciseData);
    }

    public async openCourseFullscreen(courseData: CourseDetailData): Promise<void> {
        this.deps.fullscreenPanelManager.openCourseFullscreen(courseData);
    }

    public async openStruggleFullscreen(): Promise<void> {
        // Developer-only page (mirrors showStruggleDetection): block the editor-tab pop-out when
        // developer mode is off, so a stale/replayed command — or toggling dev mode off while the
        // page is already open — cannot open the standalone struggle panel.
        if (!vscode.workspace.getConfiguration('artemis').get<boolean>('developerMode', false)) {
            logger.warn('openStruggleFullscreen ignored: developer mode is off (developer-only view)', LogCategory.VIEW);
            return;
        }
        if (!this.deps.openStruggleFullscreen) {
            // Absent by design in the clean (no-engine) build, where the button is never rendered.
            // If it ever fires there (or a full-build wiring regression drops the opener), surface it
            // instead of silently doing nothing.
            logger.warn('openStruggleFullscreen invoked but no opener is wired (struggle detection unavailable in this build).', LogCategory.VIEW);
            return;
        }
        this.deps.openStruggleFullscreen();
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

    // ── View-callback delegations ──────────────────────────────────────

    public render(): void {
        this.deps.render();
    }

    public sendInitData(): void {
        this.deps.sendInitData();
    }

    public backgroundRenderProblemStatement(): void {
        this.deps.backgroundRenderProblemStatement();
    }

    // ── Server-URL helpers ─────────────────────────────────────────────

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
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);

        // Only suggest if the user is on the default dashboard start page
        const startPage = config.get<string>(VSCODE_CONFIG.START_PAGE_KEY, 'dashboard');
        if (startPage !== 'dashboard') { return; }

        // Check the "don't show again" flag
        if (!config.get<boolean>(VSCODE_CONFIG.SHOW_START_PAGE_SUGGESTION_KEY, true)) { return; }

        // Check if there's a workspace exercise match in the loaded courses
        const repoUrl = await getWorkspaceRepositoryUrl();
        if (!repoUrl) { return; }

        const courses = this.deps.appStateManager.coursesData?.courses || [];
        if (courses.length === 0) { return; }

        const detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources(courses));
        if (!detected) { return; }

        const result = await vscode.window.showInformationMessage(
            `Detected "${detected.title}" in your workspace. You can configure Artemis to open it automatically on login. You can change this later in Settings.`,
            'Always open exercise',
            "Don't show again"
        );

        if (result === 'Always open exercise') {
            await config.update(VSCODE_CONFIG.START_PAGE_KEY, 'workspace-exercise', vscode.ConfigurationTarget.Global);
        } else if (result === "Don't show again") {
            await config.update(VSCODE_CONFIG.SHOW_START_PAGE_SUGGESTION_KEY, false, vscode.ConfigurationTarget.Global);
        }
    }
}
