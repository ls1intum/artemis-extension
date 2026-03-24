import * as vscode from 'vscode';
import type { AuthManager } from '../services/auth';
import type { ArtemisApiService } from '../api';
import type { ArtemisWebsocketService } from '../services/websocket';
import type { IProviderRegistry } from '../services/ui';
import type { TelemetryManager } from '../services/telemetry';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '../provider';
import { logger, LogCategory } from '../services/loggingService';
import { processPlantUml, normalizeRelativePath } from '../utils';
import { executeReplayCommand } from '../services/telemetry/replay';

// ── Individual command registrations ─────────────────────────────────

function registerLoginCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.login', () => {
        vscode.commands.executeCommand('artemis.loginView.focus');
    });
}

function registerLogoutCommand(
    authManager: AuthManager,
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>,
    artemisWebviewProvider: ArtemisWebviewProvider,
): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.logout', async () => {
        try {
            await authManager.clear();
            await updateAuthContext(false);
            vscode.window.showInformationMessage('Successfully logged out of Artemis');
            artemisWebviewProvider.showLogin();
        } catch (error) {
            logger.error('Logout error', LogCategory.AUTH, error);
            vscode.window.showErrorMessage('Error during logout');
        }
    });
}

function registerResetIrisChatCommand(chatWebviewProvider: ChatWebviewProvider): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.resetIrisChat', async () => {
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
                chatWebviewProvider.clearAllSessions();
                vscode.window.showInformationMessage('✅ Iris chat sessions have been reset. Local session data cleared.');
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to reset Iris chat: ${message}`);
        }
    });
}

function registerIrisHealthCheckCommand(
    authManager: AuthManager,
    artemisApiService: ArtemisApiService,
    providerRegistry: IProviderRegistry,
): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.checkIrisHealth', async () => {
        try {
            if (!await authManager.hasArtemisToken()) {
                vscode.window.showWarningMessage('Please log in to Artemis first before checking Iris health status.');
                return;
            }

            const chatProvider = providerRegistry.getChatWebviewProvider();
            const activeContext = chatProvider?.getSelectedContext?.();
            const courseId = activeContext?.type === 'course' ? activeContext.id : activeContext?.courseId;

            if (!courseId) {
                vscode.window.showWarningMessage('Please select a course or exercise context before checking Iris health status.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Checking Iris Health Status...",
                cancellable: false
            }, async () => {
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
}

function registerWebSocketStatusCommand(artemisWebsocketService: ArtemisWebsocketService): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.checkWebSocketStatus', async () => {
        try {
            const debugInfo = await artemisWebsocketService.getDebugInfoAsync();
            const isConnected = artemisWebsocketService.isConnected();
            const icon = isConnected ? '🟢' : '🔴';

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

            let actions: string[];
            if (!debugInfo.hasCookie) {
                actions = ['Login to Artemis', 'Show Details', 'Copy to Clipboard'];
            } else if (debugInfo.connectionGaveUp) {
                actions = ['Reset & Retry', 'Show Details', 'Copy to Clipboard'];
            } else if (!isConnected) {
                actions = ['Retry Connection', 'Show Details', 'Copy to Clipboard'];
            } else {
                actions = ['Show Details', 'Copy to Clipboard'];
            }

            const action = await vscode.window.showInformationMessage(
                `${icon} WebSocket: ${isConnected ? 'Connected' : 'Disconnected'}${debugInfo.connectionGaveUp ? ' (gave up)' : ''}${!debugInfo.hasCookie ? ' (Not logged in)' : ''}`,
                { modal: false },
                ...actions
            );

            if (action === 'Login to Artemis') {
                await vscode.commands.executeCommand('artemis.loginView.focus');
            } else if (action === 'Reset & Retry' || action === 'Retry Connection') {
                try {
                    artemisWebsocketService.resetConnectionState();
                    await artemisWebsocketService.connect();
                    vscode.window.showInformationMessage('WebSocket connection attempt started...');
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            } else if (action === 'Show Details') {
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
}

function registerConnectWebSocketCommand(
    authManager: AuthManager,
    artemisWebsocketService: ArtemisWebsocketService,
): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.connectWebSocket', async () => {
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
}

function registerPlantUmlRenderCommand(artemisApiService: ArtemisApiService): vscode.Disposable {
    return vscode.commands.registerCommand(
        'artemis.renderPlantUmlFromWebview',
        async (plantUmlText: string, exerciseTitle?: string) => {
            try {
                logger.info('Rendering PlantUML from webview', LogCategory.PLANTUML);
                logger.debug('PlantUML content: ' + plantUmlText, LogCategory.PLANTUML);

                const processedPlantUml = processPlantUml(plantUmlText);
                logger.debug('Processed PlantUML: ' + processedPlantUml, LogCategory.PLANTUML);
                const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;

                const svgContent = await artemisApiService.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);

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

                const panel = vscode.window.createWebviewPanel(
                    'plantUmlRenderer',
                    `PlantUML - ${exerciseTitle || 'Diagram'}`,
                    vscode.ViewColumn.One,
                    {
                        enableScripts: false,
                        retainContextWhenHidden: true
                    }
                );

                panel.webview.html = htmlContent;

                vscode.window.showInformationMessage('✅ PlantUML diagram rendered successfully!');
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`❌ Failed to render PlantUML: ${errorMsg}`);
                logger.error('PlantUML rendering error', LogCategory.PLANTUML, error);
            }
        }
    );
}

function registerGoToSourceErrorCommand(): vscode.Disposable {
    return vscode.commands.registerCommand(
        'artemis.goToSourceError',
        async (filePath: string, line: number, column?: number, _message?: string) => {
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
}

function registerClearTrustedDomainsCommand(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.clearTrustedDomains', async () => {
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
}

function registerStruggleScoreCommand(telemetryManager: TelemetryManager): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.showStruggleScore', async () => {
        await telemetryManager.showStruggleScoreDialog();
    });
}

function registerReplaySessionCommand(globalStorageUri: vscode.Uri): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.replaySession', async () => {
        await executeReplayCommand(globalStorageUri);
    });
}

// ── Aggregate registration ───────────────────────────────────────────

export interface CommandDeps {
    context: vscode.ExtensionContext;
    authManager: AuthManager;
    artemisApiService: ArtemisApiService;
    artemisWebsocketService: ArtemisWebsocketService;
    telemetryManager: TelemetryManager;
    providerRegistry: IProviderRegistry;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>;
}

export function registerAllCommands(deps: CommandDeps): vscode.Disposable {
    return vscode.Disposable.from(
        registerLoginCommand(),
        registerLogoutCommand(deps.authManager, deps.updateAuthContext, deps.artemisWebviewProvider),
        registerResetIrisChatCommand(deps.chatWebviewProvider),
        registerIrisHealthCheckCommand(deps.authManager, deps.artemisApiService, deps.providerRegistry),
        registerWebSocketStatusCommand(deps.artemisWebsocketService),
        registerConnectWebSocketCommand(deps.authManager, deps.artemisWebsocketService),
        registerPlantUmlRenderCommand(deps.artemisApiService),
        registerGoToSourceErrorCommand(),
        registerClearTrustedDomainsCommand(deps.context),
        registerStruggleScoreCommand(deps.telemetryManager),
        registerReplaySessionCommand(deps.context.globalStorageUri),
    );
}
