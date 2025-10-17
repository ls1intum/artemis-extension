// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ArtemisWebviewProvider, ChatWebviewProvider } from './views';
import { AuthManager } from './auth';
import { ArtemisApiService } from './api';
import { ArtemisWebsocketService } from './services';
import { VSCODE_CONFIG, processPlantUml } from './utils';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "iris-thaumantias" is now active!');

	// Initialize the auth manager and API service
	const authManager = new AuthManager(context);
	const artemisApiService = new ArtemisApiService(authManager);
	const artemisWebsocketService = new ArtemisWebsocketService(authManager);


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
					console.error('Failed to connect to Artemis WebSocket:', error);
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
							console.error('Failed to connect to Artemis WebSocket on startup:', error);
							// Don't block - user can still use the extension
						}
					}, 1000); // 1 second delay for startup connection
				}
			}
		} catch (error) {
			console.error('Error checking initial auth state:', error);
			await vscode.commands.executeCommand('setContext', 'iris:authenticated', false);
		}
	};

	// Initialize authentication context
	await initializeAuthContext();

	// Register the Artemis login view provider with dependencies
	const artemisWebviewProvider = new ArtemisWebviewProvider(context.extensionUri, context, authManager, artemisApiService);
	
	// Pass the auth context updater to the webview provider
	artemisWebviewProvider.setAuthContextUpdater(updateAuthContext);
	
	// Pass the WebSocket service to enable real-time updates
	artemisWebviewProvider.setWebsocketService(artemisWebsocketService);
	
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ArtemisWebviewProvider.viewType, artemisWebviewProvider)
	);

	// Register the Chat view provider
	const chatWebviewProvider = new ChatWebviewProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatWebviewProvider)
	);

	// Store providers in global state so they can be accessed by other parts of the extension
	(global as any).artemisWebviewProvider = artemisWebviewProvider;
	(global as any).chatWebviewProvider = chatWebviewProvider;

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
			console.error('Logout error:', error);
			vscode.window.showErrorMessage('Error during logout');
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

			// Show progress indicator
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Checking Iris Health Status...",
				cancellable: false
			}, async (progress) => {
				try {
					const healthStatus = await artemisApiService.checkIrisHealth();
					
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
					console.error('Iris health check failed:', error);
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
			console.error('Error executing Iris health check command:', error);
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
			);
			
			const message = statusLines.join('\n');
			
			// Different actions based on connection state
			let actions: string[];
			if (!debugInfo.hasCookie) {
				// Not logged in
				actions = ['Login to Artemis', 'Show Details', 'Copy to Clipboard'];
			} else if (!isConnected) {
				// Logged in but not connected
				actions = ['Retry Connection', 'Show Details', 'Copy to Clipboard'];
			} else {
				// Connected
				actions = ['Show Details', 'Copy to Clipboard'];
			}
			
			// Show in a modal with action buttons
			const action = await vscode.window.showInformationMessage(
				`${icon} WebSocket: ${isConnected ? 'Connected' : 'Disconnected'}${!debugInfo.hasCookie ? ' (Not logged in)' : ''}`,
				{ modal: false },
				...actions
			);
			
			if (action === 'Login to Artemis') {
				// Open the Artemis sidebar to login
				await vscode.commands.executeCommand('artemis.loginView.focus');
			} else if (action === 'Retry Connection') {
				// Try to reconnect
				try {
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
			console.error('Error checking WebSocket status:', error);
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
			console.error('Error in connect WebSocket command:', error);
			vscode.window.showErrorMessage('Failed to execute connect command');
		}
	});

	// Register PlantUML render command for webview (internal use)
	const renderPlantUmlFromWebviewCommand = vscode.commands.registerCommand(
		'artemis.renderPlantUmlFromWebview',
		async (plantUmlText: string, exerciseTitle?: string) => {
			try {
				console.log('🎨 Rendering PlantUML from webview');
				console.log('📊 PlantUML content:', plantUmlText);

				// Process the PlantUML text to replace testsColor(...) with "green"
				const processedPlantUml = processPlantUml(plantUmlText);
				console.log('✅ Processed PlantUML:', processedPlantUml);

				// Determine if we should use dark theme
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
				console.error('PlantUML rendering error:', error);
			}
		}
	);

	// Listen for configuration changes
	const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
			console.log('Artemis server URL configuration changed');
			
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
		
		if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.THEME_KEY}`)) {
			console.log('Artemis theme configuration changed');
			
			// Refresh both webviews to apply the new theme
			artemisWebviewProvider.refreshTheme();
			chatWebviewProvider.refreshTheme();
		}
		
		if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SHOW_IRIS_EXPLANATION_KEY}`)) {
			console.log('Artemis showIrisExplanation configuration changed');
			
			// Refresh the main webview to show/hide the Iris explanation
			artemisWebviewProvider.refreshTheme();
		}
	});

	context.subscriptions.push(loginCommand);
	context.subscriptions.push(logoutCommand);
	context.subscriptions.push(checkIrisHealthCommand);
	context.subscriptions.push(checkWebSocketStatusCommand);
	context.subscriptions.push(connectWebSocketCommand);
	context.subscriptions.push(renderPlantUmlFromWebviewCommand);
	context.subscriptions.push(configChangeListener);
	context.subscriptions.push(artemisWebsocketService);
}

// This method is called when your extension is deactivated
export function deactivate() {}
