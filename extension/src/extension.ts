import * as vscode from 'vscode';

import { registerAllCommands } from '@extension/activation/extensionCommands';
import { ArtemisApiService } from '@extension/api';
import type { DataCollectionHandle } from '@extension/dataCollection/types';
import { ArtemisWebviewProvider, BuildErrorCodeLensProvider, ChatWebviewProvider } from '@extension/provider';
import { AuthManager } from '@extension/services/auth';
import { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import { CourseCatalog, toRegistryEntries } from '@extension/services/courseCatalog';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { LogCategory, logger } from '@extension/services/loggingService';
import { normalizeServerUrl } from '@extension/services/session/identityKeys';
import { SessionIdentityCoordinator } from '@extension/services/session/sessionIdentityCoordinator';
import type { ITelemetryManager } from '@extension/services/telemetry';
import { createProviderRegistry } from '@extension/services/ui';
import { ArtemisWebsocketService, WebSocketStatusBarService } from '@extension/services/websocket';
import { NoAiDetectionService } from '@extension/services/workspace';
import {
    buildChatProviderSink,
    wireWorkspaceDetection,
} from '@extension/services/workspace/wireWorkspaceDetection';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import {
    authenticateFromEnvironment,
    detectPlatformCapabilities,
    initializeTheiaContext,
} from '@extension/theia';
import { resolveServerUrl, VSCODE_CONFIG } from '@extension/utils';
import { wireDataCollection } from '@dataCollection';
import { createTelemetryManager } from '@telemetry';

// Module-level references for deactivate() cleanup
let activeTelemetryManager: ITelemetryManager | undefined;
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
	const telemetryManager = createTelemetryManager(exerciseRegistry);
	activeTelemetryManager = telemetryManager;
	telemetryManager.setWebsocketService(artemisWebsocketService);

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

	const artemisWebviewProvider = new ArtemisWebviewProvider({
		extensionUri: context.extensionUri,
		extensionContext: context,
		authManager,
		artemisApi: artemisApiService,
		providerRegistry,
		websocketService: artemisWebsocketService,
		buildErrorCodeLensProvider,
		telemetryManager,
		updateAuthContext,
		courseAccessStorage,
		courseCatalog,
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ArtemisWebviewProvider.viewType, artemisWebviewProvider)
	);

	// Drop the `iris.contextStore` key: an unbounded, unscoped list of every
	// course and exercise this installation ever saw, orphaned in globalState.
	void context.globalState.update('iris.contextStore', undefined);

	const workspaceTracker = new WorkspaceExerciseTracker();
	context.subscriptions.push(workspaceTracker);

	const chatWebviewProvider = new ChatWebviewProvider(
		context.extensionUri, context, artemisApiService, artemisWebsocketService,
		noAiDetectionService, exerciseRegistry, courseCatalog, telemetryManager,
		workspaceTracker, courseAccessStorage, sessionIdentity,
	);
	chatWebviewProvider.onDidChangeExerciseContext(({ exerciseId, exerciseRoot }) => {
		telemetryManager.startExerciseSession(exerciseId, exerciseRoot);
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatWebviewProvider)
	);

	providerRegistry.setChatWebviewProvider(chatWebviewProvider);
	providerRegistry.setArtemisWebviewProvider(artemisWebviewProvider);

	sessionIdentity.attach({
		resetConversation: () => chatWebviewProvider.resetForSessionChange(),
		endTelemetrySession: () => telemetryManager.endExerciseSession(),
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
		session: sessionIdentity,
	});
	context.subscriptions.push(workspaceDetection);
	chatWebviewProvider.attachStartupDetection(workspaceDetection);

	context.subscriptions.push(telemetryManager);
	context.subscriptions.push(artemisWebsocketService);
	context.subscriptions.push(websocketStatusBarService);

	context.subscriptions.push(registerAllCommands({
		context, authManager, artemisApiService, artemisWebsocketService,
		telemetryManager, artemisWebviewProvider, chatWebviewProvider,
		updateAuthContext,
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
	try {
		const isAuthenticated = await authManager.hasAuthToken();
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);
		websocketStatusBarService.setAuthenticated(isAuthenticated);
		if (isAuthenticated) {
			void artemisWebsocketService.connect().catch(error => {
				logger.error('Failed to connect to Artemis WebSocket on startup', LogCategory.WEBSOCKET, error);
			});
		}
	} catch (error) {
		logger.error('Error checking initial auth state', LogCategory.AUTH, error);
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', false);
		websocketStatusBarService.setAuthenticated(false);
	}

	// Data collection (consent + recorder + recording commands). Noop for both shipped
	// variants (Desktop full + Open VSX) via the @dataCollection alias swap; real only
	// for the local-recording build.
	activeDataCollection = wireDataCollection({
		context,
		artemisWebsocketService,
		telemetryManager,
		artemisWebviewProvider,
		chatWebviewProvider,
		capabilities,
		exerciseRegistry,
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
			const serverKey = normalizeServerUrl(newServerUrl) ?? newServerUrl;
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
			try {
				if (!(await authManager.hasAuthToken())) {
					sessionIdentity.setAnonymous(serverKey);
					return;
				}
				logger.info('Artemis server URL changed; clearing credentials stored for the previous server', LogCategory.CONFIG);
				await authManager.clear();
				await updateAuthContext(false);
				artemisWebviewProvider.showLogin();
				vscode.window.showInformationMessage('Artemis server changed. Please log in again.');
			} catch (error) {
				logger.error('Failed to clear credentials after server URL change', LogCategory.AUTH, error);
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
	if (activeTelemetryManager) {
		try {
			// Explicit dispose so session-end + command/status-bar teardown
			// run before VS Code disposes context.subscriptions. dispose() is
			// idempotent, so the subscription teardown is a safe no-op.
			activeTelemetryManager.dispose();
		} catch (err) {
			logger.error('Failed to dispose TelemetryManager during deactivate', LogCategory.TELEMETRY, err);
		}
		activeTelemetryManager = undefined;
	}
}
