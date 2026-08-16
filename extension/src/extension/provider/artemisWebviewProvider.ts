import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';
import type {
    ProblemStatementScrollPayload,
    ProblemStatementSelectionPayload,
    TaskFeedbackClosedPayload,
    TaskFeedbackOpenedPayload,
    TestResultsOverviewClosedPayload,
    TestResultsOverviewOpenedPayload,
} from '@shared/messageContracts/webviewCommands';

import { ArtemisApiService } from '@extension/api';
import { AppStateManager } from '@extension/controller/appStateManager';
import { fetchAndEnrichExerciseDetails } from '@extension/controller/exerciseDataLoader';
import { getViewHtml } from '@extension/controller/viewRouter';
import { WebViewMessageHandler } from '@extension/controller/webViewMessageHandler';
import type { ArtemisUser, ResultDTO } from '@extension/domain';
import { AuthFlowHandler, AuthManager } from '@extension/services/auth';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ProblemStatementRenderService } from '@extension/services/problemStatementRenderService';
import type { ITelemetryManager } from '@extension/services/telemetry';
import type { SubmissionPayload } from '@extension/services/telemetry/recording/types';
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
import type { ExerciseDetailsResponse } from '@extension/types';
import { WebSocketMessageHandler } from '@extension/types';
import type { IArtemisWebviewProvider } from '@extension/types/IArtemisWebviewProvider';
import { CONFIG, resolveServerUrl } from '@extension/utils';
import { createRecordingWebviewHandlers } from '@dataCollection';

import type { ArtemisWebviewProviderDeps } from './artemisWebviewProviderDeps';
import { BaseWebviewProvider } from './baseWebviewProvider';
import { shouldRefreshPSForResult } from './problemStatementRefreshDecision';
import { WebviewNavigationFacade } from './webviewNavigationFacade';
import { WebviewSSRCoordinator } from './webviewSSRCoordinator';

/**
 * Main webview provider for the Artemis sidebar panel.
 *
 * A thin coordinator that owns the `vscode.WebviewView` and wires services
 * together. Navigation actions live in `WebviewNavigationFacade`; background
 * problem-statement SSR (including the theme-change listener that invalidates
 * the render cache) lives in `WebviewSSRCoordinator`. `showLogin()` stays a
 * public delegation so external callers in `extension.ts` and
 * `extensionCommands.ts` do not need to know about the facade.
 */
export class ArtemisWebviewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable, IArtemisWebviewProvider {
    public static readonly viewType = CONFIG.WEBVIEW.VIEW_TYPE;

    private readonly _extensionUri: vscode.Uri;
    private readonly _extensionContext: vscode.ExtensionContext;
    private readonly _authManager: AuthManager;
    private readonly _artemisApi: ArtemisApiService;
    private readonly _providerRegistry: IProviderRegistry;
    private readonly _courseCatalog?: CourseCatalog;
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
    private readonly _telemetryManager: ITelemetryManager;
    private readonly _renderService: ProblemStatementRenderService;
    private readonly _ssrCoordinator: WebviewSSRCoordinator;
    private readonly _navigationFacade: WebviewNavigationFacade;

    private readonly _onDidChangeViewNavigation = new vscode.EventEmitter<{ from: string; to: string }>();
    public readonly onDidChangeViewNavigation = this._onDidChangeViewNavigation.event;

    private readonly _onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    public readonly onDidChangePanelVisibility = this._onDidChangePanelVisibility.event;

    private readonly _onDidOpenTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewOpenedPayload>();
    private readonly _onDidCloseTestResultsOverview = new vscode.EventEmitter<TestResultsOverviewClosedPayload>();
    private readonly _onDidOpenTaskFeedback = new vscode.EventEmitter<TaskFeedbackOpenedPayload>();
    private readonly _onDidCloseTaskFeedback = new vscode.EventEmitter<TaskFeedbackClosedPayload>();
    private readonly _onDidSubmission = new vscode.EventEmitter<SubmissionPayload>();
    private readonly _onDidProblemStatementScroll = new vscode.EventEmitter<ProblemStatementScrollPayload>();
    private readonly _onDidProblemStatementSelection = new vscode.EventEmitter<ProblemStatementSelectionPayload>();

    public readonly onDidOpenTestResultsOverview = this._onDidOpenTestResultsOverview.event;
    public readonly onDidCloseTestResultsOverview = this._onDidCloseTestResultsOverview.event;
    public readonly onDidOpenTaskFeedback = this._onDidOpenTaskFeedback.event;
    public readonly onDidCloseTaskFeedback = this._onDidCloseTaskFeedback.event;
    public readonly onDidSubmission = this._onDidSubmission.event;
    public readonly onDidProblemStatementScroll = this._onDidProblemStatementScroll.event;
    public readonly onDidProblemStatementSelection = this._onDidProblemStatementSelection.event;

    constructor(deps: ArtemisWebviewProviderDeps) {
        super();
        this._extensionUri = deps.extensionUri;
        this._extensionContext = deps.extensionContext;
        this._authManager = deps.authManager;
        this._artemisApi = deps.artemisApi;
        this._providerRegistry = deps.providerRegistry;
        this._websocketService = deps.websocketService;
        this._telemetryManager = deps.telemetryManager;
        this._authContextUpdater = deps.updateAuthContext;
        this._courseCatalog = deps.courseCatalog;
        const buildErrorCodeLensProvider = deps.buildErrorCodeLensProvider;

        this._appStateManager = new AppStateManager();
        if (this._courseCatalog) {
            this._appStateManager.setCourseCatalog(this._courseCatalog);
        }

        // Built by activation, where the session coordinator that keys its
        // scope lives.
        this._courseAccessStorage = deps.courseAccessStorage;

        this._renderService = new ProblemStatementRenderService(this._artemisApi);
        this._disposables.push(this._renderService);

        this._buildDiagnosticsService = new BuildDiagnosticsService(this._artemisApi);
        this._buildDiagnosticsService.setCodeLensProvider(buildErrorCodeLensProvider);

        this._exerciseOpeningService = new ExerciseOpeningService(
            this._courseCatalog,
            this._telemetryManager,
            this._courseAccessStorage,
        );

        this._startPageResolver = new StartPageResolver(this._artemisApi, this._courseCatalog);

        // Only stores the getter, so it is safe before _messageHandler exists.
        this._fullscreenPanelManager = new FullscreenPanelManager(
            this._extensionUri,
            this._extensionContext,
            () => this._messageHandler,
        );

        // Owns the theme listener and background SSR. Must be built BEFORE the
        // navigation facade, whose backgroundRenderProblemStatement callback
        // routes through it.
        this._ssrCoordinator = new WebviewSSRCoordinator({
            appStateManager: this._appStateManager,
            renderService: this._renderService,
            postMessage: (msg) => this._postMessageSafe(msg),
            fetchExerciseDetails: (exerciseId) => fetchAndEnrichExerciseDetails(this._artemisApi, exerciseId),
        });
        this._disposables.push(this._ssrCoordinator);

        // Constructed BEFORE the message handler, which receives the facade as
        // its actionHandler.
        this._navigationFacade = new WebviewNavigationFacade({
            appStateManager: this._appStateManager,
            artemisApi: this._artemisApi,
            websocketService: this._websocketService,
            courseAccessStorage: this._courseAccessStorage,
            fullscreenPanelManager: this._fullscreenPanelManager,
            exerciseOpeningService: this._exerciseOpeningService,
            startPageResolver: this._startPageResolver,
            courseCatalog: this._courseCatalog,
            postMessage: (msg) => this._postMessageSafe(msg),
            render: () => this.render(),
            sendInitData: () => this.sendInitData(),
            backgroundRenderProblemStatement: () => void this._ssrCoordinator.scheduleRender(),
            getServerUrl: () => resolveServerUrl(),
        });

        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._appStateManager,
            this._navigationFacade,
            this._extensionContext,
            this._providerRegistry,
            this._websocketService,
            this._courseCatalog,
            this._courseAccessStorage,
            createRecordingWebviewHandlers(this._extensionContext.globalStorageUri),
        );
        this._messageHandler.setAuthContextUpdater(this._authContextUpdater);

        // Depends on the message handler being ready.
        this._viewInitDataService = new ViewInitDataService(
            this._appStateManager,
            this._telemetryManager,
            this._messageHandler,
            (msg) => this._postMessageSafe(msg),
            this._courseAccessStorage,
        );

        // Fans build results into diagnostics and, for results on the
        // currently-rendered participation, triggers a re-fetch plus PS
        // re-render so test-case checkmarks stay current.
        this._submissionWsHandler = new SubmissionWebSocketHandler(
            (msg) => this._postMessageSafe(msg),
            (result) => this._buildDiagnosticsService.handleBuildResult(result),
            (result) => this._onResultForPSRefresh(result),
        );

        this._authFlowHandler = new AuthFlowHandler(
            this._authManager,
            this._artemisApi,
            () => this._authContextUpdater,
            (msg) => this._postMessageSafe(msg),
            {
                onAuthenticated: (userInfo) => this._navigationFacade.navigateToStartPage(userInfo),
                hideLoadingAndSendServerUrl: () => this._navigationFacade.hideLoadingAndSendServerUrl(),
            },
        );

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
            this._onDidSubmission,
            this._onDidProblemStatementScroll,
            this._onDidProblemStatementSelection,
        );
    }

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
            enableScripts: true,

            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'media'),
            ]
        };

        webviewView.webview.html = getViewHtml(this._appStateManager.currentState, this._extensionContext.extensionUri, webviewView.webview);

        this._messageHandler.setMessageSender((message: ExtensionToWebviewMessage) => {
            this._postMessageSafe(message);
        });

        this._authFlowHandler.checkExistingAuthentication();

        const messageListener = webviewView.webview.onDidReceiveMessage(message => {
            this._handleMessage(message);
        });
        this._viewDisposables.push(messageListener);

        const visibilityListener = webviewView.onDidChangeVisibility(() => {
            this._onDidChangePanelVisibility.fire(webviewView.visible);
            if (webviewView.visible) {
                void (async () => {
                    // Auth can expire while the panel is hidden.
                    const hasAuth = await this._authManager.hasAuthToken();
                    const currentState = this._appStateManager.currentState;
                    if (!hasAuth && currentState !== 'login') {
                        logger.debug('Auth expired while panel was hidden, showing login', LogCategory.VIEW);
                        this.showLogin();
                        return;
                    }

                    // Re-fetch exercise data to capture WebSocket updates missed while hidden.
                    // Swallow fetch errors only: state-transition errors (invariant breaches)
                    // must propagate so latent bugs are not hidden by this refresh path.
                    if (currentState === 'exercise-detail') {
                        const exerciseData = this._appStateManager.currentExerciseData;
                        const exerciseId = exerciseData?.exercise?.id;
                        if (exerciseId) {
                            let freshData: ExerciseDetailsResponse | undefined;
                            try {
                                freshData = await fetchAndEnrichExerciseDetails(this._artemisApi, exerciseId);
                            } catch { /* fall through to sendInitData with cached data */ }
                            // Guard: a concurrent refresh (e.g. WS newResult-driven) may
                            // have advanced state during the await. Apply only if we are
                            // still on the same exercise.
                            if (freshData
                                && this._appStateManager.currentState === 'exercise-detail'
                                && this._appStateManager.currentExerciseData?.exercise?.id === exerciseId) {
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

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.refreshTheme();
            }
        });
        this._viewDisposables.push(configListener);
    }

    public render(): void {
        if (this._view) {
            this._resetReadyState();
            this._view.webview.html = getViewHtml(this._appStateManager.currentState, this._extensionContext.extensionUri, this._view.webview);
        }
    }

    /**
     * Send current view data to the webview without re-rendering.
     * Called on ready signal, visibility change, and after navigation state updates.
     */
    public sendInitData(): void {
        this._viewInitDataService.sendInitData();
    }

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

    public fireSubmission(payload: SubmissionPayload): void {
        this._onDidSubmission.fire(payload);
    }

    public fireProblemStatementScroll(payload: ProblemStatementScrollPayload): void {
        this._onDidProblemStatementScroll.fire(payload);
    }

    public fireProblemStatementSelection(payload: ProblemStatementSelectionPayload): void {
        this._onDidProblemStatementSelection.fire(payload);
    }

    /**
     * Send a message to the webview safely.
     */
    public postMessage(message: ExtensionToWebviewMessage): void {
        this._postMessageSafe(message);
    }

    public async navigateToStartPage(user?: ArtemisUser): Promise<void> {
        const serverUrl = resolveServerUrl();
        await this._navigationFacade.navigateToStartPage({
            username: user?.login ?? '',
            serverUrl,
            user,
    });
}
    /**
     * Thin delegation so external callers (extension.ts, extensionCommands.ts)
     * do not need to reach into the facade.
     */
    public showLogin(): void {
        this._navigationFacade.showLogin();
    }

    protected _onReady(): void {
        this.sendInitData();
    }

    protected _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void {
        this._messageHandler.handleMessage(message);
    }

    /**
     * Called for every WebSocket newResult event. Delegates the decision
     * to {@link shouldRefreshPSForResult} (kept pure for unit testing) and
     * forwards to the SSR coordinator when a refresh is warranted.
     */
    private _onResultForPSRefresh(result: ResultDTO): void {
        const exercise = this._appStateManager.currentExerciseData?.exercise;
        if (!shouldRefreshPSForResult(this._appStateManager.currentState, exercise, result)) { return; }
        const exerciseId = exercise?.id;
        if (exerciseId === undefined) { return; }
        this._ssrCoordinator.refreshFromServer({ exerciseId });
    }

}
