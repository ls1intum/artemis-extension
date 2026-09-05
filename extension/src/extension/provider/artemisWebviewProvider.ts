import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';
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
import { AuthCancellationService, AuthFlowHandler, AuthManager, OidcLoginService } from '@extension/services/auth';
import type { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import type { CourseAccessScope, CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';
import { ProblemStatementRenderService } from '@extension/services/problemStatementRenderService';
import type { SubmissionPayload } from '@extension/services/recording/types';
import { normalizePrincipal, normalizeServerUrl } from '@extension/services/session/identityKeys';
import type { IProviderRegistry } from '@extension/services/ui';
import {
    BuildDiagnosticsService,
    ExerciseOpeningService,
    FullscreenPanelManager,
    StartPageResolver,
    SubmissionWebSocketHandler,
    ViewInitDataService,
    WebviewBroadcaster,
} from '@extension/services/ui';
import type { NudgeText } from '@extension/services/ui/nudgeBannerText';
import { OFFER_TEXTS } from '@extension/services/ui/nudgeBannerText';
import { ArtemisWebsocketService } from '@extension/services/websocket';
import type { NoAiDetectionService } from '@extension/services/workspace';
import type { ILiveEngineFeed, IStruggleCoordinator } from '@extension/telemetry/contract';
import type { ExerciseDetailsResponse } from '@extension/types';
import { WebSocketMessageHandler } from '@extension/types';
import type { IArtemisWebviewProvider } from '@extension/types/IArtemisWebviewProvider';
import { CONFIG, resolveServerUrl, VSCODE_CONFIG } from '@extension/utils';
import { createRecordingWebviewHandlers } from '@dataCollection';
import { createLiveEngineFeed } from '@telemetry';

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
    private readonly _oidcLoginService: OidcLoginService;
    private readonly _authCancellation: AuthCancellationService;
    private readonly _handoverFailures: HandoverFailureStore;
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
    private readonly _proactivePreference: ProactivePreferenceService;
    private readonly _authContextUpdater: (isAuthenticated: boolean) => Promise<void>;
    private readonly _websocketService: ArtemisWebsocketService;
    private readonly _noAiDetectionService: NoAiDetectionService;
    private _websocketHandler: WebSocketMessageHandler;
    private readonly _struggleCoordinator: IStruggleCoordinator;
    private readonly _liveEngineFeed: ILiveEngineFeed;
    private readonly _renderService: ProblemStatementRenderService;
    private readonly _ssrCoordinator: WebviewSSRCoordinator;
    private readonly _navigationFacade: WebviewNavigationFacade;

    /** Authoritative nudge-banner state, replayed to a freshly-resolved view (see `_bannerNeedsReplay`). */
    private _currentBanner: { title: string; sub: string; episodeId?: string; moment?: 'stuck' | 'abandon'; offerId?: string; timerMs: number } | null = null;
    /** One-shot flag armed in `resolveWebviewView`: replay `_currentBanner` on the NEXT ready, but only once per resolve. */
    private _bannerNeedsReplay = false;

    /**
     * Stable sender reference for the sidebar webview. Created once in the ctor
     * and reused on every re-resolve so the feed's Map<Sink, refcount> always
     * sees the same key for the sidebar.
     */
    private readonly _sidebarSender: (m: ExtensionToWebviewMessage) => void;

    /**
     * Fans global push signals (proactive-consent, .noai, server-rendered
     * problem statement) out to every live webview: the sidebar plus each open
     * fullscreen panel. Producers broadcast once instead of targeting the
     * sidebar only and letting each panel re-subscribe on its own.
     */
    private readonly _broadcaster = new WebviewBroadcaster();

    private readonly _onDidChangeViewNavigation = new vscode.EventEmitter<{ from: string; to: string }>();
    public readonly onDidChangeViewNavigation = this._onDidChangeViewNavigation.event;

    private readonly _onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    public readonly onDidChangePanelVisibility = this._onDidChangePanelVisibility.event;

    private readonly _onDidNudgeBannerAction = new vscode.EventEmitter<WebCmd<typeof WebviewCmd.NudgeBannerAction>['payload']>();
    public readonly onDidNudgeBannerAction = this._onDidNudgeBannerAction.event;

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
        // One stable closure created immediately so the feed's Map<Sink,refcount>
        // always sees the same key for this sidebar host across re-resolves.
        this._sidebarSender = (m) => this._postMessageSafe(m);
        // The sidebar is a permanent broadcast target (its sender is a safe no-op
        // when no view is resolved). Panels register/unregister themselves.
        this._disposables.push(this._broadcaster, this._broadcaster.addSink(this._sidebarSender));
        this._extensionUri = deps.extensionUri;
        this._extensionContext = deps.extensionContext;
        this._authManager = deps.authManager;
        this._artemisApi = deps.artemisApi;
        this._oidcLoginService = deps.oidcLoginService;
        this._authCancellation = deps.authCancellation;
        this._handoverFailures = deps.handoverFailures;
        this._providerRegistry = deps.providerRegistry;
        this._websocketService = deps.websocketService;
        this._noAiDetectionService = deps.noAiDetectionService;
        this._struggleCoordinator = deps.struggleCoordinator;
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
        // Per-exercise proactive on/off preference. Still built here: unlike
        // course access it is not keyed by the session coordinator, and its scope callback
        // resolves on the provider.
        this._proactivePreference = new ProactivePreferenceService(
            this._extensionContext.globalState,
            () => this._currentCourseAccessScope(),
        );

        this._renderService = new ProblemStatementRenderService(this._artemisApi);
        this._disposables.push(this._renderService);

        this._buildDiagnosticsService = new BuildDiagnosticsService(this._artemisApi);
        this._buildDiagnosticsService.setCodeLensProvider(buildErrorCodeLensProvider);

        this._exerciseOpeningService = new ExerciseOpeningService(
            this._courseCatalog,
            this._struggleCoordinator,
            this._courseAccessStorage,
        );

        this._startPageResolver = new StartPageResolver(this._artemisApi, this._courseCatalog);

        // 7. Fullscreen panel manager — lazy getters, safe before _messageHandler / _viewInitDataService exist.
        this._fullscreenPanelManager = new FullscreenPanelManager(
            this._extensionUri,
            this._extensionContext,
            () => this._messageHandler,
            () => this._viewInitDataService,
            this._broadcaster,
        );

        // 7b. SSR coordinator — owns the theme listener and background SSR.
        //     Must be built BEFORE the navigation facade because the facade's
        //     backgroundRenderProblemStatement callback routes through it.
        //     Broadcasts the rendered PS (tagged with exerciseId) to every open
        //     webview; each exercise view applies only its own exercise's render.
        this._ssrCoordinator = new WebviewSSRCoordinator({
            appStateManager: this._appStateManager,
            renderService: this._renderService,
            postMessage: (msg) => this._broadcaster.broadcast(msg),
            fetchExerciseDetails: (exerciseId) => fetchAndEnrichExerciseDetails(this._artemisApi, exerciseId),
        });
        this._disposables.push(this._ssrCoordinator);

        // 7c. Global push producers → broadcast to every open webview. Registered at
        //     provider lifetime (NOT per sidebar resolve) because they now also feed
        //     persistent fullscreen panels; the sidebar sender is a no-op with no view.
        this._disposables.push(
            // #342: a proactive-help consent flip repaints the AskIris card (grant restores the
            // remembered level, revoke parks it at Off); the view re-requests its control state.
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(`${VSCODE_CONFIG.IRIS.SECTION}.${VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY}`)) {
                    this._broadcaster.broadcast({ type: ExtensionMsg.UpdateProactiveConsent });
                }
            }),
            // #334: a .noai create/delete live-refreshes the exercise card (the view re-requests on this).
            this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                this._broadcaster.broadcast({ type: ExtensionMsg.UpdateNoAiStatus, isNoAiDetected });
            }),
        );

        // 8. Navigation facade — constructed BEFORE the message handler because
        //    the message handler receives the facade as its actionHandler.
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
            openStruggleFullscreen: () => this._openStruggleFullscreen(),
        });

        // 8b. Live engine-decision feed (developer-mode struggle view). Built via
        //     the @telemetry seam so the clean build never imports the real feed
        //     (which lives under the build-excluded services/struggle/ subtree).
        //     Streams to the same webview post as the init service; gated on the
        //     same artemis.developerMode probe. A new exercise session clears the
        //     buffer so the chart restarts with the session.
        this._liveEngineFeed = createLiveEngineFeed(
            this._struggleCoordinator,
            () => this._isDeveloperMode(),
        );
        this._disposables.push(
            this._liveEngineFeed,
            this._struggleCoordinator.onDidStartSession(() => this._liveEngineFeed.setSessionActive(true)),
            this._struggleCoordinator.onDidEndSession(() => this._liveEngineFeed.setSessionActive(false)),
        );

        // 9. Webview message handler — now routes commands through the facade.
        this._messageHandler = new WebViewMessageHandler(
            this._authManager,
            this._artemisApi,
            this._oidcLoginService,
            this._authCancellation,
            this._handoverFailures,
            this._appStateManager,
            this._navigationFacade,
            this._extensionContext,
            this._providerRegistry,
            this._websocketService,
            this._courseCatalog,
            this._courseAccessStorage,
            createRecordingWebviewHandlers(this._extensionContext.globalStorageUri),
            this._liveEngineFeed,
            this._proactivePreference,
            deps.proactiveControl,
        );
        this._messageHandler.setAuthContextUpdater(this._authContextUpdater);

        // Depends on the message handler being ready.
        this._viewInitDataService = new ViewInitDataService(
            this._appStateManager,
            this._struggleCoordinator,
            this._messageHandler,
            (msg) => this._postMessageSafe(msg),
            this._handoverFailures,
            this._courseAccessStorage,
        );

        // 10b. Keep the struggle snapshot panel (urgency meter + status) live: the
        //      init is a one-shot, so without this it freezes at the value captured
        //      when the page opened. Re-send it on each engine tick, but only while
        //      the struggle page is the active view (other pages are not re-pushed).
        //      The no-op coordinator never ticks, so the clean build does nothing.
        this._disposables.push(
            this._struggleCoordinator.onDidTick(() => {
                if (this._appStateManager.currentState === 'struggle-detection') {
                    this._viewInitDataService.sendStruggleDetectionInit();
                }
            }),
        );

        // 10c. Also refresh on session start/end. Ticks STOP when a session ends, so without this
        //      the dev timers panel would freeze on the last active-session snapshot and never flip
        //      to its "no active session" empty state (sessionActive only changes at these edges).
        const refreshStruggleIfActive = (): void => {
            if (this._appStateManager.currentState === 'struggle-detection') {
                this._viewInitDataService.sendStruggleDetectionInit();
            }
        };
        this._disposables.push(
            this._struggleCoordinator.onDidStartSession(refreshStruggleIfActive),
            this._struggleCoordinator.onDidEndSession(refreshStruggleIfActive),
        );

        // 11. Submission WS handler — fans build results into diagnostics
        //     and, for results on the currently-rendered participation, triggers
        //     a re-fetch + PS re-render so test-case checkmarks stay current.
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

        // The workspace decides which participation is rendered and is usually learned after the
        // first render has gone out; repository status updates never reached SSR before. Only a
        // render is scheduled: the render service keys on its inputs, and the app-state copy now
        // names the participation it belongs to.
        this._appStateManager.onWorkspaceModeChange = () => {
            void this._ssrCoordinator.scheduleRender();
        };

        this._disposables.push(this._onDidChangeViewNavigation);
        this._disposables.push(this._onDidChangePanelVisibility);
        this._disposables.push(this._onDidNudgeBannerAction);
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

    /** The single remembered proactive on/off preference; read by the engine's `isStudentProactiveOn` dep. */
    public get proactivePreference(): ProactivePreferenceService {
        return this._proactivePreference;
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
        this._bannerNeedsReplay = true;

        webviewView.webview.options = {
            enableScripts: true,

            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'media'),
            ]
        };

        webviewView.webview.html = getViewHtml(this._appStateManager.currentState, this._extensionContext.extensionUri, webviewView.webview);

        // Reuse the stable sidebar sender so the feed's Map<Sink,refcount>
        // always sees the same function reference for this host.
        this._messageHandler.setMessageSender(this._sidebarSender);

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

        // Re-render the sidebar HTML when developerMode changes (sidebar-only concern).
        // The proactive-consent and .noai push signals are handled once at provider
        // lifetime and broadcast to every webview (see step 7c), so they are no longer
        // wired per sidebar resolve.
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

    /** Navigate the panel to the developer struggle-detection / live-engine view. */
    public showStruggleDetection(): void {
        this._navigationFacade.showStruggleDetection();
    }

    /** Register the slot debug snapshot provider on the live engine feed. */
    public wireSlotDebug(provider: Parameters<ILiveEngineFeed['setSlotProvider']>[0]): void {
        this._liveEngineFeed.setSlotProvider(provider);
    }

    /** Push the current slot debug snapshot to any subscribed webview. */
    public pushSlotUpdate(): void {
        this._liveEngineFeed.pushSlotUpdate();
    }

    // ── Public API: nudge banner ─────────────────────────────────────

    /** Show the proactive nudge banner, caching it as the authoritative state for replay-on-ready. */
    public showNudgeBanner(text: NudgeText, episodeId: string | undefined, timerMs: number): void {
        this._currentBanner = { title: text.title, sub: text.sub, episodeId, timerMs };
        // While a fresh resolve is pending (`_bannerNeedsReplay`), `_onReady` will replay
        // `_currentBanner` exactly once as soon as the new view signals ready. Posting here too
        // would either be queued and flushed a second time, or double-show the banner once the
        // replay fires, so skip the immediate post and let the replay be the single source of truth.
        if (!this._bannerNeedsReplay) {
            this._postMessageSafe({ type: ExtensionMsg.ShowNudgeBanner, ...this._currentBanner });
        }
    }

    /** Hide the proactive nudge banner and clear the cached replay state. */
    public hideNudgeBanner(): void {
        this._currentBanner = null;
        this._postMessageSafe({ type: ExtensionMsg.HideNudgeBanner });
    }

    /**
     * Show the proactive nudge banner as an offer (spec B+): mirrors `showNudgeBanner`
     * (same caching/replay behaviour) but carries `moment`/`offerId` context and renders
     * offer-specific copy. `abandon` gets a longer timer since it is the last-chance nudge
     * before the episode gives up; `stuck` reuses the existing default timer.
     */
    public showOfferBanner(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void {
        const timerMs = o.moment === 'abandon' ? 60_000 : 15_000;
        const { title, sub } = OFFER_TEXTS[o.moment];
        this._currentBanner = { title, sub, episodeId: o.episodeId, moment: o.moment, offerId: o.offerId, timerMs };
        if (!this._bannerNeedsReplay) {
            this._postMessageSafe({ type: ExtensionMsg.ShowNudgeBanner, ...this._currentBanner });
        }
    }

    // ── BaseWebviewProvider hooks ──────────────────────────────────────

    protected _onReady(): void {
        this.sendInitData();
        // `_onReady` fires for BOTH a fresh Ready mount AND a RequestInit retry on an already-live
        // view. Gate the replay on the one-shot flag so a RequestInit never restarts a live banner's
        // 10s countdown; only a genuine fresh resolve re-arms it (see resolveWebviewView).
        if (this._bannerNeedsReplay) {
            this._bannerNeedsReplay = false;
            if (this._currentBanner) { this._postMessageSafe({ type: ExtensionMsg.ShowNudgeBanner, ...this._currentBanner }); }
        }
    }

    protected _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void {
        if (message.command === WebviewCmd.NudgeBannerAction) {
            // All three actions (showMe/dismiss/timeout) self-hide the banner in the webview, so the
            // cached state is now stale and must not be replayed on a later re-resolve.
            this._currentBanner = null;
            this._onDidNudgeBannerAction.fire(getPayload<WebCmd<typeof WebviewCmd.NudgeBannerAction>>(message));
            return;
        }
        // Route through the same serialized sender queue as the fullscreen path, binding the sidebar's
        // stable sender. This keeps getCurrentSender() correct: with all command processing serialized on
        // one queue, a sidebar command can never observe a fullscreen handleMessageWithSender override
        // (which persists across its await), so the struggle-live sink is always captured per-host correctly.
        void this._messageHandler.handleMessageWithSender(message, this._sidebarSender);
    }

    /**
     * Scope key for `CourseAccessStorageService`. Stays on the provider because
     * the storage service is constructed in this ctor with this getter as a
     * callback - moving it to the facade would create a cycle.
     */
    /**
     * Developer-mode probe — same `artemis.developerMode` setting the view-init
     * service reads to gate the developer struggle view. The live engine feed
     * only streams while this is on.
     */
    private _isDeveloperMode(): boolean {
        return vscode.workspace
            .getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
            .get<boolean>(VSCODE_CONFIG.DEVELOPER_MODE_KEY, false);
    }

    /**
     * Open the developer struggle view in its own editor tab (which VS Code can move to a separate
     * window). The panel is fed the SAME per-tick snapshot the sidebar uses, with `embedded` set so
     * the view drops its back-link, the live chart, and the pop-out button. The coordinator access
     * stays here (behind the @telemetry seam), so the always-bundled panel manager never imports the
     * engine; the no-op coordinator's onDidTick never fires, so the clean build shows a static panel.
     */
    private _openStruggleFullscreen(): void {
        this._fullscreenPanelManager.openStruggleFullscreen(
            () => this._viewInitDataService.buildStruggleDetectionInit({ embedded: true }),
            // Refresh on every tick AND on session start/end: ticks STOP when a session ends, so
            // without the edge events the panel would freeze on the last active snapshot and never
            // flip to "no active session" (mirrors the sidebar's start/end refresh).
            (refresh) => {
                const subs = [
                    this._struggleCoordinator.onDidTick(() => refresh()),
                    this._struggleCoordinator.onDidStartSession(() => refresh()),
                    this._struggleCoordinator.onDidEndSession(() => refresh()),
                ];
                return new vscode.Disposable(() => { for (const s of subs) { s.dispose(); } });
            },
            // Drop the panel's postSafe from the feed on panel close so the Map entry
            // is cleaned up even if the React side did not send an unsubscribe command.
            (postSafe) => this._liveEngineFeed.dropSink(postSafe),
        );
    }

    private _currentCourseAccessScope(): CourseAccessScope | null {
        const info = this._appStateManager.userInfo;
        if (!info) { return null; }
        const serverUrl = info.serverUrl || resolveServerUrl();
        if (!serverUrl) { return null; }
        // The scope the session coordinator keys on is already normalized; build it
        // with the same helpers so both writers agree on one key.
        const serverKey = normalizeServerUrl(serverUrl);
        const principal = normalizePrincipal({ id: info.user?.id, login: info.username || info.user?.login });
        if (!serverKey || !principal) { return null; }
        return { serverKey, principal };
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
