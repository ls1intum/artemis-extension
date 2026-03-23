import * as vscode from 'vscode';
import { ArtemisWebviewProvider, ChatWebviewProvider, BuildErrorCodeLensProvider } from './provider';
import { AuthManager } from './services/auth';
import { ArtemisApiService } from './api';
import { ArtemisWebsocketService, TelemetryManager, WebSocketStatusBarService, NoAiDetectionService, ConsentService, ExerciseRegistry, ProviderRegistry, logger, LogCategory } from './services';
import { VSCODE_CONFIG } from './utils';
import { registerAllCommands } from './activation/extensionCommands';
import { wireSessionRecorder } from './activation/sessionRecorderWiring';
import type { SessionRecorder } from './services';

// Module-level references for deactivate() cleanup
let activeTelemetryManager: TelemetryManager | undefined;
let activeSessionRecorder: SessionRecorder | undefined;

export async function activate(context: vscode.ExtensionContext) {
	logger.initialize();
	logger.info('Congratulations, your extension "iris-thaumantias" is now active!', LogCategory.GENERAL);

	// ── Service instantiation ────────────────────────────────────────
	const authManager = new AuthManager(context);
	const artemisApiService = new ArtemisApiService(authManager);
	const artemisWebsocketService = new ArtemisWebsocketService(authManager);
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
	const providerRegistry = new ProviderRegistry();

	const artemisWebviewProvider = new ArtemisWebviewProvider(
		context.extensionUri, context, authManager, artemisApiService,
		exerciseRegistry, providerRegistry,
		artemisWebsocketService, buildErrorCodeLensProvider, telemetryManager, updateAuthContext,
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

	// Wire 401 handler: full auth teardown + sidebar reset + user notification
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

	// ── Session recorder wiring ──────────────────────────────────────
	const { sessionRecorder, disposable: recorderDisposable } = wireSessionRecorder({
		context, consentService, artemisWebsocketService,
		telemetryManager, artemisWebviewProvider, chatWebviewProvider,
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

	context.subscriptions.push(artemisWebsocketService);
	context.subscriptions.push(websocketStatusBarService);
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
