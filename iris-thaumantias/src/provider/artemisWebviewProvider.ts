import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { ArtemisApiService } from '../api';
import { ArtemisWebsocketService } from '../services';
import { logger, LogLevel, LogCategory } from '../services/loggingService';
import { ProviderRegistry } from '../services/ProviderRegistry';
import type { IArtemisWebviewProvider } from '../types/IArtemisWebviewProvider';
import { CONFIG, VSCODE_CONFIG } from '../utils';
import { AI_EXTENSIONS_BLOCKLIST } from '../utils/aiExtensionsBlocklist';
import { getRecommendedExtensionsByCategory } from '../utils/recommendedExtensions';
import { getReactWebviewHtml } from '../utils/webviewHelpers';
import { AppStateManager, type UserInfo, type ExamData } from '../views/app/appStateManager';
import { WebViewMessageHandler } from '../views/app/webViewMessageHandler';
import type { WebViewActionHandler } from '../views/app/types';
import { ViewActionService } from '../views/app/viewActionService';
import { ViewRouter } from '../views/app/viewRouter';
import { ExerciseRegistry } from '../services';
import { detectWorkspaceExercise, type ExerciseSource } from '../services/workspaceDetectionService';
import { WebSocketMessageHandler, ResultDTO, ProgrammingSubmission, ProgrammingSubmissionState, SubmissionProcessingMessage } from '../types';
import type { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';
import type { TelemetryManager } from '../services/telemetry/telemetryManager';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage, CourseDetailData as CourseDetailPayload } from '../shared/messageContracts';
import type { CourseDashboardEntry, ExerciseDetail, CourseDetailData, ExerciseDetailsResponse } from '../types/apiResponses';

/**
 * Main webview provider for the Artemis sidebar panel.
 *
 * NOTE: This class (~1100 lines) coordinates view lifecycle, message routing,
 * state sync, and service integration. A future refactor could extract
 * render-data preparation into a dedicated ViewDataService.
 */
export class ArtemisWebviewProvider implements vscode.WebviewViewProvider, WebViewActionHandler, IArtemisWebviewProvider {
    public static readonly viewType = CONFIG.WEBVIEW.VIEW_TYPE;

    private _view?: vscode.WebviewView;
    private _appStateManager: AppStateManager;
    private _messageHandler: WebViewMessageHandler;
    private _viewRouter!: ViewRouter;
    private _viewActionService: ViewActionService;
    private _authContextUpdater?: (isAuthenticated: boolean) => Promise<void>;
    private _websocketService?: ArtemisWebsocketService;
    private _websocketHandler?: WebSocketMessageHandler;
    private _buildCodeLens?: BuildErrorCodeLensProvider;
    private _telemetryManager?: TelemetryManager;

    // Ready-signal handshake state
    private _webviewReady = false;
    private _pendingMessages: ExtensionToWebviewMessage[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _authManager: AuthManager,
        private readonly _artemisApi: ArtemisApiService,
    ) {
        this._appStateManager = new AppStateManager(this._artemisApi);
        this._viewActionService = new ViewActionService(this._appStateManager);
        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._appStateManager,
            this,
            undefined,  // buildCodeLens will be set later
            undefined,  // websocketService will be set later
            this._extensionContext
        );
    }

    /**
     * Set the CodeLens provider
     */
    public setBuildDiagnostics(codeLensProvider: BuildErrorCodeLensProvider): void {
        this._buildCodeLens = codeLensProvider;
        // Recreate message handler with CodeLens provider
        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._appStateManager,
            this,
            codeLensProvider,
            this._websocketService,
            this._extensionContext
        );
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

        // Create message handler for WebSocket events
        this._websocketHandler = {
            onNewResult: (result: ResultDTO) => {
                this._handleNewResult(result);
            },
            onNewSubmission: (submission: ProgrammingSubmission) => {
                this._handleNewSubmission(submission);
            },
            onSubmissionProcessing: (message: SubmissionProcessingMessage) => {
                this._handleSubmissionProcessing(message);
            }
        };

        // Register the handler
        this._websocketService.registerMessageHandler(this._websocketHandler);
    }

    /**
     * Helper method to render the webview HTML
     */
    public async render(): Promise<void> {
        if (this._view) {
            // Reset ready state since re-render reloads the webview
            this._webviewReady = false;
            this._view.webview.html = await this._viewRouter.getHtml();
        }
    }

    /**
     * Resend view data to the existing React app without re-rendering.
     * Used by reload handlers to update data in-place instead of destroying the webview.
     */
    public resendViewData(): void {
        const currentState = this._appStateManager.currentState;

        if (currentState === 'dashboard') {
            const coursesData = this._appStateManager.coursesData;
            const courses = coursesData?.courses || [];

            const recentCourseNodes = courses.map((courseItem: CourseDashboardEntry) => {
                const course = courseItem.course || courseItem;
                const exercises = course.exercises || [];

                const recentExercises = exercises
                    .filter((ex: ExerciseDetail) => ex.releaseDate || ex.startDate || ex.dueDate)
                    .sort((a: ExerciseDetail, b: ExerciseDetail) => {
                        const aDate = a.releaseDate || a.startDate || a.dueDate || '';
                        const bDate = b.releaseDate || b.startDate || b.dueDate || '';
                        return bDate.localeCompare(aDate);
                    });

                return {
                    courseData: {
                        course: {
                            id: (course.id ?? 0) as number,
                            title: (course.title ?? 'Untitled Course') as string,
                            exercises: course.exercises,
                            startDate: course.startDate as string | undefined,
                            creationDate: course.startDate as string | undefined,
                        }
                    },
                    exercises: recentExercises,
                };
            });

            this._postMessageSafe({
                type: 'dashboardInit',
                courses: recentCourseNodes, workspaceExercise: undefined,
            });
        } else if (currentState === 'course-list') {
            const coursesData = this._appStateManager.coursesData;
            const courses = coursesData?.courses || [];
            const archivedCourses = this._appStateManager.archivedCoursesData || undefined;

            // Map CourseDashboardEntry to CourseData for message contract
            const mappedCourses = courses.map((entry: CourseDashboardEntry) => ({
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

            this._postMessageSafe({
                type: 'courseListInit',
                courses: mappedCourses, archivedCourses,
            });
        } else if (currentState === 'course-detail') {
            const courseData = this._appStateManager.currentCourseData;
            if (!courseData) {
                logger.error('Course detail state missing course data', LogCategory.VIEW);
                return;
            }

            const exercises = courseData.course?.exercises || [];

            detectWorkspaceExercise(exercises as ExerciseSource[]).then((detectedExercise: { id?: number } | null) => {
                const workspaceExerciseId = detectedExercise?.id ?? null;
                const config = vscode.workspace.getConfiguration('artemis');
                const developerMode = config.get<boolean>('developerMode', false);

                this._postMessageSafe({
                    type: 'courseDetailInit',
                    courseData: courseData as CourseDetailPayload,
                    workspaceExerciseId: workspaceExerciseId,
                    hideDeveloperTools: !developerMode,
                });
            });
        } else if (currentState === 'exercise-detail') {
            const exerciseData = this._appStateManager.currentExerciseData;
            if (!exerciseData) {
                logger.error('Exercise detail state missing exercise data', LogCategory.VIEW);
                return;
            }

            // For non-exam exercise detail, exerciseData should be ExerciseDetailsResponse
            const config = vscode.workspace.getConfiguration('artemis');
            const developerMode = config.get<boolean>('developerMode', false);

            this._postMessageSafe({
                type: 'exerciseDetailInit',
                exerciseData: exerciseData as ExerciseDetailsResponse,
                hideDeveloperTools: !developerMode,
            });
        } else if (currentState === 'exam-conduction') {
            const examData = this._appStateManager.currentExamData;
            if (!examData) {
                logger.error('Exam conduction state missing exam data', LogCategory.VIEW);
                return;
            }

            const studentExam = examData.studentExam;
            const exam = studentExam.exam;

            // Calculate absolute timestamps for timer
            let startTime: number;
            let endTime: number;
            if (exam?.testExam && studentExam.startedDate) {
                startTime = new Date(studentExam.startedDate).getTime();
            } else if (exam?.startDate) {
                startTime = new Date(exam.startDate).getTime();
            } else {
                startTime = Date.now();
            }
            endTime = startTime + ((studentExam.workingTime || 0) * 1000);
            const totalDuration = (studentExam.workingTime || 0) * 1000;

            // Detect workspace exercise
            const exercises = studentExam.exercises || [];
            detectWorkspaceExercise(exercises as ExerciseSource[]).then((detectedExercise: { id?: number } | null) => {
                this._postMessageSafe({
                    type: 'examConductionInit',
                    studentExam,
                    courseId: examData.courseId,
                    examId: examData.examId,
                    endTime,
                    startTime,
                    totalDuration,
                    workspaceExerciseId: detectedExercise?.id ?? null,
                });
            });
        } else if (currentState === 'exam-start') {
            const examData = this._appStateManager.currentExamData;
            if (!examData) {
                logger.error('Exam start state missing exam data', LogCategory.VIEW);
                return;
            }

            this._postMessageSafe({
                type: 'examStartInit',
                studentExam: examData.studentExam,
                courseId: examData.courseId,
                examId: examData.examId,
            });
        } else if (currentState === 'exam-exercise-detail') {
            const exerciseData = this._appStateManager.currentExerciseData;
            const examData = this._appStateManager.currentExamData;

            if (!examData) {
                logger.error('Exam exercise detail state missing exam data', LogCategory.VIEW);
                return;
            }
            if (!exerciseData) {
                logger.error('Exam exercise detail state missing exercise data', LogCategory.VIEW);
                return;
            }

            const studentExam = examData.studentExam;
            const exam = studentExam.exam;

            // Calculate timer timestamps
            let startTime: number;
            if (exam?.testExam && studentExam.startedDate) {
                startTime = new Date(studentExam.startedDate).getTime();
            } else if (exam?.startDate) {
                startTime = new Date(exam.startDate).getTime();
            } else {
                startTime = Date.now();
            }
            const endTime = startTime + ((studentExam.workingTime || 0) * 1000);
            const totalDuration = (studentExam.workingTime || 0) * 1000;

            const config = vscode.workspace.getConfiguration('artemis');
            const developerMode = config.get<boolean>('developerMode', false);

            this._postMessageSafe({
                type: 'examExerciseDetailInit',
                exerciseData: exerciseData as ExerciseDetailsResponse,
                examContext: {
                    courseId: examData.courseId,
                    examId: examData.examId,
                    studentExam,
                    endTime,
                    startTime,
                    totalDuration,
                },
                hideDeveloperTools: !developerMode,
            });
        } else if (currentState === 'ai-config') {
            const aiExtensions = this._appStateManager.aiExtensions || [];
            this._postMessageSafe({ type: 'aiConfigInit', aiExtensions });
        } else if (currentState === 'struggle-detection') {
            const ctx = this._telemetryManager?.getStruggleContext();
            this._postMessageSafe({
                type: 'struggleDetectionInit',
                isStruggling: ctx?.isStruggling ?? false,
                eq: ctx?.eq ?? 0,
                eqConfidence: ctx?.eqConfidence ?? 'insufficient',
                triggerType: ctx?.triggerType,
                recommendedAction: ctx?.recommendedAction ?? 'none',
                isEnabled: this._telemetryManager?.isEnabled() ?? false,
            });
        } else if (currentState === 'service-status') {
            const serverUrl = this._appStateManager.userInfo?.serverUrl;
            this._postMessageSafe({ type: 'serviceStatusInit', serverUrl });
        } else if (currentState === 'recommended-extensions') {
            const categories = this._appStateManager.recommendedExtensions || [];
            const mappedCategories = categories.map(category => ({
                ...category,
                extensions: category.extensions.map(ext => ({
                    ...ext,
                    isInstalled: ext.isInstalled ?? false
                }))
            }));
            this._postMessageSafe({ type: 'recommendedExtensionsInit', categories: mappedCategories });
        } else if (currentState === 'login') {
            this._postMessageSafe({ type: 'setServerUrl', serverUrl: this._getServerUrl() });
        }
    }

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
                    const registry = ExerciseRegistry.getInstance();
                    registry.registerExercise(
                        exerciseIdFromData,
                        exerciseTitle,
                        participations[0].repositoryUri,
                        exercise.shortName || '',
                        exercise.course?.id
                    );
                    logger.exercise(`Registered individual exercise: ${exerciseTitle}`);
                }

                const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
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

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        // Initialize the ViewRouter now that we have the webview
        this._viewRouter = new ViewRouter(this._appStateManager, this._extensionContext, webviewView.webview);

        // Reset ready state for new webview
        this._webviewReady = false;
        this._pendingMessages = [];

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,

            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist')
            ]
        };

        webviewView.webview.html = await this._viewRouter.getHtml();

        // Set up message sender for the message handler (using safe posting)
        this._messageHandler.setMessageSender((message: ExtensionToWebviewMessage) => {
            this._postMessageSafe(message);
        });

        // Check if server URL has changed and clear credentials if needed
        this._checkServerUrlChange();

        // Check for existing authentication and auto-login if valid
        this._checkExistingAuthentication();

        // Handle messages from the webview using the message handler
        webviewView.webview.onDidReceiveMessage(
            (message: unknown) => {
                // Narrow unknown to typed message
                const typedMessage = message as { type?: string };

                // Handle ready signal from React webview
                if (typedMessage.type === 'ready') {
                    this._webviewReady = true;
                    // Flush any messages that were queued before ready
                    const pending = this._pendingMessages;
                    this._pendingMessages = [];
                    for (const msg of pending) {
                        if (this._view) {
                            this._view.webview.postMessage(msg);
                        }
                    }

                    // Send initialization data for the current view
                    this.resendViewData();
                    return;
                }

                // Forward commands to the message handler (preserving type/command/payload)
                this._messageHandler.handleMessage(message as WebviewToExtensionMessage);
            },
            undefined,
            []
        );

        // Handle visibility changes — resend data when panel becomes visible
        const visibilityListener = webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                void (async () => {
                    // Check if auth expired while panel was hidden
                    const hasAuth = await this._authManager.hasAuthCookie();
                    const currentState = this._appStateManager.currentState;
                    if (!hasAuth && currentState !== 'login') {
                        logger.debug('Auth expired while panel was hidden, showing login', LogCategory.VIEW);
                        this.hideLoadingAndSendServerUrl();
                        return;
                    }
                    logger.debug('Sidebar webview became visible, resending view data...', LogCategory.VIEW);
                    this.resendViewData();
                })();
            } else {
                logger.debug('Sidebar webview became hidden', LogCategory.VIEW);
            }
        });
        this._extensionContext.subscriptions.push(visibilityListener);

        // Listen for configuration changes to re-render when settings change
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.render();
            }
        });
    }

    public notifyLogout(): void {
        this._postMessageSafe({ type: 'logoutSuccess' });
    }

    public refreshTheme(): void {
        if (this._view) {
            this.render();
        }
    }

    public async showDashboard(userInfo: UserInfo): Promise<void> {
        await this._appStateManager.showDashboard(userInfo);

        if (this._view) {
            this.render();
        }
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
        const registry = ExerciseRegistry.getInstance();
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

    private async _checkServerUrlChange(): Promise<void> {
        try {
            const hasAuth = await this._authManager.hasAuthCookie();
            if (hasAuth) {
                const isServerUrlChanged = await this._artemisApi.isServerUrlChanged();
                if (isServerUrlChanged) {
                    const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                    const currentServerUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);

                    vscode.window.showWarningMessage(
                        `The Artemis server URL has changed to ${currentServerUrl}. Your stored credentials may no longer be valid.`,
                        'Clear Credentials',
                        'Keep Credentials'
                    ).then(selection => {
                        if (selection === 'Clear Credentials') {
                            this.showLogin();
                        }
                    });
                }
            }
        } catch (error) {
            logger.error('Error checking server URL change', LogCategory.AUTH, error);
        }
    }

    private async _checkExistingAuthentication(): Promise<void> {
        try {
            // Check if we have stored authentication
            const hasAuth = await this._authManager.hasAuthCookie();
            if (hasAuth) {
                // Show loading indicator only when actually attempting auto-login
                this._postMessageSafe({ type: 'showLoading', message: 'Checking stored credentials...' });

                // Update loading message
                this._postMessageSafe({ type: 'updateLoading', message: 'Loading user information...' });

                // Try to get user info directly - this validates authentication implicitly
                try {
                    const user = await this._artemisApi.getCurrentUser();
                    await this.withServerUrl(async serverUrl => {
                        logger.auth(`Auto-authenticated user: ${user.login}`);
                        await this.showDashboard({
                            username: user.login || 'User',
                            serverUrl: serverUrl,
                            user: user  // ArtemisUser from models/core is compatible with ArtemisUser from types/apiResponses
                        });
                    });
                } catch (userError) {
                    // If getCurrentUser fails, stored credentials are invalid
                    logger.auth('Stored credentials are invalid, clearing...');
                    await this._authManager.clear();

                    // Update authentication context
                    if (this._authContextUpdater) {
                        await this._authContextUpdater(false);
                    }

                    // Hide loading and show login
                    this.hideLoadingAndSendServerUrl();
                }
            } else {
                // No stored authentication, hide loading
                this.hideLoadingAndSendServerUrl();
            }
        } catch (error) {
            logger.error('Error checking existing authentication', LogCategory.AUTH, error);
            // If there's an error, clear potentially corrupted credentials and hide loading
            await this._authManager.clear();

            // Update authentication context
            if (this._authContextUpdater) {
                await this._authContextUpdater(false);
            }

            this.hideLoadingAndSendServerUrl();
        }
    }

    public async openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): Promise<void> {
        const exerciseTitle = exerciseData?.exercise?.title || 'Exercise';

        const panel = vscode.window.createWebviewPanel(
            'artemis.exerciseFullscreen',
            `Exercise: ${exerciseTitle}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')]
            }
        );

        // Reuse the same React webview HTML with exerciseDetail view routing
        panel.webview.html = getReactWebviewHtml(panel.webview, this._extensionUri, 'exerciseDetail');

        // Register message handler for the fullscreen panel
        panel.webview.onDidReceiveMessage(async (message: unknown) => {
            // Narrow unknown message to typed object
            const typedMessage = message as { type?: string; title?: string; command?: string; payload?: unknown };

            // Handle 'ready' signal — send exercise data
            if (typedMessage.type === 'ready') {
                panel.webview.postMessage({
                    type: 'exerciseDetailInit',
                    exerciseData: exerciseData,
                    hideDeveloperTools: false,
                });
            }

            // Handle title updates from the webview
            if (typedMessage.type === 'updatePanelTitle' && typeof typedMessage.title === 'string') {
                panel.title = `Exercise: ${typedMessage.title}`;
            }

            // Forward all other messages to the existing handler
            // Use handleMessageWithSender so responses go back to THIS panel, not the sidebar
            this._messageHandler.handleMessageWithSender(message as WebviewToExtensionMessage, (responseMessage: ExtensionToWebviewMessage) => {
                panel.webview.postMessage(responseMessage);
            });
        });

        // Track panel for cleanup
        this._extensionContext.subscriptions.push(panel);
    }

    public async openCourseFullscreen(courseData: CourseDetailData): Promise<void> {
        const courseTitle = courseData?.course?.title || 'Course';

        const panel = vscode.window.createWebviewPanel(
            'artemis.courseFullscreen',
            `Course: ${courseTitle}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')]
            }
        );

        panel.webview.html = getReactWebviewHtml(panel.webview, this._extensionUri, 'courseDetail');

        panel.webview.onDidReceiveMessage(async (message: unknown) => {
            // Narrow the unknown message to a typed object
            if (!message || typeof message !== 'object') {
                return;
            }

            const typedMessage = message as { type?: string; title?: string; command?: string; payload?: unknown };

            if (typedMessage.type === 'ready') {
                // Read developer mode setting
                const config = vscode.workspace.getConfiguration('artemis');
                const developerMode = config.get<boolean>('developerMode', false);
                const hideDeveloperTools = !developerMode;

                panel.webview.postMessage({
                    type: 'courseDetailInit',
                    courseData: courseData,
                    workspaceExerciseId: null,
                    hideDeveloperTools: hideDeveloperTools,
                });
            }

            if (typedMessage.type === 'updatePanelTitle' && typeof typedMessage.title === 'string') {
                panel.title = `Course: ${typedMessage.title}`;
            }

            // Forward all other messages via handleMessageWithSender
            this._messageHandler.handleMessageWithSender(message as WebviewToExtensionMessage, (responseMessage: ExtensionToWebviewMessage) => {
                panel.webview.postMessage(responseMessage);
            });
        });

        this._extensionContext.subscriptions.push(panel);
    }

    // WebSocket message handlers

    private _handleNewResult(result: ResultDTO): void {
        // ResultDTO is structurally compatible with ResultSummary at runtime
        this._postMessageSafe({
            type: 'websocketUpdate',
            updateType: 'newResult',
            data: result,
        } as ExtensionToWebviewMessage);
    }

    private _handleNewSubmission(submission: ProgrammingSubmission): void {
        // ProgrammingSubmission is structurally compatible with SubmissionSummary at runtime
        this._postMessageSafe({
            type: 'websocketUpdate',
            updateType: 'newSubmission',
            data: submission,
        } as ExtensionToWebviewMessage);
    }

    private _handleSubmissionProcessing(message: SubmissionProcessingMessage): void {
        // Infer state from message content if not provided
        let state = message.submissionState;
        if (!state && (message.buildStartDate || message.estimatedCompletionDate)) {
            // If we have build timing info, the build is likely in progress
            state = ProgrammingSubmissionState.BUILDING;
        }

        // Create build timing info from the message
        const buildTimingInfo = message.buildTimingInfo || {
            buildStartDate: message.buildStartDate,
            estimatedCompletionDate: message.estimatedCompletionDate,
            submissionDate: message.submissionDate
        };

        this._postMessageSafe({
            type: 'websocketUpdate',
            updateType: 'submissionProcessing',
            data: {
                state: state || 'BUILDING',
                participationId: message.participationId,
                buildTimingInfo: buildTimingInfo
            }
        });
    }

    private async withServerUrl(
        callback: (serverUrl: string) => Promise<void> | void
    ): Promise<void> {
        const serverUrl = this._getServerUrl();
        await callback(serverUrl);
    }

    private postServerUrl(serverUrl?: string): void {
        this._postMessageSafe({
            type: 'setServerUrl',
            serverUrl: serverUrl ?? this._getServerUrl()
        });
    }

    private hideLoadingAndSendServerUrl(): void {
        this._postMessageSafe({ type: 'hideLoading' });
        this.postServerUrl();
    }

    private isDeveloperMode(): boolean {
        const config = vscode.workspace.getConfiguration('artemis');
        return config.get<boolean>('developerMode', false);
    }

    private _getServerUrl(): string {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
    }

    /**
     * Safely post a message to the webview, queuing it if the webview is not ready yet.
     * This prevents race conditions where messages are sent before React hydration completes.
     */
    private _postMessageSafe(message: ExtensionToWebviewMessage): void {
        if (this._webviewReady && this._view) {
            this._view.webview.postMessage(message);
        } else {
            this._pendingMessages.push(message);
        }
    }
}
