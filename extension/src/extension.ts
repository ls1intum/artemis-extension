import * as vscode from 'vscode';

import { registerAllCommands } from '@extension/activation/extensionCommands';
import { wireSessionRecorder } from '@extension/activation/sessionRecorderWiring';
import { ArtemisApiService } from '@extension/api';
import { ArtemisWebviewProvider, BuildErrorCodeLensProvider, ChatWebviewProvider } from '@extension/provider';
import { AuthManager } from '@extension/services/auth';
import { ConsentService } from '@extension/services/auth';
import { CourseDataCache } from '@extension/services/courseDataCache';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { SessionRecorder } from '@extension/services/telemetry';
import { TelemetryManager } from '@extension/services/telemetry';
import { createProviderRegistry } from '@extension/services/ui';
import { ArtemisWebsocketService, WebSocketStatusBarService } from '@extension/services/websocket';
import { NoAiDetectionService } from '@extension/services/workspace';
import {
    buildChatProviderSink,
    wireWorkspaceDetection,
} from '@extension/services/workspace/wireWorkspaceDetection';
import {
    authenticateFromEnvironment,
    autoCloneIfNeeded,
    detectPlatformCapabilities,
    initializeTheiaContext,
} from '@extension/theia';
import { VSCODE_CONFIG } from '@extension/utils';

// Module-level references for deactivate() cleanup
let activeTelemetryManager: TelemetryManager | undefined;
let activeSessionRecorder: SessionRecorder | undefined;

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
	const telemetryManager = new TelemetryManager(exerciseRegistry);
	activeTelemetryManager = telemetryManager;
	telemetryManager.setWebsocketService(artemisWebsocketService);

	const websocketStatusBarService = new WebSocketStatusBarService(artemisWebsocketService);

	context.subscriptions.push(
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

	const consentService = new ConsentService();
	context.subscriptions.push(consentService);

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
		telemetryManager,
		updateAuthContext,
		courseDataCache,
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ArtemisWebviewProvider.viewType, artemisWebviewProvider)
	);

	const contextStore = new ContextStore(context);
	context.subscriptions.push(contextStore);

	const chatWebviewProvider = new ChatWebviewProvider(
		context.extensionUri, context, artemisApiService, artemisWebsocketService,
		noAiDetectionService, exerciseRegistry, courseDataCache, telemetryManager,
		contextStore,
	);
	chatWebviewProvider.onDidChangeExerciseContext(({ exerciseId, exerciseRoot }) => {
		telemetryManager.startExerciseSession(exerciseId, exerciseRoot);
	});
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
	}));

	context.subscriptions.push(telemetryManager);
	context.subscriptions.push(artemisWebsocketService);
	context.subscriptions.push(websocketStatusBarService);

	context.subscriptions.push(registerAllCommands({
		context, authManager, artemisApiService, artemisWebsocketService,
		telemetryManager, providerRegistry, artemisWebviewProvider, chatWebviewProvider,
		updateAuthContext,
	}));

	// Kept as a defensive safety net for any future when-clause gating.
	// The login view itself no longer depends on this context key.
	void vscode.commands.executeCommand('setContext', 'iris:extensionReady', true);

	// ── Phase B: async initialization (UI already responsive) ────────
	consentService.promptIfPending();

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
		}
	} catch (error) {
		logger.error('Error checking initial auth state', LogCategory.AUTH, error);
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', false);
		websocketStatusBarService.setAuthenticated(false);
	}

	// Session recorder wiring
	const { sessionRecorder, disposable: recorderDisposable } = wireSessionRecorder({
		context, consentService, artemisWebsocketService,
		telemetryManager, artemisWebviewProvider, chatWebviewProvider,
		capabilities, exerciseRegistry, contextStore,
	});
	activeSessionRecorder = sessionRecorder;
	context.subscriptions.push(recorderDisposable);

	// Configuration listener
	if (theiaEnv.isManagedEnvironment) {
		// In managed Theia environments, revert unauthorized changes to locked settings
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`) && theiaEnv.artemisUrl) {
				const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
				void config.update(VSCODE_CONFIG.SERVER_URL_KEY, theiaEnv.artemisUrl, vscode.ConfigurationTarget.Global);
				vscode.window.showWarningMessage('Server URL cannot be changed in this managed environment.');
			}
		}));
	} else {
		// In VS Code: prompt user to clear credentials when server URL changes
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
				logger.info('Artemis server URL configuration changed', LogCategory.CONFIG);
				const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
				const newServerUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY);
				if (newServerUrl) {
					vscode.window.showInformationMessage(
						`Artemis server URL updated to: ${newServerUrl}. You may need to log in again if you were authenticated to a different server.`,
						'Clear Credentials'
					).then(selection => {
						if (selection === 'Clear Credentials') {
							authManager.clear().then(async () => {
								await updateAuthContext(false);
								vscode.window.showInformationMessage('Stored credentials cleared. Please log in again.');
								artemisWebviewProvider.showLogin();
							});
						}
					});
				}
			}
		}));
	}

	// Theia auto-clone
	if (theiaEnv.isTheia && theiaEnv.gitUri) {
		void autoCloneIfNeeded(theiaEnv).catch(error => {
			logger.error('Theia auto-clone failed', LogCategory.GENERAL, error);
		});
	}
}

export async function deactivate(): Promise<void> {
	// Await the recorder dispose so all buffered events reach disk before
	// the extension host tears us down. VS Code accepts a Promise return
	// from deactivate and waits for it during graceful shutdown.
	if (activeSessionRecorder) {
		try {
			await activeSessionRecorder.dispose();
		} catch (err) {
			logger.error('Failed to dispose SessionRecorder during deactivate', LogCategory.TELEMETRY, err);
		}
		activeSessionRecorder = undefined;
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
