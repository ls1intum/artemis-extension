import * as vscode from 'vscode';
import type { AuthManager } from '../services/auth';
import type { ArtemisApiService } from '../api';
import type { ArtemisWebsocketService } from '../services/websocket';
import type { IProviderRegistry } from '../services/ui';
import type { TelemetryManager } from '../services/telemetry';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '../provider';
import { logger, LogCategory } from '../services/loggingService';
import { processPlantUml, normalizeRelativePath, extractErrorMessage, VSCODE_CONFIG } from '../utils';
import { executeReplayCommand } from '../services/telemetry/replay';

// ── Individual command registrations ─────────────────────────────────

function registerLoginCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.login', () => {
        vscode.commands.executeCommand('artemis.loginView.focus');
    });
}

function registerLogoutCommand(
    authManager: AuthManager,
    artemisApiService: ArtemisApiService,
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>,
    artemisWebviewProvider: ArtemisWebviewProvider,
): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.logout', async () => {
        try {
            // Best-effort server-side logout before clearing local state.
            // Never throws — local cleanup proceeds regardless.
            await artemisApiService.logoutFromServer();
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
            vscode.window.showErrorMessage(`Failed to reset Iris chat: ${extractErrorMessage(error)}`);
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
            if (!await authManager.hasAuthToken()) {
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
                    vscode.window.showErrorMessage(`Failed to connect: ${extractErrorMessage(error)}`);
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
            vscode.window.showErrorMessage(`Failed to check WebSocket status: ${extractErrorMessage(error)}`);
        }
    });
}

function registerConnectWebSocketCommand(
    authManager: AuthManager,
    artemisWebsocketService: ArtemisWebsocketService,
): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.connectWebSocket', async () => {
        try {
            const isAuthenticated = await authManager.hasAuthToken();

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
                    vscode.window.showErrorMessage(`❌ Failed to connect to WebSocket: ${extractErrorMessage(error)}`);

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
                vscode.window.showErrorMessage(`❌ Failed to render PlantUML: ${extractErrorMessage(error)}`);
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
                vscode.window.showErrorMessage(`Failed to navigate to error: ${extractErrorMessage(error)}`);
            }
        }
    );
}

const KNOWN_SERVERS: ReadonlyArray<{ label: string; url: string }> = [
    { label: 'Production (artemis.tum.de)',                         url: 'https://artemis.tum.de' },
    { label: 'Test Server 1 (artemis-test1.artemis.cit.tum.de)',    url: 'https://artemis-test1.artemis.cit.tum.de' },
    { label: 'Test Server 2 (artemis-test2.artemis.cit.tum.de)',    url: 'https://artemis-test2.artemis.cit.tum.de' },
    { label: 'Test Server 3 (artemis-test3.artemis.cit.tum.de)',    url: 'https://artemis-test3.artemis.cit.tum.de' },
    { label: 'Test Server 4 (artemis-test4.artemis.cit.tum.de)',    url: 'https://artemis-test4.artemis.cit.tum.de' },
    { label: 'Test Server 5 (artemis-test5.artemis.cit.tum.de)',    url: 'https://artemis-test5.artemis.cit.tum.de' },
    { label: 'Test Server 6 (artemis-test6.artemis.cit.tum.de)',    url: 'https://artemis-test6.artemis.cit.tum.de' },
    { label: 'Test Server 9 (artemis-test9.artemis.cit.tum.de)',    url: 'https://artemis-test9.artemis.cit.tum.de' },
    { label: 'Local Development (localhost:9000)',                   url: 'http://localhost:9000' },
];

function registerSetServerUrlCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.setServerUrl', async () => {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const currentUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, '');
        const hasCustomCurrent = currentUrl.length > 0 && !KNOWN_SERVERS.some(s => s.url === currentUrl);

        const items: vscode.QuickPickItem[] = [];

        if (hasCustomCurrent) {
            let hostname = currentUrl;
            try {
                hostname = new URL(currentUrl).host || currentUrl;
            } catch {
                // Fall back to the raw value if it fails to parse.
            }
            items.push(
                {
                    label: `Custom (${hostname})`,
                    description: currentUrl,
                    detail: '$(check) Currently selected',
                },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
            );
        }

        items.push(...KNOWN_SERVERS.map(server => ({
            label: server.label,
            description: server.url,
            detail: server.url === currentUrl ? '$(check) Currently selected' : undefined,
        })));

        items.push(
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            { label: '$(edit) Enter custom URL...', description: 'Use your own Artemis server URL' },
        );

        const selection = await vscode.window.showQuickPick(items, {
            title: 'Select Artemis Server',
            placeHolder: `Current: ${currentUrl || 'not set'}`,
        });

        if (!selection) {
            return;
        }

        let newUrl: string | undefined;

        if (selection.label === '$(edit) Enter custom URL...') {
            newUrl = await vscode.window.showInputBox({
                title: 'Enter Custom Artemis Server URL',
                prompt: 'Full URL including protocol (e.g. https://artemis.example.com)',
                value: currentUrl,
                validateInput: (value) => {
                    try {
                        const url = new URL(value);
                        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                            return 'URL must start with http:// or https://';
                        }
                        return undefined;
                    } catch {
                        return 'Please enter a valid URL';
                    }
                },
            });
        } else {
            newUrl = KNOWN_SERVERS.find(s => s.label === selection.label)?.url;
        }

        if (newUrl) {
            newUrl = newUrl.replace(/\/+$/, '');
        }

        if (newUrl && newUrl !== currentUrl) {
            await config.update(VSCODE_CONFIG.SERVER_URL_KEY, newUrl, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Artemis server set to: ${newUrl}`);
        }
    });
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

function registerOpenRecordingsFolderCommand(globalStorageUri: vscode.Uri): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.openRecordingsFolder', async () => {
        const recordingsUri = vscode.Uri.joinPath(globalStorageUri, 'recordings');
        await vscode.commands.executeCommand('revealFileInOS', recordingsUri);
    });
}

/**
 * Developer-only command: copy the current raw JWT to the clipboard for use
 * in curl/Postman based server testing. Gated on the `artemis.developerMode`
 * setting both at the menu level (commandPalette `when` clause) and at runtime
 * (defense-in-depth against direct invocation via `vscode.commands.executeCommand`).
 *
 * The full token is NEVER shown in the UI or written to logs — only a masked
 * preview appears in the notification, and the full value lands in the clipboard.
 */
function registerShowJwtTokenCommand(authManager: AuthManager): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.showJwtToken', async () => {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const developerMode = config.get<boolean>(VSCODE_CONFIG.DEVELOPER_MODE_KEY, false);
        if (!developerMode) {
            vscode.window.showErrorMessage(
                `Enable '${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.DEVELOPER_MODE_KEY}' in settings to use this command.`
            );
            return;
        }

        const hasToken = await authManager.hasAuthToken();
        if (!hasToken) {
            vscode.window.showInformationMessage('Not logged in to Artemis — no JWT to show.');
            return;
        }

        const rawJwt = await authManager.getRawJwt();
        if (!rawJwt) {
            vscode.window.showErrorMessage('Failed to retrieve JWT token from secret storage.');
            logger.error('getRawJwt returned undefined despite hasAuthToken=true', LogCategory.AUTH);
            return;
        }

        await vscode.env.clipboard.writeText(rawJwt);

        const preview = `${rawJwt.substring(0, 20)}...`;
        logger.info(`JWT copied to clipboard via developer command (preview: ${preview})`, LogCategory.AUTH);

        vscode.window.showWarningMessage(
            `JWT copied to clipboard (${preview}). Do not share, do not commit.`
        );
    });
}

// ── Aggregate registration ───────────────────────────────────────────

interface CommandDeps {
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
        registerLogoutCommand(deps.authManager, deps.artemisApiService, deps.updateAuthContext, deps.artemisWebviewProvider),
        registerResetIrisChatCommand(deps.chatWebviewProvider),
        registerIrisHealthCheckCommand(deps.authManager, deps.artemisApiService, deps.providerRegistry),
        registerWebSocketStatusCommand(deps.artemisWebsocketService),
        registerConnectWebSocketCommand(deps.authManager, deps.artemisWebsocketService),
        registerPlantUmlRenderCommand(deps.artemisApiService),
        registerGoToSourceErrorCommand(),
        registerSetServerUrlCommand(),
        registerClearTrustedDomainsCommand(deps.context),
        registerStruggleScoreCommand(deps.telemetryManager),
        registerReplaySessionCommand(deps.context.globalStorageUri),
        registerOpenRecordingsFolderCommand(deps.context.globalStorageUri),
        registerShowJwtTokenCommand(deps.authManager),
    );
}
