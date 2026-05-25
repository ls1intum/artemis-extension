import * as vscode from 'vscode';

import type { CourseDetailData, ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, toCourseDetailData } from '@shared/messageContracts';
import type {
    TaskFeedbackClosedPayload,
    TaskFeedbackOpenedPayload,
    TestResultsOverviewClosedPayload,
    TestResultsOverviewOpenedPayload,
} from '@shared/messageContracts/webviewCommands';

import { ArtemisApiService } from '@extension/api';
import { AppStateManager, type UserInfo } from '@extension/controller/appStateManager';
import { fetchAndEnrichExerciseDetails } from '@extension/controller/exerciseDataLoader';
import type { WebViewActionHandler } from '@extension/controller/types';
import { getViewHtml } from '@extension/controller/viewRouter';
import { WebViewMessageHandler } from '@extension/controller/webViewMessageHandler';
import { AuthFlowHandler, AuthManager } from '@extension/services/auth';
import { type CourseAccessScope, CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ProblemStatementRenderService } from '@extension/services/problemStatementRenderService';
import type { TelemetryManager } from '@extension/services/telemetry';
import type { IProviderRegistry } from '@extension/services/ui';
import {
    BuildDiagnosticsService,
    ExerciseOpeningService,
    FullscreenPanelManager,
    StartPageResolver,
    SubmissionWebSocketHandler,
    ViewInitDataService,
} from '@extension/services/ui';
import { ArtemisWebsocketService } from '@extension/services/websocket';
import {
    collectExerciseSources,
    findExerciseByRepositoryUrl,
    findWorkspaceCourseInArchive,
    getWorkspaceRepositoryUrl,
} from '@extension/services/workspace';
import type { ExerciseDetailsResponse } from '@extension/types';
import { WebSocketMessageHandler } from '@extension/types';
import type { IArtemisWebviewProvider } from '@extension/types/IArtemisWebviewProvider';
import {
    AI_EXTENSIONS_BLOCKLIST,
    CONFIG,
    getRecommendedExtensionsByCategory,
    resolveServerUrl,
    VSCODE_CONFIG,
} from '@extension/utils';

import type { ArtemisWebviewProviderDeps } from './artemisWebviewProviderDeps';
import { BaseWebviewProvider } from './baseWebviewProvider';

/**
 * Main webview provider for the Artemis sidebar panel.
 *
 * NOTE: This class (~1100 lines) coordinates view lifecycle, message routing,
 * state sync, and service integration. A future refactor could extract
 * render-data preparation into a dedicated ViewDataService.
 */
export class ArtemisWebviewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider, WebViewActionHandler, vscode.Disposable, IArtemisWebviewProvider {
    // ── Static properties ──────────────────────────────────────────────
    public static readonly viewType = CONFIG.WEBVIEW.VIEW_TYPE;

    // ── Instance properties ────────────────────────────────────────────
    private readonly _extensionUri: vscode.Uri;
    private readonly _extensionContext: vscode.ExtensionContext;
    private readonly _authManager: AuthManager;
    private readonly _artemisApi: ArtemisApiService;
    private readonly _exerciseRegistry: ExerciseRegistry;
    private readonly _providerRegistry: IProviderRegistry;
    private readonly _courseDataCache?: CourseDataCache;
    private _appStateManager: AppStateManager;
    private _messageHandler: WebViewMessageHandler;
    private _viewInitDataService: ViewInitDataService;
    private _submissionWsHandler: SubmissionWebSocketHandler;
    private _fullscreenPanelManager: FullscreenPanelManager;
    private _authFlowHandler: AuthFlowHandler;
    private _buildDiagnosticsService: BuildDiagnosticsService;
    private _exerciseOpeningService: ExerciseOpeningService;
    private _startPageResolver: StartPageResolver;
    private readonly _courseAccessStorage: CourseAccessStorageService;
    private readonly _authContextUpdater: (isAuthenticated: boolean) => Promise<void>;
    private readonly _websocketService: ArtemisWebsocketService;
    private _websocketHandler: WebSocketMessageHandler;
    private readonly _telemetryManager: TelemetryManager;
    private readonly _renderService: ProblemStatementRenderService;

    private readonly _onDidChangeViewNavigation = new vscode.EventEmitter<{ from: string; to: string }>();
    public readonly onDidChangeViewNavigation = this._onDidChangeViewNavigation.event;

    private readonly _onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    public readonly onDidChangePanelVisibility = this._onDidChangePanelVisibility.event;

    private readonly _onDidOpenTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewOpenedPayload>();
    private readonly _onDidCloseTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewClosedPayload>();
    private readonly _onDidOpenTaskFeedback = new vscode.EventEmitter<TaskFeedbackOpenedPayload>();
    private readonly _onDidCloseTaskFeedback = new vscode.EventEmitter<TaskFeedbackClosedPayload>();

    public readonly onDidOpenTestResultsOverview = this._onDidOpenTestResultsOverview.event;
    public readonly onDidCloseTestResultsOverview = this._onDidCloseTestResultsOverview.event;
    public readonly onDidOpenTaskFeedback = this._onDidOpenTaskFeedback.event;
    public readonly onDidCloseTaskFeedback = this._onDidCloseTaskFeedback.event;

    // ── Constructor ────────────────────────────────────────────────────
    constructor(deps: ArtemisWebviewProviderDeps) {
        super();
        this._extensionUri = deps.extensionUri;
        this._extensionContext = deps.extensionContext;
        this._authManager = deps.authManager;
        this._artemisApi = deps.artemisApi;
        this._exerciseRegistry = deps.exerciseRegistry;
        this._providerRegistry = deps.providerRegistry;
        this._websocketService = deps.websocketService;
        this._telemetryManager = deps.telemetryManager;
        this._authContextUpdater = deps.updateAuthContext;
        this._courseDataCache = deps.courseDataCache;
        const buildErrorCodeLensProvider = deps.buildErrorCodeLensProvider;

        this._appStateManager = new AppStateManager();
        if (this._courseDataCache) {
            this._appStateManager.setCourseDataCache(this._courseDataCache);
        }
        this._courseAccessStorage = new CourseAccessStorageService(
            this._extensionContext.globalState,
            () => this._currentCourseAccessScope(),
        );
        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._appStateManager,
            this,
            this._extensionContext,
            this._exerciseRegistry,
            this._providerRegistry,
            this._websocketService,
            this._courseDataCache,
            this._courseAccessStorage,
        );
        this._messageHandler.setAuthContextUpdater(this._authContextUpdater);
        this._viewInitDataService = new ViewInitDataService(
            this._appStateManager,
            this._telemetryManager,
            this._messageHandler,
            (msg) => this._postMessageSafe(msg),
            this._courseAccessStorage,
        );
        this._renderService = new ProblemStatementRenderService(this._artemisApi);
        this._disposables.push(this._renderService);
        this._buildDiagnosticsService = new BuildDiagnosticsService(this._artemisApi);
        this._buildDiagnosticsService.setCodeLensProvider(buildErrorCodeLensProvider);
        this._exerciseOpeningService = new ExerciseOpeningService(
            this._exerciseRegistry,
            this._providerRegistry,
            this._telemetryManager,
            this._courseAccessStorage,
        );
        this._startPageResolver = new StartPageResolver(this._artemisApi, this._courseDataCache);
        this._submissionWsHandler = new SubmissionWebSocketHandler(
            (msg) => this._postMessageSafe(msg),
            (result) => this._buildDiagnosticsService.handleBuildResult(result),
        );
        this._fullscreenPanelManager = new FullscreenPanelManager(
            this._extensionUri,
            this._extensionContext,
            () => this._messageHandler,
        );
        this._authFlowHandler = new AuthFlowHandler(
            this._authManager,
            this._artemisApi,
            () => this._authContextUpdater,
            (msg) => this._postMessageSafe(msg),
            {
                onAuthenticated: (userInfo) => this.navigateToStartPage(userInfo),
                hideLoadingAndSendServerUrl: () => this.hideLoadingAndSendServerUrl(),
                showLogin: () => this.showLogin(),
            },
        );

        // Wire WebSocket subscription handler
        this._websocketHandler = this._submissionWsHandler.createHandler();
        this._websocketService.registerMessageHandler(this._websocketHandler);

        this._appStateManager.onStateChange = (from, to) => {
            this._onDidChangeViewNavigation.fire({ from, to });
        };

        this._disposables.push(this._onDidChangeViewNavigation);
        this._disposables.push(this._onDidChangePanelVisibility);
        this._disposables.push(
            this._onDidOpenTestResultsOverview,
            this._onDidCloseTestResultsOverview,
            this._onDidOpenTaskFeedback,
            this._onDidCloseTaskFeedback,
        );

        // Re-render SSR when VS Code theme changes (darkMode parameter differs)
        this._disposables.push(
            vscode.window.onDidChangeActiveColorTheme(() => {
                this._renderService.invalidateAll();
                this._appStateManager.serverRenderedProblemStatement = null;
                this._backgroundRenderProblemStatement();
            }),
        );
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    public dispose(): void {
        this._messageHandler.dispose();
        if (this._websocketService && this._websocketHandler) {
            this._websocketService.unregisterMessageHandler(this._websocketHandler);
        }
        this._drainDisposables();
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._drainViewDisposables();
        this._view = webviewView;

        this._resetReadyState();

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,

            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'media'),
            ]
        };

        webviewView.webview.html = getViewHtml(this._appStateManager.currentState, this._extensionContext.extensionUri, webviewView.webview);

        // Set up message sender for the message handler (using safe posting)
        this._messageHandler.setMessageSender((message: ExtensionToWebviewMessage) => {
            this._postMessageSafe(message);
        });

        // Check if server URL has changed and clear credentials if needed
        this._authFlowHandler.checkServerUrlChange();

        // Check for existing authentication and auto-login if valid
        this._authFlowHandler.checkExistingAuthentication();

        // Handle messages from the webview using the message handler
        const messageListener = webviewView.webview.onDidReceiveMessage(message => {
            this._handleMessage(message);
        });
        this._viewDisposables.push(messageListener);

        // Handle visibility changes — resend data when panel becomes visible
        const visibilityListener = webviewView.onDidChangeVisibility(() => {
            this._onDidChangePanelVisibility.fire(webviewView.visible);
            if (webviewView.visible) {
                void (async () => {
                    // Check if auth expired while panel was hidden
                    const hasAuth = await this._authManager.hasAuthToken();
                    const currentState = this._appStateManager.currentState;
                    if (!hasAuth && currentState !== 'login') {
                        logger.debug('Auth expired while panel was hidden, showing login', LogCategory.VIEW);
                        this.showLogin();
                        return;
                    }

                    // Re-fetch exercise data to capture any WebSocket updates missed while hidden.
                    // Swallow fetch errors only — state-transition errors (invariant breaches)
                    // must propagate so latent bugs don't get hidden by this refresh path.
                    if (currentState === 'exercise-detail') {
                        const exerciseData = this._appStateManager.currentExerciseData;
                        const exerciseId = exerciseData?.exercise?.id;
                        if (exerciseId) {
                            let freshData: ExerciseDetailsResponse | undefined;
                            try {
                                freshData = await fetchAndEnrichExerciseDetails(this._artemisApi, exerciseId);
                            } catch { /* fall through to sendInitData with cached data */ }
                            if (freshData) {
                                this._appStateManager.showExerciseDetail(freshData);
                            }
                        }
                    }

                    logger.debug('Sidebar webview became visible, resending view data...', LogCategory.VIEW);
                    this.sendInitData();
                })().catch(err => {
                    logger.error('Error in visibility change handler', LogCategory.VIEW, err);
                });
            } else {
                logger.debug('Sidebar webview became hidden', LogCategory.VIEW);
            }
        });
        this._viewDisposables.push(visibilityListener);

        // Listen for configuration changes to re-render when settings change
        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.refreshTheme();
            }
        });
        this._viewDisposables.push(configListener);
    }

    // ── Rendering ──────────────────────────────────────────────────────

    /**
     * Helper method to render the webview HTML
     */
    public render(): void {
        if (this._view) {
            this._resetReadyState();
            this._view.webview.html = getViewHtml(this._appStateManager.currentState, this._extensionContext.extensionUri, this._view.webview);
        }
    }

    // ── Init data ──────────────────────────────────────────────────────

    /**
     * Send current view data to the webview without re-rendering.
     * Called on ready signal, visibility change, and after navigation state updates.
     */
    public sendInitData(): void {
        this._viewInitDataService.sendInitData();
    }

    public backgroundRenderProblemStatement(): void {
        this._backgroundRenderProblemStatement();
    }

    // ── IArtemisWebviewProvider: fire methods ──────────────────────────

    public fireTestResultsOverviewOpened(payload: TestResultsOverviewOpenedPayload): void {
        this._onDidOpenTestResultsOverview.fire(payload);
    }

    public fireTestResultsOverviewClosed(payload: TestResultsOverviewClosedPayload): void {
        this._onDidCloseTestResultsOverview.fire(payload);
    }

    public fireTaskFeedbackOpened(payload: TaskFeedbackOpenedPayload): void {
        this._onDidOpenTaskFeedback.fire(payload);
    }

    public fireTaskFeedbackClosed(payload: TaskFeedbackClosedPayload): void {
        this._onDidCloseTaskFeedback.fire(payload);
    }

    // ── Public API ─────────────────────────────────────────────────────

    // WebViewActionHandler interface implementation
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

    public async openExerciseDetails(exerciseId: number): Promise<void> {
        // Split fetch failures (user-facing I/O errors) from state-transition
        // failures (programmer errors that violate the navigation invariant):
        // only the fetch is caught and user-reported; invariant breaks propagate.
        let data: ExerciseDetailsResponse;
        try {
            data = await fetchAndEnrichExerciseDetails(this._artemisApi, exerciseId);
        } catch (error) {
            logger.error('Error fetching exercise details:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to fetch exercise details');
            return;
        }
        this._appStateManager.showExerciseDetail(data);
        this.render();

        // Fire background server render for progressive enhancement
        this._backgroundRenderProblemStatement();

        // Ensure WebSocket is connected for real-time updates
        if (this._websocketService && !this._websocketService.isConnected()) {
            logger.websocket('Exercise opened - ensuring WebSocket connection for real-time updates...');
            try {
                await this._websocketService.connect();
            } catch (error) {
                logger.websocketWarn('Failed to connect WebSocket', error);
            }
        }

        // Handle post-open side effects (registry, telemetry, chat notify).
        const exerciseData = this._appStateManager.currentExerciseData;
        if (exerciseData?.exercise) {
            this._exerciseOpeningService.handleExerciseOpened(exerciseData, exerciseId);
        }
    }

    public async showDashboard(userInfo: UserInfo): Promise<void> {
        // Set state immediately so concurrent logic sees 'dashboard' during fetch
        this._appStateManager.showDashboard(userInfo);

        // Fetch courses into the shared cache (swallow error — dashboard renders with empty state)
        try {
            await this._courseDataCache?.fetch();
        } catch (error) {
            logger.error('Error loading courses for dashboard', LogCategory.VIEW, error);
        }

        if (this._view) {
            this.render();
        }

        // Check archived courses in the background.
        // Flag prevents sendDashboardInit from publishing workspace result too early.
        this._appStateManager.archiveCheckComplete = false;
        void findWorkspaceCourseInArchive(
            this._artemisApi, this._appStateManager.coursesData?.courses || []
        ).then(archivedEntry => {
            if (archivedEntry) {
                this._appStateManager.injectCourseEntry(archivedEntry);
            }
        }).catch((err: unknown) => {
            logger.error('Failed to check archived courses for dashboard', LogCategory.VIEW, err);
        }).finally(() => {
            this._appStateManager.archiveCheckComplete = true;
            this.sendInitData();
            void this._suggestWorkspaceStartPage().catch((err: unknown) => {
                logger.error('Failed to suggest workspace start page', LogCategory.VIEW, err);
            });
        });
    }

    public async navigateToStartPage(userInfo: UserInfo): Promise<void> {
        const result = await this._startPageResolver.resolve();

        switch (result.type) {
            case 'course-list':
                this._appStateManager.seedAuthenticatedSession(userInfo);
                this._appStateManager.showCourseList();
                if (this._view) { this.render(); }
                return;

            case 'workspace-exercise': {
                this._appStateManager.seedAuthenticatedSession(userInfo);
                const entry = result.allCourses.find(e => e.course?.id === result.courseId);
                const detail = toCourseDetailData(entry?.course);
                if (detail) {
                    this._appStateManager.showCourseDetail(detail);
                    this._postMessageSafe({ type: ExtensionMsg.UpdateLoading, message: 'Loading exercise...' });
                    await this.openExerciseDetails(result.exerciseId);
                    if (this._appStateManager.currentState === 'exercise-detail') {
                        return;
                    }
                } else {
                    logger.viewError(`workspace-exercise start: course ${result.courseId} resolved without a valid id; falling back to dashboard`);
                }
                break;
            }

            case 'workspace-course': {
                this._appStateManager.seedAuthenticatedSession(userInfo);
                const entry = result.allCourses.find(e => e.course?.id === result.courseId);
                const detail = toCourseDetailData(entry?.course);
                if (detail) {
                    this._courseAccessStorage.onCourseAccessed(result.courseId);
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
        this._appStateManager.showLogin();
        if (this._view) {
            this.render();

            // Send the server URL to the login page for status checking
            this.postServerUrl();
        }
    }

    public async showCourseList(): Promise<void> {
        try {
            // Ensure courses are in the cache before navigating
            if (this._courseDataCache) {
                await this._courseDataCache.fetch();
            }
            this._appStateManager.showCourseList();
            if (this._view) {
                this.render();
            }
        } catch (error) {
            logger.error('Error loading courses', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to load courses');
        }
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
                        version: packageJson.version ?? '—',
                        description: blocklistExt.description,
                        isInstalled: installedExt !== undefined,
                        provider: providerName,
                        providerColor: providerData.color
                    };
                });
            });

        this._appStateManager.showAiConfig(aiExtensions);
        if (this._view) {
            this.render();
        }
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

        this._appStateManager.showRecommendedExtensions(recommendedCategories);
        if (this._view) {
            this.render();
        }
    }

    public showServiceStatus(): void {
        this._appStateManager.showServiceStatus();
        if (this._view) {
            this.render();
        }
    }

    public showStruggleDetection(): void {
        this._appStateManager.showStruggleDetection();
        if (this._view) {
            this.render();
        }
    }

    public showGitCredentials(): void {
        this._appStateManager.showGitCredentials();
        if (this._view) {
            this.render();
        }
    }

    public showCourseDetail(courseData: CourseDetailData): void {
        this._appStateManager.showCourseDetail(courseData);

        // Populate exercise registry with repository URLs for workspace matching
        const registry = this._exerciseRegistry;
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

        if (this._view) {
            this.render();
        }
    }

    public async openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): Promise<void> {
        this._fullscreenPanelManager.openExerciseFullscreen(exerciseData);
    }

    public async openCourseFullscreen(courseData: CourseDetailData): Promise<void> {
        this._fullscreenPanelManager.openCourseFullscreen(courseData);
    }

    public async openCourseListFullscreen(): Promise<void> {
        const coursesData = this._appStateManager.coursesData;
        const courses = coursesData?.courses || [];
        const archivedCourses = this._appStateManager.archivedCoursesData || undefined;

        const mappedCourses: CourseDetailData[] = courses.flatMap((entry) => {
            const detail = toCourseDetailData(entry.course);
            if (!detail) {
                logger.warn(`Course list fullscreen: dropping course without numeric id (title=${entry.course?.title ?? '<unknown>'})`, LogCategory.VIEW);
                return [];
            }
            return [detail];
        });

        this._fullscreenPanelManager.openCourseListFullscreen(mappedCourses, archivedCourses);
    }

    // ── BaseWebviewProvider hooks ──────────────────────────────────────

    protected _onReady(): void {
        this.sendInitData();
    }

    protected _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void {
        this._messageHandler.handleMessage(message);
    }

    // ── Private: Helpers ───────────────────────────────────────────────

    private postServerUrl(serverUrl?: string): void {
        this._postMessageSafe({
            type: ExtensionMsg.SetServerUrl,
            serverUrl: serverUrl ?? this._getServerUrl()
        });
    }

    private hideLoadingAndSendServerUrl(): void {
        this._postMessageSafe({ type: ExtensionMsg.HideLoading });
        this.postServerUrl();
    }

    private _getServerUrl(): string {
        return resolveServerUrl();
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

        const courses = this._appStateManager.coursesData?.courses || [];
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

    private _currentCourseAccessScope(): CourseAccessScope | null {
        const info = this._appStateManager.userInfo;
        if (!info) { return null; }
        const serverUrl = info.serverUrl || resolveServerUrl();
        if (!serverUrl) { return null; }
        return {
            serverUrl,
            principal: { id: info.user?.id, login: info.username || info.user?.login },
        };
    }

    // ── Server-side problem statement rendering ─────────────────────

    private async _backgroundRenderProblemStatement(): Promise<void> {
        // SSR is for the exercise detail view only.
        if (this._appStateManager.currentState !== 'exercise-detail') { return; }

        const exerciseData = this._appStateManager.currentExerciseData;
        if (!exerciseData?.exercise?.problemStatement) {
            logger.info('[SSR] No exercise data or problemStatement, skipping', LogCategory.GENERAL);
            return;
        }

        const exercise = exerciseData.exercise;
        const exerciseId = exercise.id;
        const participation = exercise.studentParticipations?.[0];

        logger.info(`[SSR] Starting background render for exercise ${exerciseId}`, LogCategory.GENERAL);

        try {
            const rendered = await this._renderService.render(exercise, { participation });

            // Guard: verify same exercise is still active after await
            const current = this._appStateManager.currentExerciseData;
            if (current?.exercise?.id !== exerciseId) { return; }

            if (rendered) {
                // Store in app state so sendExerciseDetailInit includes it
                this._appStateManager.serverRenderedProblemStatement = {
                    html: rendered.html,
                };
                // Also send as separate message for cases where init was already sent
                this._postMessageSafe({
                    type: ExtensionMsg.ProblemStatementRendered,
                    html: rendered.html,
                });
                logger.info(`[SSR] Server render cached + sent (hash: ${rendered.contentHash.slice(0, 8)})`, LogCategory.GENERAL);
            }
        } catch (error) {
            logger.info(`[SSR] Background render failed: ${error}`, LogCategory.GENERAL);
        }
    }

}
