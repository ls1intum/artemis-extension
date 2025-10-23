import * as vscode from 'vscode';
import { AuthManager } from '../../auth';
import { ArtemisApiService } from '../../api';
import { ArtemisWebsocketService } from '../../services';
import { CONFIG, VSCODE_CONFIG } from '../../utils';
import { AI_EXTENSIONS_BLOCKLIST } from '../../utils/aiExtensionsBlocklist';
import { getRecommendedExtensionsByCategory } from '../../utils/recommendedExtensions';
import { AppStateManager, type UserInfo } from '../app/appStateManager';
import { WebViewMessageHandler } from '../app/webViewMessageHandler';
import type { WebViewActionHandler } from '../app/types';
import { ViewActionService } from '../app/viewActionService';
import { ViewRouter } from '../app/viewRouter';
import { ExerciseDetailView } from '../templates/exerciseDetailView';
import { CourseDetailView } from '../templates/courseDetailView';
import { StyleManager } from '../styles';
import { ExerciseRegistry } from './exerciseRegistry';
import { WebSocketMessageHandler, ResultDTO, ProgrammingSubmission, SubmissionProcessingMessage } from '../../types';

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
    private readonly _styleManager: StyleManager;

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
            this
        );
        this._styleManager = new StyleManager(this._extensionUri);
    }

    /**
     * Set the authentication context updater function
     */
    public setAuthContextUpdater(updater: (isAuthenticated: boolean) => Promise<void>): void {
        this._authContextUpdater = updater;
        // Also pass it to the message handler
        (this._messageHandler as any).setAuthContextUpdater(updater);
    }

    /**
     * Set the WebSocket service for real-time updates
     */
    public setWebsocketService(websocketService: ArtemisWebsocketService): void {
        this._websocketService = websocketService;
        
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
    public render(): void {
        if (this._view) {
            this._view.webview.html = this._viewRouter.getHtml();
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
                        participations[0].repositoryUri
                    );
                    console.log('📚 [Exercise Registry] Registered individual exercise:', exerciseTitle);
                }
                
                const chatProvider = (global as any).chatWebviewProvider;
                if (chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
                    // Extract date fields from exercise
                    const releaseDate = exercise.releaseDate || exercise.startDate;
                    const dueDate = exercise.dueDate;
                    const shortName = exercise.shortName;
                    chatProvider.updateDetectedExercise(exerciseTitle, exerciseIdFromData, releaseDate, dueDate, shortName);
                }
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        // Initialize the ViewRouter now that we have the webview
        this._viewRouter = new ViewRouter(this._appStateManager, this._extensionContext, webviewView.webview);

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,

            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._viewRouter.getHtml();

        // Set up message sender for the message handler
        this._messageHandler.setMessageSender((message: any) => {
            if (this._view) {
                this._view.webview.postMessage(message);
            }
        });

        // Check if server URL has changed and clear credentials if needed
        this._checkServerUrlChange();
        
        // Check for existing authentication and auto-login if valid
        this._checkExistingAuthentication();

        // Handle messages from the webview using the message handler
        webviewView.webview.onDidReceiveMessage(
            message => {
                this._messageHandler.handleMessage(message);
            },
            undefined,
            []
        );

        // Listen for configuration changes to re-render when settings change
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.hideDeveloperTools') || 
                event.affectsConfiguration('artemis.theme')) {
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
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
            
            // Send server URL to the webview
            this._view.webview.postMessage({
                command: 'setServerUrl',
                serverUrl: serverUrl
            });
        }
    }

    public async showCourseList(): Promise<void> {
        try {
            await this._appStateManager.showCourseList();
            if (this._view) {
                this.render();
            }
        } catch (error) {
            console.error('Error loading courses:', error);
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
        console.log(`📚 [Course Detail] Loading course: ${courseName}`);
        
        registry.registerFromCourseData(courseData);
        
        // Log what was registered
        const allExercises = registry.getAllExercises();
        console.log(`📚 [Course Detail] Registry now contains ${allExercises.length} exercises total`);
        if (allExercises.length > 0) {
            console.log('📚 [Course Detail] Exercises in registry:');
            allExercises.forEach(ex => {
                console.log(`   - ${ex.id}: ${ex.title}`);
                console.log(`     Repository: ${ex.repositoryUri}`);
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
            console.error('Error checking server URL change:', error);
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
                    const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                    const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
                    
                    console.log(`Auto-authenticated user: ${user.login}`);
                    await this.showDashboard({
                        username: user.login || 'User',
                        serverUrl: serverUrl,
                        user: user
                    });
                } catch (userError) {
                    // If getCurrentUser fails, stored credentials are invalid
                    console.log('Stored credentials are invalid, clearing...');
                    await this._authManager.clear();
                    
                    // Update authentication context
                    if (this._authContextUpdater) {
                        await this._authContextUpdater(false);
                    }
                    
                    // Hide loading and show login
                    if (this._view) {
                        this._view.webview.postMessage({ command: 'hideLoading' });
                        
                        // Send server URL for status checking
                        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                        const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
                        this._view.webview.postMessage({
                            command: 'setServerUrl',
                            serverUrl: serverUrl
                        });
                    }
                }
            } else {
                // No stored authentication, hide loading
                if (this._view) {
                    this._view.webview.postMessage({ command: 'hideLoading' });
                    
                    // Send server URL for status checking
                    const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                    const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
                    this._view.webview.postMessage({
                        command: 'setServerUrl',
                        serverUrl: serverUrl
                    });
                }
            }
        } catch (error) {
            console.error('Error checking existing authentication:', error);
            // If there's an error, clear potentially corrupted credentials and hide loading
            await this._authManager.clear();
            
            // Update authentication context
            if (this._authContextUpdater) {
                await this._authContextUpdater(false);
            }
            
            if (this._view) {
                this._view.webview.postMessage({ command: 'hideLoading' });
                
                // Send server URL for status checking even on error
                const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
                this._view.webview.postMessage({
                    command: 'setServerUrl',
                    serverUrl: serverUrl
                });
            }
        }
    }

    public async openExerciseFullscreen(exerciseData: any): Promise<void> {
        try {
            // Read developer tools setting
            const config = vscode.workspace.getConfiguration('artemis');
            const hideDeveloperTools = config.get<boolean>('hideDeveloperTools', false);
            
            // Create a new webview panel for the exercise content
            const panel = vscode.window.createWebviewPanel(
                'exerciseFullscreen',
                `Exercise: ${exerciseData.exercise?.title || exerciseData.title || 'Untitled'}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this._extensionUri]
                }
            );

            // Generate the same HTML content as the sidebar view but for the fullscreen panel
            const exerciseDetailView = new ExerciseDetailView(this._extensionContext, this._styleManager);
            let fullscreenHtml = exerciseDetailView.generateHtml(exerciseData, hideDeveloperTools);
            
            // Add CSS to hide navigation buttons in fullscreen view
            const hideButtonsCSS = `
                <style>
                    .back-link,
                    .fullscreen-btn {
                        display: none !important;
                    }
                </style>
            `;
            
            // Insert the CSS before the closing </head> tag
            fullscreenHtml = fullscreenHtml.replace('</head>', hideButtonsCSS + '</head>');
            
            panel.webview.html = fullscreenHtml;

            // Notify Iris chat about the detected exercise
            const exerciseTitle = exerciseData.exercise?.title || exerciseData.title || 'Untitled';
            const exerciseId = exerciseData.exercise?.id || exerciseData.id || 0;
            const shortName = exerciseData.exercise?.shortName || exerciseData.shortName;
            
            const chatProvider = (global as any).chatWebviewProvider;
            if (chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
                chatProvider.updateDetectedExercise(exerciseTitle, exerciseId, undefined, undefined, shortName);
            }

            // Remove from Iris chat when the panel is closed
            panel.onDidDispose(() => {
                const chatProvider = (global as any).chatWebviewProvider;
                if (chatProvider && typeof chatProvider.removeDetectedExercise === 'function') {
                    chatProvider.removeDetectedExercise(exerciseId);
                }
            });

            // Handle messages from the webview panel
            panel.webview.onDidReceiveMessage(
                message => {
                    // Use the new method that allows specifying a custom response sender
                    this._messageHandler.handleMessageWithSender(message, (responseMessage: any) => {
                        panel.webview.postMessage(responseMessage);
                    });
                },
                undefined,
                []
            );

        } catch (error) {
            console.error('Error opening exercise in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open exercise in fullscreen mode');
        }
    }

    public async openCourseFullscreen(courseData: any): Promise<void> {
        try {
            // Read developer tools setting
            const config = vscode.workspace.getConfiguration('artemis');
            const hideDeveloperTools = config.get<boolean>('hideDeveloperTools', false);
            
            // Create a new webview panel for the course content
            const panel = vscode.window.createWebviewPanel(
                'courseFullscreen',
                `Course: ${courseData.course?.title || courseData.title || 'Untitled'}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this._extensionUri]
                }
            );

            // Generate the same HTML content as the sidebar view but for the fullscreen panel
            const courseDetailView = new CourseDetailView(this._extensionContext, this._styleManager);
            let fullscreenHtml = courseDetailView.generateHtml(courseData, hideDeveloperTools);
            
            // Add CSS to hide navigation buttons and reduce top spacing in fullscreen view
            const hideButtonsCSS = `
                <style>
                    .back-link,
                    .fullscreen-btn {
                        display: none !important;
                    }
                    .course-header {
                        margin-top: 0 !important;
                    }
                </style>
            `;
            
            // Insert the CSS before the closing </head> tag
            fullscreenHtml = fullscreenHtml.replace('</head>', hideButtonsCSS + '</head>');
            
            panel.webview.html = fullscreenHtml;

            // Notify Iris chat about the detected course
            const course = courseData?.course || courseData;
            if (course) {
                const courseTitle = course.title || 'Untitled Course';
                const courseId = course.id || 0;
                const shortName = course.shortName;
                
                const chatProvider = (global as any).chatWebviewProvider;
                if (chatProvider && typeof chatProvider.updateDetectedCourse === 'function') {
                    chatProvider.updateDetectedCourse(courseTitle, courseId, shortName);
                }
            }

            // Remove from Iris chat when the panel is closed
            panel.onDidDispose(() => {
                if (course) {
                    const chatProvider = (global as any).chatWebviewProvider;
                    if (chatProvider && typeof chatProvider.removeDetectedCourse === 'function') {
                        chatProvider.removeDetectedCourse(course.id);
                    }
                }
            });

            // Handle messages from the webview panel
            panel.webview.onDidReceiveMessage(
                message => {
                    // Use the new method that allows specifying a custom response sender
                    this._messageHandler.handleMessageWithSender(message, (responseMessage: any) => {
                        panel.webview.postMessage(responseMessage);
                    });
                },
                undefined,
                []
            );

        } catch (error) {
            console.error('Error opening course in fullscreen:', error);
            vscode.window.showErrorMessage('Failed to open course in fullscreen mode');
        }
    }

    // WebSocket message handlers

    private _handleNewResult(result: ResultDTO): void {
        // Forward to webview if it exists
        if (this._view) {
            this._view.webview.postMessage({
                command: 'newResult',
                result: result
            });
        }
    }

    private _handleNewSubmission(submission: ProgrammingSubmission): void {
        // Forward to webview if it exists
        if (this._view) {
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
            state = 'BUILDING' as any;
        }
        
        // Create build timing info from the message
        const buildTimingInfo = message.buildTimingInfo || {
            buildStartDate: message.buildStartDate,
            estimatedCompletionDate: message.estimatedCompletionDate,
            submissionDate: message.submissionDate
        };
        
        // Forward to webview if it exists
        if (this._view) {
            this._view.webview.postMessage({
                command: 'submissionProcessing',
                state: state || 'BUILDING',
                participationId: message.participationId,
                buildTimingInfo: buildTimingInfo
            });
        }
    }
}
