import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { ArtemisApiService } from '../api';
import { ArtemisWebsocketService } from '../services';
import { ViewInitDataService } from '../services/ui/viewInitDataService';
import { SubmissionWebSocketHandler } from '../services/websocket/submissionWebSocketHandler';
import { FullscreenPanelManager } from '../services/ui/fullscreenPanelManager';
import { AuthFlowHandler } from '../services/auth/authFlowHandler';
import { logger, LogCategory } from '../services/loggingService';
import { ProviderRegistry } from '../services/ProviderRegistry';
import type { IArtemisWebviewProvider } from '../types/IArtemisWebviewProvider';
import { CONFIG, VSCODE_CONFIG } from '../utils';
import { AI_EXTENSIONS_BLOCKLIST } from '../utils/aiExtensionsBlocklist';
import { getRecommendedExtensionsByCategory } from '../utils/recommendedExtensions';
import { AppStateManager, type UserInfo } from '../views/app/appStateManager';
import { WebViewMessageHandler } from '../views/app/webViewMessageHandler';
import type { WebViewActionHandler } from '../views/app/types';
import { ViewActionService } from '../views/app/viewActionService';
import { ViewRouter } from '../views/app/viewRouter';
import { ExerciseRegistry } from '../services';
import { WebSocketMessageHandler, ParsedBuildError } from '../types';
import { findWorkspaceCourseInArchive, getWorkspaceRepositoryUrl, findExerciseByRepositoryUrl, collectExerciseSources, type DetectedExercise } from '../services/workspace/workspaceDetectionService';
import { BaseWebviewProvider } from './baseWebviewProvider';
import type { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';
import type { TelemetryManager } from '../services/telemetry/telemetryManager';
import { ExtensionMsg, WebviewMsgType } from '../shared/messageContracts';
import { BuildLogParser } from '../utils';
import type { ResultDTO } from '../types';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage, CourseDetailData as CourseDetailPayload } from '../shared/messageContracts';
import type { ExerciseDetail, CourseDetailData, ExerciseDetailsResponse } from '../types/apiResponses';
import { isWebviewMessage } from '../shared/messageContracts/typeGuards';

/**
 * Main webview provider for the Artemis sidebar panel.
 *
 * NOTE: This class (~1100 lines) coordinates view lifecycle, message routing,
 * state sync, and service integration. A future refactor could extract
 * render-data preparation into a dedicated ViewDataService.
 */
export class ArtemisWebviewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider, WebViewActionHandler, IArtemisWebviewProvider, vscode.Disposable {
    // ── Static properties ──────────────────────────────────────────────
    public static readonly viewType = CONFIG.WEBVIEW.VIEW_TYPE;

    // ── Instance properties ────────────────────────────────────────────
    private _appStateManager: AppStateManager;
    private _messageHandler: WebViewMessageHandler;
    private _viewRouter!: ViewRouter;
    private _viewActionService: ViewActionService;
    private _viewInitDataService: ViewInitDataService;
    private _submissionWsHandler: SubmissionWebSocketHandler;
    private _fullscreenPanelManager: FullscreenPanelManager;
    private _authFlowHandler: AuthFlowHandler;
    private _authContextUpdater?: (isAuthenticated: boolean) => Promise<void>;
    private _websocketService?: ArtemisWebsocketService;
    private _websocketHandler?: WebSocketMessageHandler;
    private _buildCodeLens?: BuildErrorCodeLensProvider;
    private _telemetryManager?: TelemetryManager;

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
        private readonly _providerRegistry: ProviderRegistry,
    ) {
        super();
        this._appStateManager = new AppStateManager(this._artemisApi);
        this._viewActionService = new ViewActionService(this._appStateManager);
        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._appStateManager,
            this,
            undefined,  // buildCodeLens will be set later
            undefined,  // websocketService will be set later
            this._extensionContext,
            this._exerciseRegistry,
            this._providerRegistry
        );
        this._viewInitDataService = new ViewInitDataService(
            () => this._appStateManager,
            () => this._telemetryManager,
            () => this._messageHandler,
            (msg) => this._postMessageSafe(msg),
        );
        this._submissionWsHandler = new SubmissionWebSocketHandler(
            (msg) => this._postMessageSafe(msg),
            (result) => this._handleBuildResult(result),
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

        this._appStateManager.onStateChange = (from, to) => {
            this._onDidChangeViewNavigation.fire({ from, to });
        };

        this._disposables.push(this._onDidChangeViewNavigation);
        this._disposables.push(this._onDidChangePanelVisibility);
    }

    // ── Post-construction setters ──────────────────────────────────────

    /**
     * Set the CodeLens provider
     */
    public setBuildDiagnostics(codeLensProvider: BuildErrorCodeLensProvider): void {
        this._buildCodeLens = codeLensProvider;
        // Dispose old handler to release workspace listeners before recreating
        this._messageHandler.dispose();
        // Recreate message handler with CodeLens provider
        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._appStateManager,
            this,
            codeLensProvider,
            this._websocketService,
            this._extensionContext,
            this._exerciseRegistry,
            this._providerRegistry
        );
        // Re-apply auth context updater to new handler instance
        if (this._authContextUpdater) {
            this._messageHandler.setAuthContextUpdater(this._authContextUpdater);
        }
    }

    /**
     * Set the telemetry manager for struggle detection data
     */
    public setTelemetryManager(telemetryManager: TelemetryManager): void {
        this._telemetryManager = telemetryManager;
    }

    /**
     * Set the authentication context updater function
     */
    public setAuthContextUpdater(updater: (isAuthenticated: boolean) => Promise<void>): void {
        this._authContextUpdater = updater;
        // Also pass it to the message handler
        this._messageHandler.setAuthContextUpdater(updater);
    }

    /**
     * Set the WebSocket service for real-time updates
     */
    public setWebsocketService(websocketService: ArtemisWebsocketService): void {
        this._websocketService = websocketService;

        // Pass WebSocket service to message handler so commands can access it
        this._messageHandler.setWebsocketService(websocketService);

        // Register the submission WebSocket handler
        this._websocketHandler = this._submissionWsHandler.createHandler();
        this._websocketService.registerMessageHandler(this._websocketHandler);
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

        // Initialize the ViewRouter now that we have the webview
        this._viewRouter = new ViewRouter(this._appStateManager, this._extensionContext, webviewView.webview);

        this._resetReadyState();

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,

            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'media'),
            ]
        };

        webviewView.webview.html = await this._viewRouter.getHtml();

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
                                await this._appStateManager.showExerciseDetail(exerciseId);
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
    public async render(): Promise<void> {
        if (this._view) {
            try {
                this._resetReadyState();
                this._view.webview.html = await this._viewRouter.getHtml();
            } catch (err) {
                logger.error('Failed to render webview', LogCategory.VIEW, err);
            }
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

            // Notify Iris chat about the detected exercise
            const exerciseData = this._appStateManager.currentExerciseData;
            if (exerciseData?.exercise) {
                const exercise = exerciseData.exercise;
                const exerciseTitle = exercise.title || 'Untitled';
                const exerciseIdFromData = exercise.id || exerciseId;

                // Register this exercise in the registry with its repository URL
                const participations = exercise.studentParticipations || [];
                if (participations.length > 0 && participations[0]?.repositoryUri) {
                    const registry = this._exerciseRegistry;
                    registry.registerExercise(
                        exerciseIdFromData,
                        exerciseTitle,
                        participations[0].repositoryUri,
                        exercise.shortName || '',
                        exercise.course?.id
                    );
                    logger.exercise(`Registered individual exercise: ${exerciseTitle}`);
                }

                // Start telemetry session so build results feed into EQ engine
                this._telemetryManager?.startExerciseSession(
                    exerciseIdFromData,
                    vscode.workspace.workspaceFolders?.[0]?.uri,
                );

                const chatProvider = this._providerRegistry.getChatWebviewProvider();
                if (chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
                    // Extract date fields from exercise
                    const releaseDate = exercise.releaseDate || exercise.startDate;
                    const dueDate = exercise.dueDate;
                    const shortName = exercise.shortName;
                    chatProvider.updateDetectedExercise(exerciseTitle, exerciseIdFromData, releaseDate, dueDate, shortName || '', exercise.course?.id);
                }
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
        await this._appStateManager.showDashboard(userInfo);

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
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const value = config.get<string>(VSCODE_CONFIG.START_PAGE_KEY);

        if (value === 'course-list') {
            // Load user data + courses via state manager (no render, no archive check yet)
            await this._appStateManager.showDashboard(userInfo);
            if (this._appStateManager.coursesData) {
                // Data loaded: switch to course-list and render
                await this._appStateManager.showCourseList({ skipFetch: true });
                if (this._view) { this.render(); }
                return;
            }
            // Course load failed — fall through to full dashboard flow (implicit retry)
        }

        if (value === 'workspace-exercise' || value === 'workspace-course') {
            // Fetch courses and workspace git remote in parallel.
            // We do NOT call _appStateManager.showDashboard() here because it sets
            // state to 'dashboard' immediately — if the webview ready signal fires
            // during the fetch, sendInitData() would flash the dashboard.
            // Keeping state as 'login' keeps the loading screen visible.
            this._postMessageSafe({ type: ExtensionMsg.UpdateLoading, message: 'Detecting workspace exercise...' });
            const [coursesData, repoUrl] = await Promise.all([
                this._artemisApi.getCoursesForDashboard().catch(() => undefined),
                getWorkspaceRepositoryUrl(),
            ]);

            const activeCourses = coursesData?.courses || [];
            // Collect all course entries (active + potentially archived) for course lookup
            const allCourses = [...activeCourses];
            let detected: DetectedExercise | null = null;

            // 1) Search active courses
            if (activeCourses.length > 0 && repoUrl) {
                detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources(activeCourses));
            }

            // 2) Fallback: search archived courses
            if (!detected && repoUrl) {
                this._postMessageSafe({ type: ExtensionMsg.UpdateLoading, message: 'Checking archived courses...' });
                try {
                    const archivedEntry = await findWorkspaceCourseInArchive(this._artemisApi, activeCourses);
                    if (archivedEntry) {
                        detected = findExerciseByRepositoryUrl(repoUrl, collectExerciseSources([archivedEntry]));
                        if (detected) { allCourses.push(archivedEntry); }
                    }
                } catch { /* archived search failed — fall through */ }
            }

            if (detected) {
                this._appStateManager.seedAuthenticatedSession(userInfo, coursesData);

                if (value === 'workspace-exercise') {
                    // Require courseId to seed parent course context for "Back to Course" navigation.
                    // Without it, backToCourseDetails() would crash (no _currentCourseData).
                    if (detected.courseId) {
                        const entry = allCourses.find(e => e.course?.id === detected!.courseId);
                        if (entry?.course) {
                            this._appStateManager.showCourseDetail({
                                course: entry.course as CourseDetailData['course']
                            });
                            this._postMessageSafe({ type: ExtensionMsg.UpdateLoading, message: 'Loading exercise...' });
                            await this.openExerciseDetails(detected.id);
                            if (this._appStateManager.currentState === 'exercise-detail') {
                                return;
                            }
                        }
                    }
                } else {
                    // workspace-course: show course detail directly
                    if (detected.courseId) {
                        const entry = allCourses.find(e => e.course?.id === detected!.courseId);
                        if (entry?.course) {
                            this.showCourseDetail({
                                course: entry.course as CourseDetailData['course']
                            });
                            return;
                        }
                    }
                }
            }
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
            await this._appStateManager.showCourseList();
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
        this._fullscreenPanelManager.openCourseFullscreen(courseData as CourseDetailPayload);
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

    // ── Private: Message handling ──────────────────────────────────────

    private _handleMessage(message: unknown): void {
        if (!isWebviewMessage(message)) {
            return;
        }

        const typedMessage = message as WebviewToExtensionMessage;

        // Log error reports from webview ErrorBoundary
        if (typedMessage.type === WebviewMsgType.Error) {
            const errorPayload = typedMessage.payload;
            logger.error('Webview ErrorBoundary crash report', LogCategory.VIEW, {
                message: errorPayload?.message,
                stack: errorPayload?.stack,
                componentStack: errorPayload?.componentStack,
            });
            return;
        }

        // Handle ready signal from React webview
        if (typedMessage.type === WebviewMsgType.Ready) {
            this._markReady();
            this.sendInitData();
            return;
        }

        // Handle re-init requests (e.g. retry after error)
        if (typedMessage.type === WebviewMsgType.RequestInit) {
            this.sendInitData();
            return;
        }

        // Only command messages have command/payload properties
        if (typedMessage.type !== 'command') {return;}

        // Forward commands to the message handler (preserving type/command/payload)
        this._messageHandler.handleMessage(typedMessage);
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

    private _handleBuildResult(result: ResultDTO): void {
        const participationId = result.participation?.id;
        if (!participationId) {
            return;
        }

        void (async () => {
            try {
                const logs = await this._artemisApi.getBuildLogs(participationId, result.id);
                const errors = BuildLogParser.parseAllErrors(logs);

                this._buildCodeLens?.clearErrors();

                const errorsByFile = new Map<string, ParsedBuildError[]>();
                for (const error of errors) {
                    const existing = errorsByFile.get(error.filePath) ?? [];
                    existing.push(error);
                    errorsByFile.set(error.filePath, existing);
                }

                for (const [filePath, fileErrors] of errorsByFile) {
                    this._buildCodeLens?.setErrors(filePath, fileErrors);
                }
            } catch (err) {
                logger.error('Failed to fetch build logs for CodeLens:', LogCategory.SUBMISSION, err);
            }
        })();
    }

}
