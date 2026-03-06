// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ArtemisWebviewProvider, ChatWebviewProvider, BuildErrorCodeLensProvider } from './provider';
import { AuthManager } from './auth';
import { ArtemisApiService } from './api';
import { ArtemisWebsocketService, TelemetryManager, WebSocketStatusBarService, NoAiDetectionService, ConsentService } from './services';
import { ProviderRegistry } from './services/ProviderRegistry';
import { VSCODE_CONFIG, processPlantUml, normalizeRelativePath } from './utils';
import { logger, LogLevel, LogCategory } from './services/loggingService';

// Module-level reference for deactivate() cleanup
let activeTelemetryManager: TelemetryManager | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Initialize the centralized logging service
	logger.initialize();

	// This line of code will only be executed once when your extension is activated
	logger.info('Congratulations, your extension "iris-thaumantias" is now active!', LogCategory.GENERAL);

	// Initialize the auth manager and API service
	const authManager = new AuthManager(context);
	const artemisApiService = new ArtemisApiService(authManager);
	const artemisWebsocketService = new ArtemisWebsocketService(authManager);
	const buildErrorCodeLensProvider = new BuildErrorCodeLensProvider();
	const telemetryManager = new TelemetryManager();
	activeTelemetryManager = telemetryManager;

	// Connect telemetry manager to websocket service for build results
	telemetryManager.setWebsocketService(artemisWebsocketService);

	// Initialize WebSocket debug status bar (only visible when developerMode is enabled)
	const websocketStatusBarService = new WebSocketStatusBarService(artemisWebsocketService);

	// Register CodeLens provider for all languages
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ scheme: 'file' }, // All file types
			buildErrorCodeLensProvider
		)
	);


	// Helper function to update authentication context
	const updateAuthContext = async (isAuthenticated: boolean) => {
		await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);

		// Connect/disconnect WebSocket based on authentication status
		if (isAuthenticated) {
			// Wait a bit to ensure auth cookie is stored before connecting
			setTimeout(async () => {
				try {
					await artemisWebsocketService.connect();
				} catch (error) {
					logger.error('Failed to connect to Artemis WebSocket', LogCategory.WEBSOCKET, error);
					// Don't block login if WebSocket fails
				}
			}, 500); // 500ms delay to ensure auth is complete
		} else {
			await artemisWebsocketService.disconnect();
		}
	};

	// Check initial authentication state on extension activation
	const initializeAuthContext = async () => {
		try {
			const isAuthenticated = await authManager.hasArtemisToken();

			// Only set the context, don't try to connect WebSocket yet
			// WebSocket will connect after user explicitly logs in
			await vscode.commands.executeCommand('setContext', 'iris:authenticated', isAuthenticated);

			// If already authenticated (from previous session), try to connect WebSocket
			// but only if we can actually get the cookie
			if (isAuthenticated) {
				const cookie = await authManager.getCookieHeader();
				if (cookie) {
					// Wait a bit before connecting to ensure everything is ready
					setTimeout(async () => {
						try {
							await artemisWebsocketService.connect();
						} catch (error) {
							logger.error('Failed to connect to Artemis WebSocket on startup', LogCategory.WEBSOCKET, error);
							// Don't block - user can still use the extension
						}
					}, 1000); // 1 second delay for startup connection
				}
			}
		} catch (error) {
			logger.error('Error checking initial auth state', LogCategory.AUTH, error);
			await vscode.commands.executeCommand('setContext', 'iris:authenticated', false);
		}
	};

	// Initialize authentication context
	await initializeAuthContext();

	// Initialize .noai file detection service
	const noAiDetectionService = NoAiDetectionService.getInstance();
	context.subscriptions.push(noAiDetectionService);

	// Initialize data collection consent service and prompt if pending
	const consentService = new ConsentService();
	context.subscriptions.push(consentService);
	consentService.promptIfPending();

	// Listen for .noai status changes
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

	// Register the Artemis login view provider with dependencies
	const artemisWebviewProvider = new ArtemisWebviewProvider(context.extensionUri, context, authManager, artemisApiService);

	// Pass the auth context updater to the webview provider
	artemisWebviewProvider.setAuthContextUpdater(updateAuthContext);

	// Pass the WebSocket service to enable real-time updates
	artemisWebviewProvider.setWebsocketService(artemisWebsocketService);

	// Pass the CodeLens provider
	artemisWebviewProvider.setBuildDiagnostics(buildErrorCodeLensProvider);

	// Pass the telemetry manager for struggle detection view
	artemisWebviewProvider.setTelemetryManager(telemetryManager);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ArtemisWebviewProvider.viewType, artemisWebviewProvider)
	);

	// Register the Chat view provider
	const chatWebviewProvider = new ChatWebviewProvider(context.extensionUri, context, artemisApiService, artemisWebsocketService);

	// Pass telemetry manager to chat provider for struggle context integration
	chatWebviewProvider.setTelemetryManager(telemetryManager);

	// Wire exercise context changes to telemetry manager for EQ session lifecycle
	chatWebviewProvider.onDidChangeExerciseContext(({ exerciseId, exerciseRoot }) => {
		telemetryManager.startExerciseSession(exerciseId, exerciseRoot);
	});

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatWebviewProvider)
	);

	// Register providers in the registry so they can be accessed by other parts of the extension
	const providerRegistry = ProviderRegistry.getInstance();
	providerRegistry.setArtemisWebviewProvider(artemisWebviewProvider);
	providerRegistry.setChatWebviewProvider(chatWebviewProvider);

	// Add telemetry manager to subscriptions for proper disposal
	context.subscriptions.push(telemetryManager);

	// Register command to show struggle score dialog (debug)
	const showStruggleScoreCommand = vscode.commands.registerCommand('artemis.showStruggleScore', async () => {
		await telemetryManager.showStruggleScoreDialog();
	});
	context.subscriptions.push(showStruggleScoreCommand);

	// Register command for CodeLens to navigate to error
	const goToSourceErrorCommand = vscode.commands.registerCommand(
		'artemis.goToSourceError',
		async (filePath: string, line: number, column?: number, message?: string) => {
			try {
				const normalizedPath = normalizeRelativePath(filePath);
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					vscode.window.showErrorMessage('No workspace folder open.');
					return;
				}

				if (!normalizedPath) {
					vscode.window.showErrorMessage('Cannot navigate to error: missing file path.');
					return;
				}

				const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, normalizedPath);
				const document = await vscode.workspace.openTextDocument(fileUri);
				const editor = await vscode.window.showTextDocument(document, {
					preview: false,
					viewColumn: vscode.ViewColumn.One
				});

				if (line > 0) {
					const position = new vscode.Position(line - 1, column ? column - 1 : 0);
					editor.selection = new vscode.Selection(position, position);
					editor.revealRange(
						new vscode.Range(position, position),
						vscode.TextEditorRevealType.InCenter
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to navigate to error: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		}
	);

	context.subscriptions.push(goToSourceErrorCommand);

	// Register clearTrustedDomains command
	const clearTrustedDomainsCommand = vscode.commands.registerCommand('artemis.clearTrustedDomains', async () => {
		const result = await vscode.window.showWarningMessage(
			'Clear all trusted domains? You will be prompted again before opening external links.',
			{ modal: true },
			'Clear'
		);
		if (result === 'Clear') {
			await context.globalState.update('artemis.trustedDomains', []);
			vscode.window.showInformationMessage('Trusted domains cleared.');
		}
	});
	context.subscriptions.push(clearTrustedDomainsCommand);

	// Register the Artemis login command
	const loginCommand = vscode.commands.registerCommand('artemis.login', () => {
		// This command can be used to programmatically open the Artemis view
		vscode.commands.executeCommand('artemis.loginView.focus');
	});

	// Register logout command to switch back to login view
	const logoutCommand = vscode.commands.registerCommand('artemis.logout', async () => {
		try {
			await authManager.clear();
			await updateAuthContext(false);
			vscode.window.showInformationMessage('Successfully logged out of Artemis');

			// Switch back to login state
			artemisWebviewProvider.showLogin();
		} catch (error) {
			logger.error('Logout error', LogCategory.AUTH, error);
			vscode.window.showErrorMessage('Error during logout');
		}
	});

	// Register Iris chat reset command (debug)
	const resetIrisChatCommand = vscode.commands.registerCommand('artemis.resetIrisChat', async () => {
		const confirmation = await vscode.window.showWarningMessage(
			'This will clear all local Iris chat session data and reload from Artemis. Continue?',
			{ modal: true },
			'Yes, Reset',
			'Cancel'
		);

		if (confirmation !== 'Yes, Reset') {
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Resetting Iris Chat Sessions...",
				cancellable: false
			}, async () => {
				// Clear all local session data
				chatWebviewProvider.clearAllSessions();
				vscode.window.showInformationMessage('✅ Iris chat sessions have been reset. Local session data cleared.');
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to reset Iris chat: ${message}`);
		}
	});

	// Register Iris health check command
	const checkIrisHealthCommand = vscode.commands.registerCommand('artemis.checkIrisHealth', async () => {
		try {
			// Check if user is authenticated first
			if (!await authManager.hasArtemisToken()) {
				vscode.window.showWarningMessage('Please log in to Artemis first before checking Iris health status.');
				return;
			}

			const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
			const activeContext = chatProvider?.getSelectedContext?.();
			const courseId = activeContext?.type === 'course' ? activeContext.id : activeContext?.courseId;

			if (!courseId) {
				vscode.window.showWarningMessage('Please select a course or exercise context before checking Iris health status.');
				return;
			}

			// Show progress indicator
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Checking Iris Health Status...",
				cancellable: false
			}, async (progress) => {
				try {
					const healthStatus = await artemisApiService.checkIrisHealth(courseId);

					if (healthStatus.active === true) {
						const rateLimitInfo = healthStatus.rateLimitInfo;

						let message = '✅ Iris is active and healthy!';
						if (rateLimitInfo) {
							const currentMessages = rateLimitInfo.currentMessageCount || 0;
							const rateLimit = rateLimitInfo.rateLimit || 0;
							const timeframeHours = rateLimitInfo.rateLimitTimeframeHours || 0;

							if (rateLimit > 0) {
								message += `\n📊 Rate Limit: ${currentMessages}/${rateLimit} messages`;
								if (timeframeHours > 0) {
									message += ` (${timeframeHours}h window)`;
								}
							}
						}

						vscode.window.showInformationMessage(message);
					} else {
						vscode.window.showWarningMessage('⚠️ Iris is currently inactive or unavailable.');
					}
				} catch (error) {
					logger.error('Iris health check failed', LogCategory.API, error);
					let errorMessage = '❌ Failed to check Iris health status.';

					if (error instanceof Error) {
						if (error.message.includes('Authentication failed')) {
							errorMessage += ' Please log in again.';
						} else if (error.message.includes('404')) {
							errorMessage += ' Iris might not be available on this server.';
						} else {
							errorMessage += ` Error: ${error.message}`;
						}
					}

					vscode.window.showErrorMessage(errorMessage);
				}
			});
		} catch (error) {
			logger.error('Error executing Iris health check command', LogCategory.API, error);
			vscode.window.showErrorMessage('Failed to execute Iris health check command.');
		}
	});

	// Register WebSocket status check command
	const checkWebSocketStatusCommand = vscode.commands.registerCommand('artemis.checkWebSocketStatus', async () => {
		try {
			const debugInfo = await artemisWebsocketService.getDebugInfoAsync();
			const isConnected = artemisWebsocketService.isConnected();
			const icon = isConnected ? '🟢' : '🔴';

			// Create detailed status message
			const statusLines = [
				`${icon} **WebSocket Status**`,
				``,
				`**Connection:**`,
				`• Connected: ${debugInfo.isConnected ? 'Yes ✅' : 'No ❌'}`,
				`• Client Active: ${debugInfo.clientActive ? 'Yes ✅' : 'No ❌'}`,
				`• Client Connected: ${debugInfo.clientConnected ? 'Yes ✅' : 'No ❌'}`,
				``,
				`**Subscriptions (${debugInfo.subscriptionCount}):**`,
				...debugInfo.subscriptions.map(sub => `• ${sub}`),
			];

			// Add helpful message if not connected due to authentication
			if (!isConnected && !debugInfo.hasCookie) {
				statusLines.push(``, `⚠️ **Not connected - Please log in to Artemis first**`);
			}

			statusLines.push(
				``,
				`**Configuration:**`,
				`• Server URL: ${debugInfo.serverUrl}`,
				`• WebSocket URL: ${debugInfo.websocketUrl}`,
				``,
				`**Authentication:**`,
				`• Has Cookie: ${debugInfo.hasCookie ? 'Yes ✅' : 'No ❌'}`,
				`• Has JWT Token: ${debugInfo.hasJwtToken ? 'Yes ✅' : 'No ❌'}`,
			);

			if (debugInfo.cookiePreview) {
				statusLines.push(`• Cookie Preview: ${debugInfo.cookiePreview}`);
			}

			statusLines.push(
				``,
				`**Reconnection:**`,
				`• Attempts: ${debugInfo.reconnectAttempts}/${debugInfo.maxReconnectAttempts}`,
				`• Current Delay: ${debugInfo.currentReconnectDelay}ms`,
				`• Gave Up: ${debugInfo.connectionGaveUp ? 'Yes ⛔' : 'No'}`,
				`• Session ID: ${debugInfo.sessionId}`,
				`• Callbacks: ${debugInfo.callbackCount}`,
			);

			const message = statusLines.join('\n');

			// Different actions based on connection state
			let actions: string[];
			if (!debugInfo.hasCookie) {
				// Not logged in
				actions = ['Login to Artemis', 'Show Details', 'Copy to Clipboard'];
			} else if (debugInfo.connectionGaveUp) {
				// Gave up on reconnecting
				actions = ['Reset & Retry', 'Show Details', 'Copy to Clipboard'];
			} else if (!isConnected) {
				// Logged in but not connected
				actions = ['Retry Connection', 'Show Details', 'Copy to Clipboard'];
			} else {
				// Connected
				actions = ['Show Details', 'Copy to Clipboard'];
			}

			// Show in a modal with action buttons
			const action = await vscode.window.showInformationMessage(
				`${icon} WebSocket: ${isConnected ? 'Connected' : 'Disconnected'}${debugInfo.connectionGaveUp ? ' (gave up)' : ''}${!debugInfo.hasCookie ? ' (Not logged in)' : ''}`,
				{ modal: false },
				...actions
			);

			if (action === 'Login to Artemis') {
				// Open the Artemis sidebar to login
				await vscode.commands.executeCommand('artemis.loginView.focus');
			} else if (action === 'Reset & Retry' || action === 'Retry Connection') {
				// Reset connection state and try to reconnect
				try {
					artemisWebsocketService.resetConnectionState();
					await artemisWebsocketService.connect();
					vscode.window.showInformationMessage('WebSocket connection attempt started...');
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			} else if (action === 'Show Details') {
				// Create a new text document with the debug info
				const doc = await vscode.workspace.openTextDocument({
					content: message,
					language: 'markdown'
				});
				await vscode.window.showTextDocument(doc, { preview: true });
			} else if (action === 'Copy to Clipboard') {
				await vscode.env.clipboard.writeText(message);
				vscode.window.showInformationMessage('WebSocket status copied to clipboard');
			}
		} catch (error) {
			logger.error('Error checking WebSocket status', LogCategory.WEBSOCKET, error);
			vscode.window.showErrorMessage(`Failed to check WebSocket status: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	});

	// Register manual WebSocket connect command
	const connectWebSocketCommand = vscode.commands.registerCommand('artemis.connectWebSocket', async () => {
		try {
			const isAuthenticated = await authManager.hasArtemisToken();

			if (!isAuthenticated) {
				const action = await vscode.window.showWarningMessage(
					'Please log in to Artemis before connecting to WebSocket',
					'Open Login'
				);
				if (action === 'Open Login') {
					await vscode.commands.executeCommand('artemis.loginView.focus');
				}
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Connecting to Artemis WebSocket...",
				cancellable: false
			}, async () => {
				try {
					await artemisWebsocketService.connect();
					vscode.window.showInformationMessage('✅ Successfully connected to Artemis WebSocket');
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : 'Unknown error';
					vscode.window.showErrorMessage(`❌ Failed to connect to WebSocket: ${errorMsg}`);

					// Offer to check status
					const action = await vscode.window.showErrorMessage(
						'WebSocket connection failed. Check the Developer Console for details.',
						'Check Status'
					);

					if (action === 'Check Status') {
						vscode.commands.executeCommand('artemis.checkWebSocketStatus');
					}
				}
			});
		} catch (error) {
			logger.error('Error in connect WebSocket command', LogCategory.WEBSOCKET, error);
			vscode.window.showErrorMessage('Failed to execute connect command');
		}
	});

	// Register PlantUML render command for webview (internal use)
	const renderPlantUmlFromWebviewCommand = vscode.commands.registerCommand(
		'artemis.renderPlantUmlFromWebview',
		async (plantUmlText: string, exerciseTitle?: string) => {
			try {
				logger.info('Rendering PlantUML from webview', LogCategory.PLANTUML);
				logger.debug('PlantUML content: ' + plantUmlText, LogCategory.PLANTUML);

				// Process the PlantUML text to replace testsColor(...) with "green"
				const processedPlantUml = processPlantUml(plantUmlText);
				logger.debug('Processed PlantUML: ' + processedPlantUml, LogCategory.PLANTUML);
				const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;

				// Render the PlantUML diagram
				const svgContent = await artemisApiService.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);

				// Create HTML content for the webview
				const htmlContent = `
					<!DOCTYPE html>
					<html lang="en">
					<head>
						<meta charset="UTF-8">
						<meta name="viewport" content="width=device-width, initial-scale=1.0">
						<title>PlantUML - ${exerciseTitle || 'Diagram'}</title>
						<style>
							body {
								margin: 0;
								padding: 20px;
								display: flex;
								justify-content: center;
								align-items: center;
								min-height: 100vh;
								background-color: var(--vscode-editor-background);
								overflow: auto;
							}
							.diagram-container {
								display: inline-block;
								max-width: 100%;
								max-height: 100%;
							}
							svg {
								display: block;
								max-width: 100%;
								max-height: 100%;
								width: auto !important;
								height: auto !important;
							}
						</style>
					</head>
					<body>
						<div class="diagram-container">
							${svgContent}
						</div>
					</body>
					</html>
				`;

				// Create a new webview panel
				const panel = vscode.window.createWebviewPanel(
					'plantUmlRenderer',
					`PlantUML - ${exerciseTitle || 'Diagram'}`,
					vscode.ViewColumn.One,
					{
						enableScripts: false,
						retainContextWhenHidden: true
					}
				);

				// Set the HTML content
				panel.webview.html = htmlContent;

				vscode.window.showInformationMessage('✅ PlantUML diagram rendered successfully!');
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				vscode.window.showErrorMessage(`❌ Failed to render PlantUML: ${errorMsg}`);
				logger.error('PlantUML rendering error', LogCategory.PLANTUML, error);
			}
		}
	);

	// Listen for configuration changes
	const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
			logger.info('Artemis server URL configuration changed', LogCategory.CONFIG);

			// Optionally show a message to the user about the server URL change
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
							// Refresh the login view if it's visible
							artemisWebviewProvider.showLogin();
						});
					}
				});
			}
		}

		});

	context.subscriptions.push(loginCommand);
	context.subscriptions.push(logoutCommand);
	context.subscriptions.push(resetIrisChatCommand);
	context.subscriptions.push(checkIrisHealthCommand);
	context.subscriptions.push(checkWebSocketStatusCommand);
	context.subscriptions.push(connectWebSocketCommand);
	context.subscriptions.push(renderPlantUmlFromWebviewCommand);
	context.subscriptions.push(configChangeListener);
	context.subscriptions.push(artemisWebsocketService);
	context.subscriptions.push(websocketStatusBarService);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Explicit session cleanup — context.subscriptions.dispose() is an additional guarantee,
	// but deactivate() ensures ordering and explicit state persistence.
	if (activeTelemetryManager) {
		activeTelemetryManager.endCurrentSession();
		activeTelemetryManager = undefined;
	}
}
