import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { ArtemisApiService } from '../api';
import { ArtemisWebsocketService } from '../services';
import { logger, LogLevel, LogCategory } from '../services/loggingService';
import { ProviderRegistry } from '../services/ProviderRegistry';
import { CONFIG, VSCODE_CONFIG } from '../utils';
import { AI_EXTENSIONS_BLOCKLIST } from '../utils/aiExtensionsBlocklist';
import { getRecommendedExtensionsByCategory } from '../utils/recommendedExtensions';
import { getReactWebviewHtml } from '../utils/webviewHelpers';
import { AppStateManager, type UserInfo } from '../views/app/appStateManager';
import { WebViewMessageHandler } from '../views/app/webViewMessageHandler';
import type { WebViewActionHandler } from '../views/app/types';
import { ViewActionService } from '../views/app/viewActionService';
import { ViewRouter } from '../views/app/viewRouter';
import { ExerciseRegistry } from '../services';
import { WebSocketMessageHandler, ResultDTO, ProgrammingSubmission, ProgrammingSubmissionState, SubmissionProcessingMessage } from '../types';

export class ArtemisWebviewProvider implements vscode.WebviewViewProvider, WebViewActionHandler {
    public static readonly viewType = CONFIG.WEBVIEW.VIEW_TYPE;

    private _view?: vscode.WebviewView;
    private _appStateManager: AppStateManager;
    private _messageHandler: WebViewMessageHandler;
    private _viewRouter!: ViewRouter;
    private _viewActionService: ViewActionService;
    private _authContextUpdater?: (isAuthenticated: boolean) => Promise<void>;
    private _websocketService?: ArtemisWebsocketService;
    private _websocketHandler?: WebSocketMessageHandler;
    private _buildCodeLens?: any; // BuildErrorCodeLensProvider

    // Ready-signal handshake state
    private _webviewReady = false;
    private _pendingMessages: any[] = [];

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
    public setBuildDiagnostics(codeLensProvider: any): void {
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

            const recentCourseNodes = courses.map((courseItem: any) => {
                const course = courseItem.course || courseItem;
                const exercises = course.exercises || [];

                const recentExercises = exercises
                    .filter((ex: any) => ex.releaseDate || ex.startDate || ex.dueDate)
                    .sort((a: any, b: any) => {
                        const aDate = a.releaseDate || a.startDate || a.dueDate || '';
                        const bDate = b.releaseDate || b.startDate || b.dueDate || '';
                        return bDate.localeCompare(aDate);
                    });

                return {
                    courseData: { course },
                    exercises: recentExercises,
                };
            });

            this._postMessageSafe({
                type: 'dashboardInit',
                payload: { courses: recentCourseNodes, workspaceExercise: undefined },
            });
        } else if (currentState === 'course-list') {
            const coursesData = this._appStateManager.coursesData;
            const courses = coursesData?.courses || [];
            const archivedCourses = this._appStateManager.archivedCoursesData || undefined;

            this._postMessageSafe({
                type: 'courseListInit',
                payload: { courses, archivedCourses },
            });
        } else if (currentState === 'course-detail') {
            const courseData = this._appStateManager.currentCourseData;
            const { detectWorkspaceExercise } = require('../services');
            const exercises = courseData?.course?.exercises || [];

            detectWorkspaceExercise(exercises).then((detectedExercise: any) => {
                const workspaceExerciseId = detectedExercise?.id ?? null;
                const config = vscode.workspace.getConfiguration('artemis');
                const developerMode = config.get<boolean>('developerMode', false);

                this._postMessageSafe({
                    type: 'courseDetailInit',
                    payload: {
                        courseData: courseData,
                        workspaceExerciseId: workspaceExerciseId,
                        hideDeveloperTools: !developerMode,
                    },
                });
            });
        } else if (currentState === 'exercise-detail') {
            const exerciseData = this._appStateManager.currentExerciseData;
            const config = vscode.workspace.getConfiguration('artemis');
            const developerMode = config.get<boolean>('developerMode', false);

            this._postMessageSafe({
                type: 'exerciseDetailInit',
                payload: {
                    exerciseData: exerciseData,
                    hideDeveloperTools: !developerMode,
                },
            });
        } else if (currentState === 'exam-conduction') {
            const examData = this._appStateManager.currentExamData;
            const studentExam = examData.studentExam;
            const exam = studentExam.exam;

            // Calculate absolute timestamps for timer
            let startTime: number;
            let endTime: number;
            if (exam.testExam && studentExam.startedDate) {
                startTime = new Date(studentExam.startedDate).getTime();
            } else if (exam.startDate) {
                startTime = new Date(exam.startDate).getTime();
            } else {
                startTime = Date.now();
            }
            endTime = startTime + (studentExam.workingTime * 1000);
            const totalDuration = studentExam.workingTime * 1000;

            // Detect workspace exercise
            const { detectWorkspaceExercise } = require('../services');
            const exercises = studentExam.exercises || [];
            detectWorkspaceExercise(exercises).then((detectedExercise: any) => {
                this._postMessageSafe({
                    type: 'examConductionInit',
                    payload: {
                        studentExam,
                        courseId: examData.courseId,
                        examId: examData.examId,
                        endTime,
                        startTime,
                        totalDuration,
                        workspaceExerciseId: detectedExercise?.id ?? null,
                    },
                });
            });
        } else if (currentState === 'exam-start') {
            const examData = this._appStateManager.currentExamData;
            this._postMessageSafe({
                type: 'examStartInit',
                payload: {
                    studentExam: examData.studentExam,
                    courseId: examData.courseId,
                    examId: examData.examId,
                },
            });
        } else if (currentState === 'exam-exercise-detail') {
            const exerciseData = this._appStateManager.currentExerciseData;
            const examData = this._appStateManager.currentExamData;
            const studentExam = examData?.studentExam;
            const exam = studentExam?.exam;

            // Calculate timer timestamps
            let startTime: number;
            if (exam?.testExam && studentExam?.startedDate) {
                startTime = new Date(studentExam.startedDate).getTime();
            } else if (exam?.startDate) {
                startTime = new Date(exam.startDate).getTime();
            } else {
                startTime = Date.now();
            }
            const endTime = startTime + ((studentExam?.workingTime || 0) * 1000);
            const totalDuration = (studentExam?.workingTime || 0) * 1000;

            const config = vscode.workspace.getConfiguration('artemis');
            const developerMode = config.get<boolean>('developerMode', false);

            this._postMessageSafe({
                type: 'examExerciseDetailInit',
                payload: {
                    exerciseData,
                    examContext: {
                        courseId: examData?.courseId,
                        examId: examData?.examId,
                        studentExam,
                        endTime,
                        startTime,
                        totalDuration,
                    },
                    hideDeveloperTools: !developerMode,
                },
            });
        }
    }

    // WebViewActionHandler interface implementation
    public async openJsonInEditor(data: any): Promise<void> {
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
            if (exerciseData) {
                const exerciseTitle = exerciseData.exercise?.title || exerciseData.title || 'Untitled';
                const exerciseIdFromData = exerciseData.exercise?.id || exerciseData.id || exerciseId;

                // Register this exercise in the registry with its repository URL
                const exercise = exerciseData.exercise || exerciseData;
                const participations = exercise.studentParticipations || [];
                if (participations.length > 0 && participations[0].repositoryUri) {
                    const registry = ExerciseRegistry.getInstance();
                    registry.registerExercise(
                        exerciseIdFromData,
                        exerciseTitle,
                        participations[0].repositoryUri,
                        exercise.shortName,
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
                    chatProvider.updateDetectedExercise(exerciseTitle, exerciseIdFromData, releaseDate, dueDate, shortName, exercise.course?.id);
                }
            }
        }
    }

    public async openExamExerciseDetails(
        exercise: any,
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
                this._extensionUri
            ]
        };

        webviewView.webview.html = await this._viewRouter.getHtml();

        // Set up message sender for the message handler (using safe posting)
        this._messageHandler.setMessageSender((message: any) => {
            this._postMessageSafe(message);
        });

        // Check if server URL has changed and clear credentials if needed
        this._checkServerUrlChange();

        // Check for existing authentication and auto-login if valid
        this._checkExistingAuthentication();

        // Handle messages from the webview using the message handler
        webviewView.webview.onDidReceiveMessage(
            message => {
                // Handle ready signal from React webview
                if (message.type === 'ready') {
                    this._webviewReady = true;
                    // Flush any messages that were queued before ready
                    this._pendingMessages.forEach(msg => {
                        if (this._view) {
                            this._view.webview.postMessage(msg);
                        }
                    });
                    this._pendingMessages = [];

                    // Send initialization data for the current view
                    const currentState = this._appStateManager.currentState;
                    if (currentState === 'service-status') {
                        const serverUrl = this._appStateManager.userInfo?.serverUrl;
                        this._postMessageSafe({
                            type: 'serviceStatusInit',
                            payload: { serverUrl }
                        });
                    } else if (currentState === 'recommended-extensions') {
                        const categories = this._appStateManager.recommendedExtensions || [];
                        this._postMessageSafe({
                            type: 'recommendedExtensionsInit',
                            payload: { categories }
                        });
                    } else if (currentState === 'login') {
                        // Send server URL to login view for health checks
                        this._postMessageSafe({
                            type: 'setServerUrl',
                            payload: { serverUrl: this._getServerUrl() }
                        });
                    } else if (currentState === 'dashboard') {
                        // Send dashboard data with recent courses
                        const coursesData = this._appStateManager.coursesData;
                        const courses = coursesData?.courses || [];

                        // Build recent course nodes (same structure as legacy dashboard)
                        const recentCourseNodes = courses.map((courseItem: any) => {
                            const course = courseItem.course || courseItem;
                            const exercises = course.exercises || [];

                            // Get recent exercises (sorted by date)
                            const recentExercises = exercises
                                .filter((ex: any) => ex.releaseDate || ex.startDate || ex.dueDate)
                                .sort((a: any, b: any) => {
                                    const aDate = a.releaseDate || a.startDate || a.dueDate || '';
                                    const bDate = b.releaseDate || b.startDate || b.dueDate || '';
                                    return bDate.localeCompare(aDate);
                                });

                            return {
                                courseData: {
                                    course: course
                                },
                                exercises: recentExercises
                            };
                        });

                        this._postMessageSafe({
                            type: 'dashboardInit',
                            payload: {
                                courses: recentCourseNodes,
                                workspaceExercise: undefined  // Will be set by workspace detection
                            }
                        });
                    } else if (currentState === 'course-list') {
                        // Send course list data with active and archived courses
                        const coursesData = this._appStateManager.coursesData;
                        const courses = coursesData?.courses || [];
                        const archivedCourses = this._appStateManager.archivedCoursesData || undefined;

                        this._postMessageSafe({
                            type: 'courseListInit',
                            payload: {
                                courses: courses,
                                archivedCourses: archivedCourses
                            }
                        });
                    } else if (currentState === 'course-detail') {
                        // Send course detail data with exercises and exams
                        const courseData = this._appStateManager.currentCourseData;

                        // Detect workspace exercise ID asynchronously
                        const { detectWorkspaceExercise } = require('../services');
                        const exercises = courseData?.course?.exercises || [];

                        // Use non-blocking async call
                        detectWorkspaceExercise(exercises).then((detectedExercise: any) => {
                            const workspaceExerciseId = detectedExercise?.id ?? null;

                            // Read developer mode setting
                            const config = vscode.workspace.getConfiguration('artemis');
                            const developerMode = config.get<boolean>('developerMode', false);
                            const hideDeveloperTools = !developerMode;

                            this._postMessageSafe({
                                type: 'courseDetailInit',
                                payload: {
                                    courseData: courseData,
                                    workspaceExerciseId: workspaceExerciseId,
                                    hideDeveloperTools: hideDeveloperTools
                                }
                            });
                        });
                    } else if (currentState === 'exercise-detail') {
                        // Send exercise detail data
                        const exerciseData = this._appStateManager.currentExerciseData;

                        // Read developer mode setting
                        const config = vscode.workspace.getConfiguration('artemis');
                        const developerMode = config.get<boolean>('developerMode', false);
                        const hideDeveloperTools = !developerMode;

                        this._postMessageSafe({
                            type: 'exerciseDetailInit',
                            payload: {
                                exerciseData: exerciseData,
                                hideDeveloperTools: hideDeveloperTools
                            }
                        });
                    }
                    return;
                }

                // Bridge new typed message format to legacy command handler
                if (message.type === 'command' && message.command) {
                    // Extract command and payload, delegate to existing handler
                    const legacyMessage = {
                        command: message.command,
                        ...(message.payload || {})
                    };
                    this._messageHandler.handleMessage(legacyMessage);
                    return;
                }

                // Handle legacy format messages (for non-React views)
                if (message.command) {
                    this._messageHandler.handleMessage(message);
                    return;
                }

                // Handle other typed messages
                this._messageHandler.handleMessage(message);
            },
            undefined,
            []
        );

        // Listen for configuration changes to re-render when settings change
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.render();
            }
        });
    }

    public notifyLogout(): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'logoutSuccess'
            });
        }
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
        const installedExtensions = new Map<string, vscode.Extension<any>>();
        for (const ext of vscode.extensions.all) {
            installedExtensions.set(ext.id.toLowerCase(), ext);
        }

        const aiExtensions = Object.entries(AI_EXTENSIONS_BLOCKLIST)
            .flatMap(([providerName, providerData]) => {
                return providerData.extensions.map(blocklistExt => {
                    const installedExt = installedExtensions.get(blocklistExt.id.toLowerCase());
                    const packageJson = installedExt?.packageJSON ?? {};

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
        const installedExtensions = new Map<string, vscode.Extension<any>>();
        for (const ext of vscode.extensions.all) {
            installedExtensions.set(ext.id.toLowerCase(), ext);
        }

        const recommendedCategories = getRecommendedExtensionsByCategory().map(category => ({
            ...category,
            extensions: category.extensions.map(extension => {
                const installedExt = installedExtensions.get(extension.id.toLowerCase());
                const packageJson = installedExt?.packageJSON ?? {};

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

    public showCourseDetail(courseData: any): void {
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
                if (this._view) {
                    this._view.webview.postMessage({ command: 'showLoading', message: 'Checking stored credentials...' });
                }

                // Update loading message
                if (this._view) {
                    this._view.webview.postMessage({ command: 'updateLoading', message: 'Loading user information...' });
                }

                // Try to get user info directly - this validates authentication implicitly
                try {
                    const user = await this._artemisApi.getCurrentUser();
                    await this.withServerUrl(async serverUrl => {
                        logger.auth(`Auto-authenticated user: ${user.login}`);
                        await this.showDashboard({
                            username: user.login || 'User',
                            serverUrl: serverUrl,
                            user: user
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

    public async openExerciseFullscreen(exerciseData: any): Promise<void> {
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
        panel.webview.onDidReceiveMessage(async (message) => {
            // Handle 'ready' signal — send exercise data
            if (message.type === 'ready') {
                panel.webview.postMessage({
                    type: 'exerciseDetailInit',
                    payload: {
                        exerciseData: exerciseData,
                        hideDeveloperTools: false,
                    }
                });
            }

            // Handle title updates from the webview
            if (message.type === 'updatePanelTitle') {
                panel.title = `Exercise: ${message.title}`;
            }

            // Forward all other messages (commands, legacy format) to the existing handler
            // Use handleMessageWithSender so responses go back to THIS panel, not the sidebar
            const legacyMessage = (message.type === 'command' && message.command)
                ? { command: message.command, ...(message.payload || {}) }
                : message;
            this._messageHandler.handleMessageWithSender(legacyMessage, (responseMessage: any) => {
                panel.webview.postMessage(responseMessage);
            });
        });

        // Track panel for cleanup
        this._extensionContext.subscriptions.push(panel);
    }

    public async openCourseFullscreen(courseData: any): Promise<void> {
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

        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'ready') {
                // Read developer mode setting
                const config = vscode.workspace.getConfiguration('artemis');
                const developerMode = config.get<boolean>('developerMode', false);
                const hideDeveloperTools = !developerMode;

                panel.webview.postMessage({
                    type: 'courseDetailInit',
                    payload: {
                        courseData: courseData,
                        workspaceExerciseId: null,
                        hideDeveloperTools: hideDeveloperTools
                    }
                });
            }

            if (message.type === 'updatePanelTitle') {
                panel.title = `Course: ${message.title}`;
            }

            // Forward all other messages via handleMessageWithSender
            const legacyMessage = (message.type === 'command' && message.command)
                ? { command: message.command, ...(message.payload || {}) }
                : message;
            this._messageHandler.handleMessageWithSender(legacyMessage, (responseMessage: any) => {
                panel.webview.postMessage(responseMessage);
            });
        });

        this._extensionContext.subscriptions.push(panel);
    }

    // WebSocket message handlers

    private _handleNewResult(result: ResultDTO): void {
        // Forward to webview if it exists
        if (this._view) {
            // Send typed message for React views
            this._view.webview.postMessage({
                type: 'websocketUpdate',
                payload: {
                    updateType: 'newResult',
                    data: result
                }
            });

            // Also send legacy message for backward compatibility
            this._view.webview.postMessage({
                command: 'newResult',
                result: result
            });
        }
    }

    private _handleNewSubmission(submission: ProgrammingSubmission): void {
        // Forward to webview if it exists
        if (this._view) {
            // Send typed message for React views
            this._view.webview.postMessage({
                type: 'websocketUpdate',
                payload: {
                    updateType: 'newSubmission',
                    data: submission
                }
            });

            // Also send legacy message for backward compatibility
            this._view.webview.postMessage({
                command: 'newSubmission',
                submission: submission
            });
        }
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

        // Forward to webview if it exists
        if (this._view) {
            // Send typed message for React views
            this._view.webview.postMessage({
                type: 'websocketUpdate',
                payload: {
                    updateType: 'submissionProcessing',
                    data: {
                        state: state || 'BUILDING',
                        participationId: message.participationId,
                        buildTimingInfo: buildTimingInfo
                    }
                }
            });

            // Also send legacy message for backward compatibility
            this._view.webview.postMessage({
                command: 'submissionProcessing',
                state: state || 'BUILDING',
                participationId: message.participationId,
                buildTimingInfo: buildTimingInfo
            });
        }
    }

    private async withServerUrl(
        callback: (serverUrl: string) => Promise<void> | void
    ): Promise<void> {
        const serverUrl = this._getServerUrl();
        await callback(serverUrl);
    }

    private postServerUrl(serverUrl?: string): void {
        if (!this._view) {
            return;
        }
        this._view.webview.postMessage({
            command: 'setServerUrl',
            serverUrl: serverUrl ?? this._getServerUrl()
        });
    }

    private hideLoadingAndSendServerUrl(): void {
        if (!this._view) {
            return;
        }
        this._view.webview.postMessage({ command: 'hideLoading' });
        this.postServerUrl();
    }

    private isDeveloperMode(): boolean {
        const config = vscode.workspace.getConfiguration('artemis');
        return config.get<boolean>('developerMode', false);
    }

    private async openFullscreenPanel(options: {
        viewId: string;
        title: string;
        detailHtml: () => string | Promise<string>;
        cssInjections?: string[];
        onDetect?: () => Record<string, unknown> | void;
        onDispose?: (metadata?: Record<string, unknown>) => void;
    }): Promise<void> {
        try {
            const panel = vscode.window.createWebviewPanel(
                options.viewId,
                options.title,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this._extensionUri]
                }
            );

            let fullscreenHtml = await options.detailHtml();
            if (options.cssInjections && options.cssInjections.length > 0) {
                const cssBlock = `
                    <style>
                        ${options.cssInjections.join('\n')}
                    </style>
                `;
                fullscreenHtml = fullscreenHtml.replace('</head>', cssBlock + '</head>');
            }

            panel.webview.html = fullscreenHtml;

            const metadata = options.onDetect?.() || undefined;

            panel.onDidDispose(() => {
                options.onDispose?.(metadata);
            });

            panel.webview.onDidReceiveMessage(
                message => {
                    this._messageHandler.handleMessageWithSender(message, (responseMessage: any) => {
                        panel.webview.postMessage(responseMessage);
                    });
                },
                undefined,
                []
            );
        } catch (error) {
            logger.error(`Error opening ${options.viewId}`, LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to open ${options.title} in fullscreen mode`);
        }
    }

    private _getServerUrl(): string {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
    }

    /**
     * Safely post a message to the webview, queuing it if the webview is not ready yet.
     * This prevents race conditions where messages are sent before React hydration completes.
     */
    private _postMessageSafe(message: any): void {
        if (this._webviewReady && this._view) {
            this._view.webview.postMessage(message);
        } else {
            this._pendingMessages.push(message);
        }
    }
}
