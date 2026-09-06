import * as vscode from 'vscode';

import type { ProactiveLevel, WebCmd } from '@shared/messageContracts';
import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { registerAllCommands } from '@extension/activation/extensionCommands';
import {
    maybeOpenGetStartedWalkthrough,
    type StartupAuthState,
    WALKTHROUGH_SHOWN_KEY,
} from '@extension/activation/onboarding';
import { ArtemisApiService } from '@extension/api';
import type { DataCollectionHandle } from '@extension/dataCollection/types';
import { ArtemisWebviewProvider, BuildErrorCodeLensProvider, ChatWebviewProvider } from '@extension/provider';
import { AuthCancellationService, AuthManager, OidcLoginService } from '@extension/services/auth';
import { ArtemisUriHandler } from '@extension/services/auth/artemisUriHandler';
import { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import { createOidcLoginCallback } from '@extension/services/auth/oidcLoginCallback';
import { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import { CourseCatalog, toRegistryEntries } from '@extension/services/courseCatalog';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { classifyIrisCourseAvailability } from '@extension/services/iris/chat/irisAvailabilityService';
import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';
import { IrisEnabledCache } from '@extension/services/iris/irisEnabledCache';
import { LogCategory, logger } from '@extension/services/loggingService';
import { VsCodeSensorHub } from '@extension/services/sensing';
import { normalizeServerUrl } from '@extension/services/session/identityKeys';
import { SessionIdentityCoordinator } from '@extension/services/session/sessionIdentityCoordinator';
import { createProviderRegistry } from '@extension/services/ui';
import { bannerActionOpensChat } from '@extension/services/ui/nudgeBannerText';
import { StruggleAlertStatusBar } from '@extension/services/ui/struggleAlertStatusBar';
import { ArtemisWebsocketService, WebSocketStatusBarService } from '@extension/services/websocket';
import { NoAiDetectionService } from '@extension/services/workspace';
import {
    buildChatProviderSink,
    wireWorkspaceDetection,
} from '@extension/services/workspace/wireWorkspaceDetection';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';
import {
    authenticateFromEnvironment,
    detectPlatformCapabilities,
    initializeTheiaContext,
} from '@extension/theia';
import { resolveServerUrl, VSCODE_CONFIG } from '@extension/utils';
import { wireDataCollection } from '@dataCollection';
import { createStruggleEngine, registerDebugCommands } from '@telemetry';

// Module-level references for deactivate() cleanup
let activeStruggleCoordinator: IStruggleCoordinator | undefined;
let activeDataCollection: DataCollectionHandle | undefined;

export async function activate(context: vscode.ExtensionContext) {
	logger.initialize();
	logger.info('Congratulations, your extension "Artemis - TUM" is now active!', LogCategory.GENERAL);

	// ── Phase A1: environment detection (must precede provider registration) ──
	// The webview provider's resolveWebviewView() reads getTheiaEnvironment()
	// and resolveServerUrl() and calls authManager.hasAuthToken(). If we
	// register the provider before Theia detection + authenticateFromEnvironment()
	// have run, a Theia layout-restore can resolve the view with the wrong
	// server URL and an empty token, leaving the user stuck on a login screen
	// that should have been bypassed.
	const theiaEnv = await initializeTheiaContext();
	const capabilities = detectPlatformCapabilities();
	logger.info(`Platform: ${theiaEnv.isTheia ? 'Theia/EduIDE' : 'VS Code Desktop'}`, LogCategory.GENERAL);

	await vscode.commands.executeCommand('setContext', 'iris:theia', theiaEnv.isTheia);
	await vscode.commands.executeCommand('setContext', 'iris:managedEnvironment', theiaEnv.isManagedEnvironment);

	const authManager = new AuthManager(context);

	if (theiaEnv.isTheia) {
		const { authenticated } = await authenticateFromEnvironment(authManager, theiaEnv);
		logger.info(`Theia auto-auth: ${authenticated ? 'success' : 'no credentials in environment'}`, LogCategory.AUTH);
	}

	// ── Phase A2: synchronous service construction & provider registration ──
	// All service constructors below are synchronous. Registering the webview
	// providers before yielding back to the event loop ensures that any
	// view-resolution attempt (including Theia's layout-restore) finds a
	// registered provider with the correct environment already in place.
	const artemisApiService = new ArtemisApiService(authManager);

	// `serverKey` is a FUNCTION: the configured URL can change at runtime, and a
	// value captured here would key every later session to the startup server.
	const sessionIdentity = new SessionIdentityCoordinator({
		serverKey: () => normalizeServerUrl(resolveServerUrl()) ?? resolveServerUrl(),
		hasAuthToken: () => authManager.hasAuthToken(),
		getCurrentUser: () => artemisApiService.getCurrentUser(),
	});
	context.subscriptions.push(sessionIdentity);

	const artemisWebsocketService = new ArtemisWebsocketService(authManager);
	const buildErrorCodeLensProvider = new BuildErrorCodeLensProvider();
	const exerciseRegistry = new ExerciseRegistry();
	const sensorHub = new VsCodeSensorHub(capabilities);
	context.subscriptions.push(sensorHub);
	// The struggle/intervention engine lives behind the @telemetry build seam:
	// real in the full build, a no-op in the Open VSX (EduIDE/cloud) build, so the
	// cloud bundle ships no tracking engine. The factory owns the whole value graph
	// (InterventionService + ThrottledAlertSink + StruggleCoordinator).
	// Forward-declared so the orchestrator's lazy chat hooks (openProactiveSession /
	// setProactiveBadge) can reach the chat provider; it is constructed below, well
	// before any alert or server event fires.
	let chatWebviewProvider: ChatWebviewProvider | undefined;
	// Forward-ref to the AskIris provider's single remembered preference: the engine reads it lazily at
	// alert-time (long after the provider below is built), so default-on until it is wired.
	let proactivePreferenceRef: ArtemisWebviewProvider['proactivePreference'] | undefined;
	// Level-aware read of the single remembered preference (issue #341, Off/Less/More);
	// `isStudentProactiveOn` derives from this rather than duplicating the lookup. Default-on until wired.
	const getProactiveLevel = (): ProactiveLevel => proactivePreferenceRef?.getLevel() ?? 'more';
	// Forward-ref: the Iris-enabled cache is constructed later (after the catalog exists), but the
	// engine's gate reads it lazily at alert-time, so a fail-closed default until it is wired.
	let irisEnabledCache: IrisEnabledCache | undefined;
	// Forward-ref: the nudge-banner deps below (showNudgeBanner/hideNudgeBanner) are only ever invoked
	// lazily (well after the provider is constructed below), so reading it through a mutable binding is safe.
	let artemisWebviewProvider: ArtemisWebviewProvider | undefined;
	const { coordinator: struggleCoordinator, promptConsentIfAsk, setStudentProactive, getProactiveGateState, setInSession, dismissEpisode, resolveEpisode, getSlotDebugSnapshot, getEpisodeHistory, setSlotChangeSink, handleBannerAction } = createStruggleEngine({
		hub: sensorHub,
		exerciseRegistry,
		context,
		isIrisEnabled: () => irisEnabledCache?.isEnabled() ?? false,
		postIntervention: (exerciseId, body) => artemisApiService.postStruggleIntervention(exerciseId, body),
		isStudentProactiveOn: () => getProactiveLevel() !== 'off',
		getProactiveLevel,
		openProactiveSession: async (courseId, sessionId) => { await chatWebviewProvider?.proactive.openProactiveSession(courseId, sessionId); },
		setProactiveBadge: on => chatWebviewProvider?.proactive.setProactiveBadge(on),
		postOptimisticBubble: (text, messageId, episodeId) => chatWebviewProvider?.proactive.postOptimisticBubble(text, messageId, episodeId),
		setProactiveThinking: on => chatWebviewProvider?.proactive.setThinking(on),
		// State frame (not an event): the engine dedups by value, so a frame swallowed by the
		// optional chain would never be re-sent. Safe only because the provider is constructed
		// below before any slot transition can fire (alerts need the warmup; server events need
		// the WS subscribe, which no-ops until connected).
		postLiveEpisode: episodeId => chatWebviewProvider?.proactive.postLiveEpisode(episodeId),
		// C2: reveal + episode-outcome API + webview reconcile (webview side stubbed until C3/C5 wires it)
		revealAmbient: (exerciseId, episodeId, hintText, level, clientMessageId) =>
			artemisApiService.revealAmbient(exerciseId, episodeId, hintText, level, clientMessageId),
		setEpisodeOutcome: (exerciseId, episodeId, outcome) =>
			artemisApiService.setEpisodeOutcome(exerciseId, episodeId, outcome),
		reconcileOptimisticBubble: (_localId, _serverId, _proactiveEpisodeId, _sentAt) => {
			// TODO C3/C5: wire to chatWebviewProvider.reconcileRevealBubble once the webview supports string-localId dedup
		},
		// #364: reveal-into-exercise navigation (persist-then-navigate). All three closures are invoked
		// lazily (only on a parked-hint reveal, long after activation), so referencing courseCatalog /
		// chatWebviewProvider (constructed below) is safe.
		resolveRevealTarget: exerciseId => {
			const courseId = courseCatalog.authoritativeCourseIdFor(exerciseId);
			const title = courseCatalog.exerciseTitle(exerciseId);
			if (courseId === undefined || !title) { return undefined; }
			return { courseId, title };
		},
		currentNavToken: () => chatWebviewProvider?.proactive.currentNavToken() ?? 0,
		openRevealSession: async (courseId, exerciseId, sessionId, title, expectedNavToken) =>
			(await chatWebviewProvider?.proactive.revealProactiveSessionForExercise(courseId, exerciseId, sessionId, title, expectedNavToken)) ?? false,
		notifyRevealUnavailable: () => {
			void vscode.window.showWarningMessage("Can't open this Iris hint. Its exercise isn't available in the workspace.");
		},
		notifyRevealFailed: () => {
			void vscode.window.showWarningMessage("Couldn't open this Iris hint.");
		},
		// C3: slot-continuity seam
		cancelOutstandingStruggleJob: (exerciseId, requestToken) =>
			artemisApiService.cancelOutstandingStruggleJob(exerciseId, requestToken),
		// C7: fold episode host->webview
		foldEpisode: (episodeId, outcome, praise) => chatWebviewProvider?.proactive.postFoldEpisode(episodeId, outcome, praise),
		// C4: stale-row suppression
		postRemoveMessage: (id) => chatWebviewProvider?.proactive.postRemoveMessage(id),
		deleteSupersededProactiveMessage: (exerciseId, messageId) =>
			artemisApiService.deleteSupersededProactiveMessage(exerciseId, messageId),
		// C5: offer-bubble transport (C6-C10 producers). Bubble + resolve go to the chat provider
		// (like postOptimisticBubble / postRemoveMessage); the offer banner mirrors showNudgeBanner's
		// reveal-if-hidden wrapper below so an offer shown while the sidebar is collapsed still surfaces.
		postOfferBubble: (o) => chatWebviewProvider?.proactive.postOfferBubble(o),
		resolveOfferBubble: (offerId, answered) => chatWebviewProvider?.proactive.resolveOfferBubble(offerId, answered),
		// Reconnect-aware subscribe primitive for the per-user struggle topic. A
		// reconnect is a fresh STOMP session, so we (re)subscribe on each connect.
		subscribeStruggleTopic: (topic, onFrame) => {
			let activeUnsub: (() => void) | undefined;
			const subscribeNow = (): void => {
				if (!artemisWebsocketService.isConnected()) { return; }
				try { activeUnsub = artemisWebsocketService.subscribeToTopic(topic, onFrame); }
				catch (error) { logger.error(`Failed to subscribe to ${topic}`, LogCategory.WEBSOCKET, error); }
			};
			subscribeNow();
			const stateSub = artemisWebsocketService.onDidChangeConnectionState(({ connected }) => {
				if (connected) { subscribeNow(); } else { activeUnsub = undefined; }
			});
			return { dispose: () => { stateSub.dispose(); try { activeUnsub?.(); } catch { /* stale sub after disconnect */ } activeUnsub = undefined; } };
		},
		showNudgeBanner: (text, episodeId, timerMs) => {
			if (artemisWebviewProvider?.getCurrentVisibility()) {
				artemisWebviewProvider.showNudgeBanner(text, episodeId, timerMs);
				return;
			}
			// Sidebar is hidden: reveal it first and post the banner only once the reveal (and the
			// best-effort editor-focus restore below) has resolved, so the webview's 10s countdown
			// never starts while the panel is still off-screen and thus invisible to the student.
			const prev = vscode.window.activeTextEditor;
			// VS Code has no no-focus reveal command for a collapsed webview view, so revealing steals
			// focus; we best-effort restore the editor the student was in, but if they were in a
			// non-editor surface (terminal/explorer) focus stays on the sidebar.
			void vscode.commands.executeCommand('artemis.loginView.focus').then(() => {
				if (prev) { void vscode.window.showTextDocument(prev.document, { viewColumn: prev.viewColumn, preserveFocus: false, selection: prev.selection }); }
				artemisWebviewProvider?.showNudgeBanner(text, episodeId, timerMs);
			});
		},
		// Offer banner: same reveal-if-hidden structure as showNudgeBanner above (an offer shown while
		// the sidebar is collapsed must reveal the panel before its countdown starts), but the copy +
		// timer are derived inside the provider from `moment`, so the wrapper just forwards the offer.
		showOfferBanner: (o) => {
			if (artemisWebviewProvider?.getCurrentVisibility()) {
				artemisWebviewProvider.showOfferBanner(o);
				return;
			}
			const prev = vscode.window.activeTextEditor;
			void vscode.commands.executeCommand('artemis.loginView.focus').then(() => {
				if (prev) { void vscode.window.showTextDocument(prev.document, { viewColumn: prev.viewColumn, preserveFocus: false, selection: prev.selection }); }
				artemisWebviewProvider?.showOfferBanner(o);
			});
		},
		hideNudgeBanner: () => artemisWebviewProvider?.hideNudgeBanner(),
	});
	activeStruggleCoordinator = struggleCoordinator;
	struggleCoordinator.setWebsocketService(artemisWebsocketService);
	context.subscriptions.push(registerDebugCommands(struggleCoordinator));
	// The behind-the-seam proactive control surface the AskIris command module drives. Built ONLY when
	// the engine provides the methods (the clean/no-engine build omits them), so that build never shows the switch.
	const proactiveControl = setStudentProactive && getProactiveGateState
		? { setStudentProactive, getProactiveGateState }
		: undefined;

	const websocketStatusBarService = new WebSocketStatusBarService(artemisWebsocketService);

	context.subscriptions.push(
		buildErrorCodeLensProvider,
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, buildErrorCodeLensProvider)
	);

	const updateAuthContext = async (isAuthenticated: boolean) => {
		if (isAuthenticated) {
			// A login just succeeded; find out who it was.
			void sessionIdentity.resolvePrincipal();
		} else {
			// The ONLY signal on the startup-401 path: AuthFlowHandler clears the
			// credentials and calls this updater without touching anything else.
			// It also bumps the attempt token, so a principal lookup still open
			// right now cannot undo it.
			sessionIdentity.setAnonymous(normalizeServerUrl(resolveServerUrl()) ?? resolveServerUrl());
		}
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);
		websocketStatusBarService.setAuthenticated(isAuthenticated);
		if (isAuthenticated) {
			artemisApiService.resetAuthExpiredGuard();
			void artemisWebsocketService.connect().catch(error => {
				logger.error('Failed to connect to Artemis WebSocket', LogCategory.WEBSOCKET, error);
			});
		} else {
			await artemisWebsocketService.disconnect();
		}
	};

	const noAiDetectionService = new NoAiDetectionService();
	context.subscriptions.push(noAiDetectionService);

	noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
		if (isNoAiDetected) {
			vscode.window.showWarningMessage(
				'Iris AI assistance is disabled because a .noai file was detected in your workspace.',
				'Learn More'
			).then(selection => {
				if (selection === 'Learn More') {
					vscode.env.openExternal(vscode.Uri.parse('https://docs.artemis.cit.tum.de'));
				}
			});
		}
	});

	const courseCatalog = new CourseCatalog(artemisApiService);
	context.subscriptions.push(courseCatalog);

	// Constructed AFTER the catalog, and reading the catalog's epoch rather
	// than `sessionIdentity.epoch`: every call site captures its epoch from the
	// catalog, and the coordinator can bump its own generation before `attach`
	// installs the first one here, which would make every recency write look
	// stale.
	const courseAccessStorage = new CourseAccessStorageService(
		context.globalState,
		() => sessionIdentity.accessScope(),
		() => courseCatalog.currentEpoch,
	);

	const providerRegistry = createProviderRegistry();

	context.subscriptions.push(courseCatalog.onCoursesLoaded(() => {
		// The registry is an INDEX over the catalog. Rebuilding rather than adding
		// is what makes a deleted exercise stop answering repository matches.
		exerciseRegistry.replaceAll(toRegistryEntries(courseCatalog.projection()));
	}));

	const oidcLoginService = new OidcLoginService(context, authManager, artemisApiService);
	const authCancellation = new AuthCancellationService(oidcLoginService);

	// Survives the login view, because the view can be recreated after the failure it needs to hear
	// about. Dropped whenever the credential it refers to goes away, which `clearInternal` is the one
	// place to observe: hooking the login view instead would miss the Theia expiry path, which clears
	// the credential and deliberately shows no login view.
	const handoverFailures = new HandoverFailureStore();

	artemisWebviewProvider = new ArtemisWebviewProvider({
		extensionUri: context.extensionUri,
		extensionContext: context,
		authManager,
		artemisApi: artemisApiService,
		oidcLoginService,
		authCancellation,
		handoverFailures,
		providerRegistry,
		websocketService: artemisWebsocketService,
		noAiDetectionService,
		buildErrorCodeLensProvider,
		struggleCoordinator,
		updateAuthContext,
		proactiveControl,
		courseAccessStorage,
		courseCatalog,
	});
	// Wire the engine's lazy preference read to the provider's preference service (built in its constructor above).
	proactivePreferenceRef = artemisWebviewProvider.proactivePreference;
	// Slot debug wiring: connect the orchestrator's slot snapshot to the live feed.
	// The provider forwards both calls into its private _liveEngineFeed.
	artemisWebviewProvider.wireSlotDebug(
		() => getSlotDebugSnapshot && getEpisodeHistory
			? { snapshot: getSlotDebugSnapshot(), episodes: [...getEpisodeHistory()] }
			: null,
	);
	setSlotChangeSink?.(() => artemisWebviewProvider.pushSlotUpdate());
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ArtemisWebviewProvider.viewType, artemisWebviewProvider)
	);
	// Route a nudge-banner button back to the engine outcome. "Show me" jumps to the flagged line
	// (via the jump lamp, inside handleBannerAction) and opens the chat. A dev mock banner (sentinel
	// id) is visual only: its buttons neither record an outcome nor open the chat.
	// Both webviews raise this: the sidebar's banner and the chat's offer bubble. One handler, two
	// sources, so an offer answered inside the chat takes exactly the same path as one answered
	// from the banner.
	const onNudgeBannerAction = (payload: WebCmd<typeof WebviewCmd.NudgeBannerAction>['payload']): void => {
		handleBannerAction?.(payload);
		// Any "see the hint" action opens the Iris chat: the active banner's "Show me" AND the offer
		// banner's accept ("Show me" / "I need more help"). #344: the offer path was previously excluded.
		if (bannerActionOpensChat(payload)) {
			void vscode.commands.executeCommand('iris.chatView.focus');
		}
	};
	context.subscriptions.push(artemisWebviewProvider.onDidNudgeBannerAction(onNudgeBannerAction));

	// Developer-only: surface the engine's live alert decision (firing / gated /
	// armed) in the status bar. Reads the coordinator's tick stream; no-op
	// coordinator never ticks, so the clean build shows nothing. Clicking it
	// reveals the panel and opens the live-engine view.
	const struggleAlertStatusBar = new StruggleAlertStatusBar(
		struggleCoordinator,
		() => vscode.workspace.getConfiguration('artemis').get<boolean>('developerMode', false),
		() => {
			artemisWebviewProvider.showStruggleDetection();
			void vscode.commands.executeCommand(`${ArtemisWebviewProvider.viewType}.focus`);
		},
	);
	context.subscriptions.push(struggleAlertStatusBar);

	// Both halves of "the credential is gone": drop the record that outlives the view, and tell a view
	// that is currently on screen. The second one is not covered by the first: during a handover the app
	// state is already `login`, so the 401 path's `showLogin()` returns without a transition and no
	// render replaces the document.
	context.subscriptions.push(authManager.onDidClearCredential(() => {
		handoverFailures.clear();
		artemisWebviewProvider.postMessage({ type: ExtensionMsg.LoginSessionEnded });
	}));

	const oidcCallback = createOidcLoginCallback({
		oidcLoginService,
		updateAuthContext,
		handoverFailures,
		postMessage: message => artemisWebviewProvider.postMessage(message),
		navigateToStartPage: user => artemisWebviewProvider.navigateToStartPage(user),
	});
	const uriHandler = new ArtemisUriHandler(oidcCallback.onCode, oidcCallback.onError);

	context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

	// Drop the `iris.contextStore` key: an unbounded, unscoped list of every
	// course and exercise this installation ever saw, orphaned in globalState.
	void context.globalState.update('iris.contextStore', undefined);

	const workspaceTracker = new WorkspaceExerciseTracker();
	context.subscriptions.push(workspaceTracker);

	// Iris-enabled gate (no proactive struggle interventions when Iris is disabled for the
	// course): keyed to the struggle exercise session, refreshed on session start/end and on
	// websocket reconnect (a transient 'unavailable' classification deserves a retry).
	const irisReconnect = new vscode.EventEmitter<void>();
	context.subscriptions.push(
		irisReconnect,
		artemisWebsocketService.onDidChangeConnectionState((e) => { if (e.connected) { irisReconnect.fire(); } }),
	);
	irisEnabledCache = new IrisEnabledCache({
		classify: async (exerciseId) => {
			const courseId = await resolveCourseIdForExercise(exerciseId, courseCatalog, artemisApiService);
			if (courseId === undefined) { return 'unavailable'; }
			const { availability } = await classifyIrisCourseAvailability(
				artemisApiService,
				courseCatalog,
				{ type: 'course', id: courseId, title: courseCatalog.courseTitle(courseId) ?? `course ${courseId}` },
			);
			return availability.kind;
		},
		onSessionStart: struggleCoordinator.onDidStartSession,
		onSessionEnd: struggleCoordinator.onDidEndSession,
		onReconnect: irisReconnect.event,
		getActiveExerciseId: () => struggleCoordinator.activeExerciseId,
		schedule: (fn, ms) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); },
	});
	context.subscriptions.push(irisEnabledCache);

	chatWebviewProvider = new ChatWebviewProvider(
		context.extensionUri, context, artemisApiService, artemisWebsocketService,
		noAiDetectionService, exerciseRegistry, courseCatalog, struggleCoordinator,
		workspaceTracker, courseAccessStorage, sessionIdentity,
	);
	chatWebviewProvider.onDidChangeExerciseContext(({ exerciseId, exerciseRoot }) => {
		struggleCoordinator.startExerciseSession(exerciseId, exerciseRoot);
	});
	chatWebviewProvider.proactive.setStruggleCallbacks({ onEpisodeDismiss: dismissEpisode, onEpisodeResolve: resolveEpisode });
	// Same handler as the sidebar banner above: an offer answered in the chat bubble must reach the
	// engine, not the unhandled-command log. Subscribed here because the provider exists only now.
	context.subscriptions.push(chatWebviewProvider.onDidNudgeBannerAction(onNudgeBannerAction));
	// C3: in-session flag: toggle the slot's quiet/loud escalation branch as the chat view opens/closes.
	if (setInSession) {
		context.subscriptions.push(chatWebviewProvider.onDidChangePanelVisibility(open => setInSession(open)));
	}
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatWebviewProvider)
	);

	providerRegistry.setChatWebviewProvider(chatWebviewProvider);
	providerRegistry.setArtemisWebviewProvider(artemisWebviewProvider);

	sessionIdentity.attach({
		resetConversation: () => chatWebviewProvider.resetForSessionChange(),
		endTelemetrySession: () => struggleCoordinator.endExerciseSession(),
		clearWorkspaceTracker: () => workspaceTracker.clear(),
		clearCatalog: () => courseCatalog.resetTo(sessionIdentity.epoch),
		resetRegistry: () => exerciseRegistry.reset(),
		publishEmptyChatSnapshot: () => chatWebviewProvider.publishSnapshot(),
		rearmStartup: () => chatWebviewProvider.resetStartupForNewSession(),
	});

	const workspaceDetection = wireWorkspaceDetection({
		api: artemisApiService,
		registry: exerciseRegistry,
		courseCatalog,
		sink: buildChatProviderSink(chatWebviewProvider),
		// Reopening VS Code on an already-cloned exercise only triggers passive detection (Iris chat),
		// not the webview open flow. Start the struggle session here too so detection resumes.
		onWorkspaceExerciseDetected: (id, root) => struggleCoordinator.startExerciseSession(id, root),
		// Symmetric: leaving the exercise (no workspace match) ends the session so it cannot go stale.
		onWorkspaceExerciseCleared: () => struggleCoordinator.endExerciseSession(),
		session: sessionIdentity,
	});
	context.subscriptions.push(workspaceDetection);
	chatWebviewProvider.attachStartupDetection(workspaceDetection);

	context.subscriptions.push(struggleCoordinator);
	context.subscriptions.push(artemisWebsocketService);
	context.subscriptions.push(websocketStatusBarService);

	// Task-feedback view lifecycle → engine (consent-independent). The engine
	// must see feedback views even when recording is OFF, so this is wired here
	// rather than inside sessionRecorderWiring (whose own feedback subscriptions
	// only run while recording). Wrapped in try/catch because the hub's internal
	// emitters do NOT isolate listener errors (see sensorHub.ts).
	context.subscriptions.push(artemisWebviewProvider.onDidOpenTaskFeedback(p => {
		try { sensorHub.emitTaskFeedbackView('opened', p.viewId); } catch (err) {
			logger.error('emitTaskFeedbackView(opened) failed', LogCategory.TELEMETRY, err);
		}
	}));
	context.subscriptions.push(artemisWebviewProvider.onDidCloseTaskFeedback(p => {
		try { sensorHub.emitTaskFeedbackView('closed', p.viewId); } catch (err) {
			logger.error('emitTaskFeedbackView(closed) failed', LogCategory.TELEMETRY, err);
		}
	}));

	context.subscriptions.push(registerAllCommands({
		authManager, artemisApiService, artemisWebsocketService,
		providerRegistry, artemisWebviewProvider, chatWebviewProvider,
		updateAuthContext, authCancellation,
	}));

	// Defensive safety net for future when-clause gating; no view reads this key.
	void vscode.commands.executeCommand('setContext', 'iris:extensionReady', true);

	// ── Phase B: async initialization (UI already responsive) ────────

	// 401 handler: environment-aware auth teardown
	if (theiaEnv.isTheia) {
		// Theia tool tokens have a fixed 1-day lifetime and the operator
		// injects credentials only once at session boot, so a 401 means the
		// session is unrecoverable from inside the extension. Direct the
		// student back to "Open Online IDE" to start a fresh session.
		artemisApiService.onAuthExpired = () => {
			void updateAuthContext(false);
			vscode.window.showErrorMessage(
				'Your session has expired. Please restart your workspace to re-authenticate.'
			);
		};
	} else {
		// VS Code: interactive re-authentication via sidebar
		artemisApiService.onAuthExpired = () => {
			void updateAuthContext(false);
			artemisWebviewProvider.showLogin();
			vscode.window.showWarningMessage(
				'Your session has expired. Please log in again.',
				'Log In'
			).then(action => {
				if (action === 'Log In') {
					vscode.commands.executeCommand('artemis.login');
				}
			});
		};
	}

	// Establishes the identity independently of any webview. `AuthFlowHandler`
	// only runs when the Artemis SIDEBAR resolves, and a student who works in
	// the Iris chat alone never resolves it.
	void sessionIdentity.resolvePrincipal();

	// Initial auth state: checks both memory (Theia) and SecretStorage (VS Code).
	let startupAuthState: StartupAuthState = 'unknown';
	try {
		const isAuthenticated = await authManager.hasAuthToken();
		startupAuthState = isAuthenticated ? 'has-credentials' : 'no-credentials';
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);
		websocketStatusBarService.setAuthenticated(isAuthenticated);
		if (isAuthenticated) {
			void artemisWebsocketService.connect().catch(error => {
				logger.error('Failed to connect to Artemis WebSocket on startup', LogCategory.WEBSOCKET, error);
			});
			// Ask once (only while undecided) whether to enable proactive help: local
			// struggle detection plus code reading when it triggers (#349). No-op in
			// the clean build.
			void promptConsentIfAsk();
		}
	} catch (error) {
		logger.error('Error checking initial auth state', LogCategory.AUTH, error);
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', false);
		websocketStatusBarService.setAuthenticated(false);
	}

	// Runs here and not earlier: the decision reads the credential state, and above is
	// the first point where that state has actually settled.
	void maybeOpenGetStartedWalkthrough({
		authState: startupAuthState,
		contributedWalkthroughs: (context.extension.packageJSON as { contributes?: { walkthroughs?: unknown } })
			.contributes?.walkthroughs,
		extensionId: context.extension.id,
		isTheia: theiaEnv.isTheia,
		wasShown: () => context.globalState.get<boolean>(WALKTHROUGH_SHOWN_KEY, false),
		markShown: () => context.globalState.update(WALKTHROUGH_SHOWN_KEY, true),
		openWalkthrough: walkthroughId =>
			vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId),
	}).catch(error => {
		logger.error('Failed to open the Get Started walkthrough', LogCategory.GENERAL, error);
	});

	// Data collection (consent + recorder + recording commands). Noop for both shipped
	// variants (Desktop full + Open VSX) via the @dataCollection alias swap; real only
	// for the local-recording build.
	activeDataCollection = wireDataCollection({
		context,
		artemisWebsocketService,
		struggleCoordinator,
		artemisWebviewProvider,
		chatWebviewProvider,
		capabilities,
		exerciseRegistry,
		sensorHub,
		workspaceTracker,
	});

	// Configuration listener for the Artemis server URL.
	if (theiaEnv.isManagedEnvironment) {
		// In managed Theia environments, revert unauthorized changes to the locked setting.
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`) && theiaEnv.artemisUrl) {
				const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
				void config.update(VSCODE_CONFIG.SERVER_URL_KEY, theiaEnv.artemisUrl, vscode.ConfigurationTarget.Global);
				vscode.window.showWarningMessage('Server URL cannot be changed in this managed environment.');
			}
		}));
	} else {
		// On Desktop the server URL is freely configurable. When it actually changes
		// while the user is logged in, clear the stored credentials and return to the
		// login view: a token issued by the previous server is not valid on a different
		// one. Server identity is compared by normalized key (protocol, host, non-default
		// port, path), so trailing slashes and default ports do not trigger a logout.
		let lastServerKey = normalizeServerUrl(resolveServerUrl()) ?? resolveServerUrl();
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
			if (!event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
				return;
			}
			const newServerUrl = resolveServerUrl();
			const serverKey = normalizeServerUrl(newServerUrl) ?? newServerUrl;
			if (serverKey === lastServerKey) {
				return;
			}
			lastServerKey = serverKey;
			// Before the credential check on purpose: a server change while logged
			// out must still drop the previous server's courses from every
			// in-memory component.
			//
			// Deliberately NOT `resolvePrincipal()`: the stored token is global
			// rather than per server, so a lookup started here would read the OLD
			// server's token and ask the NEW server who it belongs to. A server
			// change never intends to preserve authentication, so it publishes
			// anonymous and lets the login flow resolve the principal afterwards.
			sessionIdentity.beginResolving(serverKey);
			let revision: number | undefined;
			try {
				revision = authManager.currentCredentialRevision();

				// Before the early return below: a pending attempt belongs to the previous server, and an
				// unauthenticated user can have one just as easily as an authenticated one.
				await authCancellation.cancelAll();

				// A queued read, so it cannot catch a commit halfway through and mistake a transaction's
				// temporary delete for "there is no credential".
				const { headers } = await authManager.getAuthContext();
				if (Object.keys(headers).length === 0) {
					sessionIdentity.setAnonymous(serverKey);
					return;
				}

				logger.info('Artemis server URL changed; clearing credentials stored for the previous server', LogCategory.CONFIG);
				const cleared = await authManager.clearIfUnchanged(revision);
				if (!cleared) {
					// A login for the new server committed while this was running. Its credential survives,
					// so tearing down its UI here would leave the user signed in behind a login form.
					// Session identity is left untouched for the same reason: that login's own
					// `updateAuthContext(true)` already resolves the principal (or is in the middle of
					// doing so), and calling `setAnonymous` here would either overwrite the result it just
					// produced or bump `_attempt` and make it discard its own answer when it lands.
					logger.info('Server change superseded by a newer sign-in', LogCategory.CONFIG);
					return;
				}
				await updateAuthContext(false);
				artemisWebviewProvider.showLogin();
				vscode.window.showInformationMessage('Artemis server changed. Please log in again.');
			} catch (error) {
				logger.error('Failed to clear credentials after server URL change', LogCategory.AUTH, error);
				// If a newer credential has landed since this listener started, don't interfere:
				// that login's own `updateAuthContext(true)` already handles principal resolution,
				// and calling `setAnonymous` here would either overwrite it or bump the attempt counter.
				if (revision !== undefined && authManager.currentCredentialRevision() !== revision) {
					logger.info('Server change superseded by a newer sign-in', LogCategory.CONFIG);
					return;
				}
				// `anonymous`, not the `resolving` this catch would otherwise
				// leave behind. `resolvePrincipal` may stay `resolving` on a
				// failed token read because a later login retries it; nothing
				// retries THIS listener, so a throw (SecretStorage can reject,
				// e.g. an unavailable keychain) would park the session with no
				// access scope and, once detection is session-scoped, no
				// detection either. A server change never intends to preserve
				// authentication, so anonymous is both true and terminal.
				sessionIdentity.setAnonymous(serverKey);
			}
		}));
	}
}

export async function deactivate(): Promise<void> {
	if (activeDataCollection) {
		try {
			await activeDataCollection.dispose();
		} catch (err) {
			logger.error('Failed to dispose data collection during deactivate', LogCategory.TELEMETRY, err);
		}
		activeDataCollection = undefined;
	}
	if (activeStruggleCoordinator) {
		try {
			// Explicit dispose so session-end + command/status-bar teardown
			// run before VS Code disposes context.subscriptions. dispose() is
			// idempotent, so the subscription teardown is a safe no-op.
			activeStruggleCoordinator.dispose();
		} catch (err) {
			logger.error('Failed to dispose StruggleCoordinator during deactivate', LogCategory.TELEMETRY, err);
		}
		activeStruggleCoordinator = undefined;
	}
}
