import * as vscode from 'vscode';
import { ArtemisWebviewProvider, ChatWebviewProvider, BuildErrorCodeLensProvider } from './extension/provider';
import { AuthManager } from './extension/services/auth';
import { ArtemisApiService } from './extension/api';
import { ArtemisWebsocketService, WebSocketStatusBarService } from './extension/services/websocket';
import { TelemetryManager } from './extension/services/telemetry';
import type { SessionRecorder } from './extension/services/telemetry';
import { NoAiDetectionService } from './extension/services/workspace';
import { ConsentService } from './extension/services/auth';
import { ExerciseRegistry } from './extension/services/exerciseRegistry';
import { createProviderRegistry } from './extension/services/ui';
import { logger, LogCategory } from './extension/services/loggingService';
import { VSCODE_CONFIG } from './extension/utils';
import { registerAllCommands } from './extension/activation/extensionCommands';
import { wireSessionRecorder } from './extension/activation/sessionRecorderWiring';
import { detectTheiaEnvironment, detectPlatformCapabilities, authenticateFromEnvironment, autoCloneIfNeeded } from './extension/theia';

// Module-level references for deactivate() cleanup
let activeTelemetryManager: TelemetryManager | undefined;
let activeSessionRecorder: SessionRecorder | undefined;

export async function activate(context: vscode.ExtensionContext) {
	logger.initialize();
	logger.info('Congratulations, your extension "iris-thaumantias" is now active!', LogCategory.GENERAL);

	// ── Theia/EduIDE detection (must complete before any service instantiation) ──
	const theiaEnv = await detectTheiaEnvironment();
	const capabilities = detectPlatformCapabilities();
	logger.info(`Platform: ${theiaEnv.isTheia ? 'Theia/EduIDE' : 'VS Code Desktop'}`, LogCategory.GENERAL);

	// ── Service instantiation ────────────────────────────────────────
	const authManager = new AuthManager(context);

	// In Theia: authenticate from environment variables before creating API services
	if (theiaEnv.isTheia) {
		const { authenticated } = await authenticateFromEnvironment(authManager, theiaEnv);
		logger.info(`Theia auto-auth: ${authenticated ? 'success' : 'no credentials in environment'}`, LogCategory.AUTH);
	}

	const artemisApiService = new ArtemisApiService(authManager, theiaEnv);
	const artemisWebsocketService = new ArtemisWebsocketService(authManager, theiaEnv);
	const buildErrorCodeLensProvider = new BuildErrorCodeLensProvider();
	const telemetryManager = new TelemetryManager();
	activeTelemetryManager = telemetryManager;

	telemetryManager.setWebsocketService(artemisWebsocketService);

	const websocketStatusBarService = new WebSocketStatusBarService(artemisWebsocketService);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, buildErrorCodeLensProvider)
	);

	// ── Auth context ─────────────────────────────────────────────────
	const updateAuthContext = async (isAuthenticated: boolean) => {
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);
		if (isAuthenticated) {
			artemisApiService.resetAuthExpiredGuard();
			void artemisWebsocketService.connect().catch(error => {
				logger.error('Failed to connect to Artemis WebSocket', LogCategory.WEBSOCKET, error);
			});
		} else {
			await artemisWebsocketService.disconnect();
		}
	};

	// Check initial auth state and connect WebSocket if already authenticated
	try {
		const isAuthenticated = await authManager.hasArtemisToken();
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);
		if (isAuthenticated) {
			const cookie = await authManager.getCookieHeader();
			if (cookie) {
				void artemisWebsocketService.connect().catch(error => {
					logger.error('Failed to connect to Artemis WebSocket on startup', LogCategory.WEBSOCKET, error);
				});
			}
		}
	} catch (error) {
		logger.error('Error checking initial auth state', LogCategory.AUTH, error);
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', false);
	}

	// ── Workspace services ───────────────────────────────────────────
	const noAiDetectionService = new NoAiDetectionService();
	context.subscriptions.push(noAiDetectionService);

	const consentService = new ConsentService();
	context.subscriptions.push(consentService);
	consentService.promptIfPending();

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

	// ── Registries & providers ───────────────────────────────────────
	const exerciseRegistry = new ExerciseRegistry();
	const providerRegistry = createProviderRegistry();

	const artemisWebviewProvider = new ArtemisWebviewProvider(
		context.extensionUri, context, authManager, artemisApiService,
		exerciseRegistry, providerRegistry,
		artemisWebsocketService, buildErrorCodeLensProvider, telemetryManager, updateAuthContext,
		theiaEnv,
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ArtemisWebviewProvider.viewType, artemisWebviewProvider)
	);

	const chatWebviewProvider = new ChatWebviewProvider(context.extensionUri, context, artemisApiService, artemisWebsocketService, noAiDetectionService, exerciseRegistry, telemetryManager);
	chatWebviewProvider.onDidChangeExerciseContext(({ exerciseId, exerciseRoot }) => {
		telemetryManager.startExerciseSession(exerciseId, exerciseRoot);
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatWebviewProvider)
	);

	providerRegistry.setChatWebviewProvider(chatWebviewProvider);
	context.subscriptions.push(telemetryManager);

	// Wire 401 handler: environment-aware auth teardown
	if (theiaEnv.isTheia) {
		// Theia: attempt to re-read token from environment (orchestrator may have refreshed it)
		artemisApiService.onAuthExpired = async () => {
			const freshEnv = await detectTheiaEnvironment();
			if (freshEnv.artemisToken && freshEnv.artemisToken !== theiaEnv.artemisToken) {
				logger.info('Theia token refreshed from environment, re-authenticating', LogCategory.AUTH);
				await authManager.storeArtemisCredentials(freshEnv.artemisToken, freshEnv.artemisUrl!, false);
				artemisApiService.resetAuthExpiredGuard();
				void artemisWebsocketService.connect().catch(error => {
					logger.error('WebSocket reconnect after token refresh failed', LogCategory.WEBSOCKET, error);
				});
			} else {
				void updateAuthContext(false);
				vscode.window.showErrorMessage(
					'Your session has expired. Please restart your workspace to re-authenticate.'
				);
			}
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

	// ── Session recorder wiring ──────────────────────────────────────
	const { sessionRecorder, disposable: recorderDisposable } = wireSessionRecorder({
		context, consentService, artemisWebsocketService,
		telemetryManager, artemisWebviewProvider, chatWebviewProvider,
		capabilities,
	});
	activeSessionRecorder = sessionRecorder;
	context.subscriptions.push(recorderDisposable);

	// ── VS Code commands ─────────────────────────────────────────────
	context.subscriptions.push(registerAllCommands({
		context, authManager, artemisApiService, artemisWebsocketService,
		telemetryManager, providerRegistry, artemisWebviewProvider, chatWebviewProvider,
		updateAuthContext,
	}));

	// ── Configuration listener ───────────────────────────────────────
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

	context.subscriptions.push(artemisWebsocketService);
	context.subscriptions.push(websocketStatusBarService);

	// ── Theia auto-clone ─────────────────────────────────────────────
	if (theiaEnv.isTheia && theiaEnv.gitUri) {
		void autoCloneIfNeeded(theiaEnv).catch(error => {
			logger.error('Theia auto-clone failed', LogCategory.GENERAL, error);
		});
	}
}

export function deactivate() {
	if (activeSessionRecorder) {
		void activeSessionRecorder.endSession();
		activeSessionRecorder = undefined;
	}
	if (activeTelemetryManager) {
		activeTelemetryManager.endCurrentSession();
		activeTelemetryManager = undefined;
	}
}
