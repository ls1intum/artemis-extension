import * as vscode from 'vscode';

import { registerAllCommands } from '@extension/activation/extensionCommands';
import { ArtemisApiService } from '@extension/api';
import type { DataCollectionHandle } from '@extension/dataCollection/types';
import { ArtemisWebviewProvider, BuildErrorCodeLensProvider, ChatWebviewProvider } from '@extension/provider';
import { AuthManager } from '@extension/services/auth';
import { CourseDataCache } from '@extension/services/courseDataCache';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { LogCategory, logger } from '@extension/services/loggingService';
import { VsCodeSensorHub } from '@extension/services/sensing';
import { createProviderRegistry } from '@extension/services/ui';
import { StruggleAlertStatusBar } from '@extension/services/ui/struggleAlertStatusBar';
import { ArtemisWebsocketService, WebSocketStatusBarService } from '@extension/services/websocket';
import { NoAiDetectionService } from '@extension/services/workspace';
import {
    buildChatProviderSink,
    wireWorkspaceDetection,
} from '@extension/services/workspace/wireWorkspaceDetection';
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
	// view-resolution attempt — including Theia's layout-restore — finds a
	// registered provider with the correct environment already in place.
	const artemisApiService = new ArtemisApiService(authManager);
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
	// Forward-ref to the AskIris provider's per-exercise preference (spec §12.2): the engine reads it lazily at
	// alert-time (long after the provider below is built), so default-on until it is wired.
	let proactivePreferenceRef: ArtemisWebviewProvider['proactivePreference'] | undefined;
	const { coordinator: struggleCoordinator, promptConsentIfAsk, recordProactiveDismiss, isProactivePaused, setStudentProactive, resumeProactive, isProactiveDegraded, setInSession, dismissEpisode, getSlotDebugSnapshot, getEpisodeHistory, setSlotChangeSink } = createStruggleEngine({
		hub: sensorHub,
		exerciseRegistry,
		context,
		postIntervention: (exerciseId, body) => artemisApiService.postStruggleIntervention(exerciseId, body),
		isStudentProactiveOn: exerciseId => proactivePreferenceRef?.isProactiveOn(exerciseId) ?? true,
		openProactiveSession: async sessionId => { await chatWebviewProvider?.openProactiveSession(sessionId); },
		setProactiveBadge: on => chatWebviewProvider?.setProactiveBadge(on),
		postOptimisticBubble: (text, messageId, episodeId) => chatWebviewProvider?.postOptimisticBubble(text, messageId, episodeId),
		// State frame (not an event): the engine dedups by value, so a frame swallowed by the
		// optional chain would never be re-sent. Safe only because the provider is constructed
		// below before any slot transition can fire (alerts need the warmup; server events need
		// the WS subscribe, which no-ops until connected).
		postLiveEpisode: episodeId => chatWebviewProvider?.postLiveEpisode(episodeId),
		// C2: reveal + episode-outcome API + webview reconcile (webview side stubbed until C3/C5 wires it)
		revealAmbient: (exerciseId, episodeId, hintText, level, clientMessageId) =>
			artemisApiService.revealAmbient(exerciseId, episodeId, hintText, level, clientMessageId),
		setEpisodeOutcome: (exerciseId, episodeId, outcome) =>
			artemisApiService.setEpisodeOutcome(exerciseId, episodeId, outcome),
		postRevealBubble: (text, _localId) => chatWebviewProvider?.postOptimisticBubble(text, null),
		reconcileOptimisticBubble: (_localId, _serverId, _proactiveEpisodeId, _sentAt) => {
			// TODO C3/C5: wire to chatWebviewProvider.reconcileRevealBubble once the webview supports string-localId dedup
		},
		// C3: slot-continuity seam
		cancelOutstandingStruggleJob: (exerciseId, requestToken) =>
			artemisApiService.cancelOutstandingStruggleJob(exerciseId, requestToken),
		// C7: fold episode host->webview
		foldEpisode: (episodeId, outcome, praise) => chatWebviewProvider?.postFoldEpisode(episodeId, outcome, praise),
		// C4: stale-row suppression
		postRemoveMessage: (id) => chatWebviewProvider?.postRemoveMessage(id),
		deleteSupersededProactiveMessage: (exerciseId, messageId) =>
			artemisApiService.deleteSupersededProactiveMessage(exerciseId, messageId),
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
	});
	activeStruggleCoordinator = struggleCoordinator;
	struggleCoordinator.setWebsocketService(artemisWebsocketService);
	context.subscriptions.push(registerDebugCommands(struggleCoordinator));
	// The behind-the-seam proactive control surface the AskIris command module drives (spec §12.2). Built ONLY when
	// the engine provides the methods (the clean/no-engine build omits them), so that build never shows the switch.
	const proactiveControl = isProactivePaused && setStudentProactive && resumeProactive && isProactiveDegraded
		? { isProactivePaused, setStudentProactive, resumeProactive, isProactiveDegraded }
		: undefined;

	const websocketStatusBarService = new WebSocketStatusBarService(artemisWebsocketService);

	context.subscriptions.push(
		buildErrorCodeLensProvider,
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, buildErrorCodeLensProvider)
	);

	const updateAuthContext = async (isAuthenticated: boolean) => {
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

	const courseDataCache = new CourseDataCache(artemisApiService);
	context.subscriptions.push(courseDataCache);
	const providerRegistry = createProviderRegistry();

	context.subscriptions.push(courseDataCache.onCoursesLoaded(data => {
		const courses = data.courses;
		if (courses && Array.isArray(courses)) {
			for (const entry of courses) {
				exerciseRegistry.registerFromCourseData(entry);
			}
		}
	}));

	const artemisWebviewProvider = new ArtemisWebviewProvider({
		extensionUri: context.extensionUri,
		extensionContext: context,
		authManager,
		artemisApi: artemisApiService,
		exerciseRegistry,
		providerRegistry,
		websocketService: artemisWebsocketService,
		buildErrorCodeLensProvider,
		struggleCoordinator,
		updateAuthContext,
		courseDataCache,
		proactiveControl,
	});
	// Wire the engine's lazy preference read to the provider's preference service (built in its constructor above).
	proactivePreferenceRef = artemisWebviewProvider.proactivePreference;
	// Slot debug wiring (Task 4): connect the orchestrator's slot snapshot to the live feed.
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

	const contextStore = new ContextStore(context);
	context.subscriptions.push(contextStore);

	chatWebviewProvider = new ChatWebviewProvider(
		context.extensionUri, context, artemisApiService, artemisWebsocketService,
		noAiDetectionService, exerciseRegistry, courseDataCache,
		contextStore,
	);
	chatWebviewProvider.onDidChangeExerciseContext(({ exerciseId, exerciseRoot }) => {
		struggleCoordinator.startExerciseSession(exerciseId, exerciseRoot);
	});
	chatWebviewProvider.setStruggleCallbacks({ onEpisodeDismiss: dismissEpisode });
	context.subscriptions.push(chatWebviewProvider.onDidDismissProactive(() => recordProactiveDismiss()));
	// C3: in-session flag: toggle the slot's quiet/loud escalation branch as the chat view opens/closes.
	if (setInSession) {
		context.subscriptions.push(chatWebviewProvider.onDidChangePanelVisibility(open => setInSession(open)));
	}
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatWebviewProvider)
	);

	providerRegistry.setChatWebviewProvider(chatWebviewProvider);
	providerRegistry.setArtemisWebviewProvider(artemisWebviewProvider);

	context.subscriptions.push(wireWorkspaceDetection({
		api: artemisApiService,
		registry: exerciseRegistry,
		courseDataCache,
		sink: buildChatProviderSink(chatWebviewProvider),
		// Reopening VS Code on an already-cloned exercise only triggers passive detection (Iris chat),
		// not the webview open flow. Start the struggle session here too so detection resumes.
		onWorkspaceExerciseDetected: (id, root) => struggleCoordinator.startExerciseSession(id, root),
		// Symmetric: leaving the exercise (no workspace match) ends the session so it cannot go stale.
		onWorkspaceExerciseCleared: () => struggleCoordinator.endExerciseSession(),
	}));

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
		context, authManager, artemisApiService, artemisWebsocketService,
		providerRegistry, artemisWebviewProvider, chatWebviewProvider,
		updateAuthContext,
	}));

	// Kept as a defensive safety net for any future when-clause gating.
	// The login view itself no longer depends on this context key.
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

	// Initial auth state — checks both memory (Theia) and SecretStorage (VS Code)
	try {
		const isAuthenticated = await authManager.hasAuthToken();
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);
		websocketStatusBarService.setAuthenticated(isAuthenticated);
		if (isAuthenticated) {
			void artemisWebsocketService.connect().catch(error => {
				logger.error('Failed to connect to Artemis WebSocket on startup', LogCategory.WEBSOCKET, error);
			});
			// Ask once (only while undecided) whether Iris may proactively read code
			// when the student appears stuck. No-op in the clean build.
			void promptConsentIfAsk();
		}
	} catch (error) {
		logger.error('Error checking initial auth state', LogCategory.AUTH, error);
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', false);
		websocketStatusBarService.setAuthenticated(false);
	}

	// Data collection (consent + recorder + recording commands). Excluded from the
	// Open VSX build via the @dataCollection alias swap.
	activeDataCollection = wireDataCollection({
		context,
		artemisWebsocketService,
		struggleCoordinator,
		artemisWebviewProvider,
		chatWebviewProvider,
		capabilities,
		exerciseRegistry,
		contextStore,
		sensorHub,
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
		// one. The last URL is tracked so a no-op settings save does not log the user out.
		let lastServerUrl = resolveServerUrl();
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
			if (!event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
				return;
			}
			const newServerUrl = resolveServerUrl();
			if (newServerUrl === lastServerUrl) {
				return;
			}
			lastServerUrl = newServerUrl;
			try {
				if (!(await authManager.hasAuthToken())) {
					return;
				}
				logger.info('Artemis server URL changed; clearing credentials stored for the previous server', LogCategory.CONFIG);
				await authManager.clear();
				await updateAuthContext(false);
				artemisWebviewProvider.showLogin();
				vscode.window.showInformationMessage('Artemis server changed. Please log in again.');
			} catch (error) {
				logger.error('Failed to clear credentials after server URL change', LogCategory.AUTH, error);
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
