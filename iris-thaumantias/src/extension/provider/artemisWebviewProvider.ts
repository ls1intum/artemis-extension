import * as vscode from 'vscode';
import { ArtemisApiService } from '../api';
import { AuthManager, AuthFlowHandler } from '../services/auth';
import { ArtemisWebsocketService, SubmissionWebSocketHandler } from '../services/websocket';
import { ViewInitDataService, FullscreenPanelManager, BuildDiagnosticsService, ExerciseOpeningService, StartPageResolver } from '../services/ui';
import type { IProviderRegistry } from '../services/ui';
import type { StartPageResult } from '../services/ui';
import { ExerciseRegistry } from '../services/exerciseRegistry';
import { findWorkspaceCourseInArchive, collectExerciseSources, getWorkspaceRepositoryUrl, findExerciseByRepositoryUrl } from '../services/workspace';
import { logger, LogCategory } from '../services/loggingService';
import type { TelemetryManager } from '../services/telemetry';
import { CONFIG, VSCODE_CONFIG, AI_EXTENSIONS_BLOCKLIST, getRecommendedExtensionsByCategory } from '../utils';
import { AppStateManager, type UserInfo } from '../controller/appStateManager';
import { WebViewMessageHandler } from '../controller/webViewMessageHandler';
import type { WebViewActionHandler } from '../controller/types';
import { ViewActionService } from '../controller/viewActionService';
import { getViewHtml } from '../controller/viewRouter';
import { fetchAndEnrichExerciseDetails, fetchArchivedCourseDetail } from '../controller/exerciseDataLoader';
import { WebSocketMessageHandler } from '../types';
import { BaseWebviewProvider } from './baseWebviewProvider';
import type { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';
import { ExtensionMsg, toCourseDetailData } from '../../shared/messageContracts';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage, CourseDetailData } from '../../shared/messageContracts';
import type { ExerciseDetail, ExerciseDetailsResponse } from '../types';

/**
 * Main webview provider for the Artemis sidebar panel.
 *
 * NOTE: This class (~1100 lines) coordinates view lifecycle, message routing,
 * state sync, and service integration. A future refactor could extract
 * render-data preparation into a dedicated ViewDataService.
 */
export class ArtemisWebviewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider, WebViewActionHandler, vscode.Disposable {
    // ── Static properties ──────────────────────────────────────────────
    public static readonly viewType = CONFIG.WEBVIEW.VIEW_TYPE;

    // ── Instance properties ────────────────────────────────────────────
    private _appStateManager: AppStateManager;
    private _messageHandler: WebViewMessageHandler;
    private _viewActionService: ViewActionService;
    private _viewInitDataService: ViewInitDataService;
    private _submissionWsHandler: SubmissionWebSocketHandler;
    private _fullscreenPanelManager: FullscreenPanelManager;
    private _authFlowHandler: AuthFlowHandler;
    private _buildDiagnosticsService: BuildDiagnosticsService;
    private _exerciseOpeningService: ExerciseOpeningService;
    private _startPageResolver: StartPageResolver;
    private readonly _authContextUpdater: (isAuthenticated: boolean) => Promise<void>;
    private readonly _websocketService: ArtemisWebsocketService;
    private _websocketHandler: WebSocketMessageHandler;
    private readonly _telemetryManager: TelemetryManager;

    private readonly _onDidChangeViewNavigation = new vscode.EventEmitter<{ from: string; to: string }>();
    public readonly onDidChangeViewNavigation = this._onDidChangeViewNavigation.event;

    private readonly _onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    public readonly onDidChangePanelVisibility = this._onDidChangePanelVisibility.event;

    // ── Constructor ────────────────────────────────────────────────────
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _authManager: AuthManager,
        private readonly _artemisApi: ArtemisApiService,
        private readonly _exerciseRegistry: ExerciseRegistry,
        private readonly _providerRegistry: IProviderRegistry,
        websocketService: ArtemisWebsocketService,
        buildErrorCodeLensProvider: BuildErrorCodeLensProvider,
        telemetryManager: TelemetryManager,
        updateAuthContext: (isAuthenticated: boolean) => Promise<void>,
    ) {
        super();
        this._websocketService = websocketService;
        this._telemetryManager = telemetryManager;
        this._authContextUpdater = updateAuthContext;

        this._appStateManager = new AppStateManager();
        this._viewActionService = new ViewActionService(this._appStateManager, this._artemisApi);
        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._appStateManager,
            this,
            this._extensionContext,
            this._exerciseRegistry,
            this._providerRegistry,
            this._websocketService,
        );
        this._messageHandler.setAuthContextUpdater(this._authContextUpdater);
        this._viewInitDataService = new ViewInitDataService(
            this._appStateManager,
            this._telemetryManager,
            this._messageHandler,
            (msg) => this._postMessageSafe(msg),
        );
        this._buildDiagnosticsService = new BuildDiagnosticsService(this._artemisApi);
        this._buildDiagnosticsService.setCodeLensProvider(buildErrorCodeLensProvider);
        this._exerciseOpeningService = new ExerciseOpeningService(this._exerciseRegistry, this._providerRegistry, this._telemetryManager);
        this._startPageResolver = new StartPageResolver(this._artemisApi);
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
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
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
        this._disposables.push(messageListener);

        // Handle visibility changes — resend data when panel becomes visible
        const visibilityListener = webviewView.onDidChangeVisibility(() => {
            this._onDidChangePanelVisibility.fire(webviewView.visible);
            if (webviewView.visible) {
                void (async () => {
                    // Check if auth expired while panel was hidden
                    const hasAuth = await this._authManager.hasAuthCookie();
                    const currentState = this._appStateManager.currentState;
                    if (!hasAuth && currentState !== 'login') {
                        logger.debug('Auth expired while panel was hidden, showing login', LogCategory.VIEW);
                        this.showLogin();
                        return;
                    }

                    // Re-fetch exercise data to capture any WebSocket updates missed while hidden
                    if (currentState === 'exercise-detail') {
                        const exerciseData = this._appStateManager.currentExerciseData as ExerciseDetailsResponse | undefined;
                        const exerciseId = exerciseData?.exercise?.id;
                        if (exerciseId) {
                            try {
                                const freshData = await fetchAndEnrichExerciseDetails(this._artemisApi, exerciseId);
                                this._appStateManager.showExerciseDetail(freshData);
                            } catch { /* fall through to sendInitData with cached data */ }
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
        this._disposables.push(visibilityListener);

        // Listen for configuration changes to re-render when settings change
        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.refreshTheme();
            }
        });
        this._disposables.push(configListener);
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

    // ── Public API ─────────────────────────────────────────────────────

    // WebViewActionHandler interface implementation
    public async openJsonInEditor(data: Record<string, unknown>): Promise<void> {
        await this._viewActionService.openJsonInEditor(data);
    }

    public async openExerciseDetails(exerciseId: number): Promise<void> {
        const didUpdate = await this._viewActionService.openExerciseDetails(exerciseId);

        if (didUpdate) {
            this.render();

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
            // openExerciseDetails always sets ExerciseDetailsResponse (not ExamExerciseData),
            // so the cast is safe. Exam exercises go through openExamExerciseDetails instead.
            const exerciseData = this._appStateManager.currentExerciseData as ExerciseDetailsResponse | undefined;
            if (exerciseData?.exercise) {
                this._exerciseOpeningService.handleExerciseOpened(exerciseData, exerciseId);
            }
        }
    }

    public async openExamExerciseDetails(
        exercise: ExerciseDetail,
        exerciseIndex: number,
        courseId: number,
        examId: number
    ): Promise<void> {
        const didUpdate = await this._viewActionService.openExamExerciseDetails(
            exercise,
            exerciseIndex,
            courseId,
            examId
        );

        if (didUpdate) {
            this.render();
        }
    }

    public async showDashboard(userInfo: UserInfo): Promise<void> {
        // Set state immediately so concurrent logic sees 'dashboard' during fetch
        this._appStateManager.showDashboard(userInfo);

        // Fetch courses and populate (swallow error — dashboard renders with empty state)
        try {
            const coursesData = await this._artemisApi.getCoursesForDashboard();
            this._appStateManager.setCoursesData(coursesData);
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
        }).catch(() => { /* don't block dashboard */ }).finally(() => {
            this._appStateManager.archiveCheckComplete = true;
            this.sendInitData();
            void this._suggestWorkspaceStartPage();
        });
    }

    public async navigateToStartPage(userInfo: UserInfo): Promise<void> {
        const result = await this._startPageResolver.resolve(userInfo);

        switch (result.type) {
            case 'course-list':
                // Seed with already-fetched data to avoid a second API call
                this._appStateManager.seedAuthenticatedSession(userInfo, result.coursesData);
                this._appStateManager.showCourseList();
                if (this._view) { this.render(); }
                return;

            case 'workspace-exercise': {
                this._appStateManager.seedAuthenticatedSession(userInfo, result.coursesData);
                const entry = result.allCourses.find(e => e.course?.id === result.courseId);
                if (entry?.course) {
                    this._appStateManager.showCourseDetail(toCourseDetailData(entry.course));
                    this._postMessageSafe({ type: ExtensionMsg.UpdateLoading, message: 'Loading exercise...' });
                    await this.openExerciseDetails(result.exerciseId);
                    if (this._appStateManager.currentState === 'exercise-detail') {
                        return;
                    }
                }
                break;
            }

            case 'workspace-course': {
                this._appStateManager.seedAuthenticatedSession(userInfo, result.coursesData);
                const entry = result.allCourses.find(e => e.course?.id === result.courseId);
                if (entry?.course) {
                    this.showCourseDetail(toCourseDetailData(entry.course));
                    return;
                }
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
            const coursesData = await this._artemisApi.getCoursesForDashboard();
            this._appStateManager.showCourseList(coursesData);
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

        const mappedCourses = courses.map((entry) => ({
            course: {
                id: entry.course?.id || 0,
                title: entry.course?.title || 'Untitled Course',
                description: entry.course?.description,
                semester: entry.course?.semester,
                color: entry.course?.color,
                exercises: entry.course?.exercises,
                numberOfStudents: entry.course?.numberOfStudents,
                instructorGroupName: entry.course?.instructorGroupName,
            }
        }));

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
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
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

}
