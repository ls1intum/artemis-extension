import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '@extension/provider';
import type { AuthManager } from '@extension/services/auth';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ITelemetryManager } from '@extension/services/telemetry';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import { getTheiaEnvironment, KNOWN_BRIDGE_KEYS, probeDataBridge } from '@extension/theia';
import { extractErrorMessage, normalizeRelativePath, VSCODE_CONFIG } from '@extension/utils';

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
            // Best-effort server-side logout before clearing local state. Never
            // throws, so local cleanup proceeds regardless.
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

function registerReloadIrisChatCommand(chatWebviewProvider: ChatWebviewProvider): vscode.Disposable {
    // Escape hatch for a wedged client: drop everything local and re-read from
    // the server. Conversations live on Artemis, so nothing here is
    // destructive and no confirmation is needed.
    return vscode.commands.registerCommand('artemis.resetIrisChat', async () => {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Reloading Iris chat...',
                cancellable: false,
            }, async () => {
                await chatWebviewProvider.reloadIrisChat();
            });
        } catch (error: unknown) {
            vscode.window.showErrorMessage(`Failed to reload Iris chat: ${extractErrorMessage(error)}`);
        }
    });
}

function registerIrisHealthCheckCommand(
    authManager: AuthManager,
    artemisApiService: ArtemisApiService,
    chatWebviewProvider: ChatWebviewProvider,
): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.checkIrisHealth', async () => {
        try {
            if (!await authManager.hasAuthToken()) {
                vscode.window.showWarningMessage('Please log in to Artemis first before checking Iris health status.');
                return;
            }

            // The chat's own course, which is what the health check asks
            // about; never a topic. It survives a course with no conversation,
            // so the check still works where Iris is switched off.
            const courseId = chatWebviewProvider.currentCourseId;

            if (!courseId) {
                vscode.window.showWarningMessage('Choose a course in the Iris chat first, so there is one to check.');
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

/**
 * Action labels for the WebSocket-status notification quick-pick.
 *
 * Kept as a const-tuple so the same value flows through the notification's
 * action list and the dispatcher's switch without string drift.
 */
const WS_STATUS_ACTION = {
    LOGIN: 'Login to Artemis',
    RESET: 'Reset & Retry',
    RETRY: 'Retry Connection',
    DETAILS: 'Show Details',
    CLIPBOARD: 'Copy to Clipboard',
} as const;

type WSStatusAction = (typeof WS_STATUS_ACTION)[keyof typeof WS_STATUS_ACTION];

function isWSStatusAction(value: string): value is WSStatusAction {
    return (Object.values(WS_STATUS_ACTION) as string[]).includes(value);
}

interface WSAuthSnapshot {
    hasCookie: boolean;
    hasJwtToken: boolean;
    cookiePreview?: string;
}

type WSDiagnostics = ReturnType<ArtemisWebsocketService['getDiagnostics']>;

interface WSStatusSnapshot {
    isConnected: boolean;
    connectionState: string;
    diagnostics: WSDiagnostics;
    auth: WSAuthSnapshot;
}

async function collectWebSocketStatus(
    artemisWebsocketService: ArtemisWebsocketService,
    authManager: AuthManager,
): Promise<WSStatusSnapshot> {
    const diagnostics = artemisWebsocketService.getDiagnostics();
    const isConnected = artemisWebsocketService.isConnected();
    const connectionState = artemisWebsocketService.connectionState;

    let auth: WSAuthSnapshot = { hasCookie: false, hasJwtToken: false };
    try {
        const headers = await authManager.getAuthHeaders();
        const hasCookie = Object.keys(headers).length > 0;
        if (hasCookie) {
            const headerValue = headers['Cookie'] || headers['Authorization'] || '';
            auth = {
                hasCookie: true,
                hasJwtToken: headerValue.length > 0,
                cookiePreview: `${headerValue.substring(0, 20)}...`,
            };
        }
    } catch (error) {
        // Auth errors in diagnostics are non-fatal: the snapshot still shows
        // 'hasCookie: false', which is the diagnostically useful signal. Log at
        // warn so it shows up in the output channel during a diagnostics
        // session (this code path runs only on explicit user request).
        logger.warn(`Auth header lookup failed during WS diagnostics: ${extractErrorMessage(error)}`, LogCategory.WEBSOCKET);
    }

    return { isConnected, connectionState, diagnostics, auth };
}

function buildStatusReport(status: WSStatusSnapshot): string {
    const { isConnected, connectionState, diagnostics: d, auth } = status;
    const icon = isConnected ? '🟢' : '🔴';

    const lines = [
        `${icon} **WebSocket Status**`,
        ``,
        `**Connection:**`,
        `• Connected: ${isConnected ? 'Yes ✅' : 'No ❌'}`,
        `• State: ${connectionState}`,
        `• Client Active: ${d.clientActive ? 'Yes ✅' : 'No ❌'}`,
        `• Client Connected: ${d.clientConnected ? 'Yes ✅' : 'No ❌'}`,
        ``,
        `**Subscriptions (${d.subscriptionCount}):**`,
        ...d.subscriptions.map(sub => `• ${sub}`),
    ];

    if (!isConnected && !auth.hasCookie) {
        lines.push(``, `⚠️ **Not connected - Please log in to Artemis first**`);
    }

    lines.push(
        ``,
        `**Configuration:**`,
        `• Server URL: ${d.serverUrl}`,
        `• WebSocket URL: ${d.websocketUrl}`,
        ``,
        `**Authentication:**`,
        `• Has Cookie: ${auth.hasCookie ? 'Yes ✅' : 'No ❌'}`,
        `• Has JWT Token: ${auth.hasJwtToken ? 'Yes ✅' : 'No ❌'}`,
    );

    if (auth.cookiePreview) {
        lines.push(`• Cookie Preview: ${auth.cookiePreview}`);
    }

    lines.push(
        ``,
        `**Reconnection:**`,
        `• Attempts: ${d.reconnectAttempts}/${d.maxReconnectAttempts}`,
        `• Gave Up: ${connectionState === 'gave-up' ? 'Yes ⛔' : 'No'}`,
        `• Session ID: ${d.sessionId}`,
    );

    return lines.join('\n');
}

function decideStatusActions(status: WSStatusSnapshot): WSStatusAction[] {
    const { isConnected, connectionState, auth } = status;
    const tail: WSStatusAction[] = [WS_STATUS_ACTION.DETAILS, WS_STATUS_ACTION.CLIPBOARD];
    if (!auth.hasCookie) { return [WS_STATUS_ACTION.LOGIN, ...tail]; }
    if (connectionState === 'gave-up') { return [WS_STATUS_ACTION.RESET, ...tail]; }
    if (!isConnected) { return [WS_STATUS_ACTION.RETRY, ...tail]; }
    return tail;
}

function buildStatusHeadline(status: WSStatusSnapshot): string {
    const { isConnected, connectionState, auth } = status;
    const icon = isConnected ? '🟢' : '🔴';
    const suffixes = [
        connectionState === 'gave-up' ? ' (gave up)' : '',
        !auth.hasCookie ? ' (Not logged in)' : '',
    ].join('');
    return `${icon} WebSocket: ${isConnected ? 'Connected' : 'Disconnected'}${suffixes}`;
}

async function handleStatusAction(
    action: WSStatusAction,
    artemisWebsocketService: ArtemisWebsocketService,
    report: string,
): Promise<void> {
    switch (action) {
        case WS_STATUS_ACTION.LOGIN:
            await vscode.commands.executeCommand('artemis.loginView.focus');
            return;
        case WS_STATUS_ACTION.RESET:
        case WS_STATUS_ACTION.RETRY:
            try {
                artemisWebsocketService.resetConnectionState();
                await artemisWebsocketService.connect();
                vscode.window.showInformationMessage('WebSocket connection attempt started...');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to connect: ${extractErrorMessage(error)}`);
            }
            return;
        case WS_STATUS_ACTION.DETAILS: {
            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, { preview: true });
            return;
        }
        case WS_STATUS_ACTION.CLIPBOARD:
            await vscode.env.clipboard.writeText(report);
            vscode.window.showInformationMessage('WebSocket status copied to clipboard');
            return;
    }
}

function registerWebSocketStatusCommand(
    artemisWebsocketService: ArtemisWebsocketService,
    authManager: AuthManager,
): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.checkWebSocketStatus', async () => {
        try {
            const status = await collectWebSocketStatus(artemisWebsocketService, authManager);
            const report = buildStatusReport(status);
            const actions = decideStatusActions(status);
            const headline = buildStatusHeadline(status);

            const chosen = await vscode.window.showInformationMessage(
                headline,
                { modal: false },
                ...actions,
            );
            if (chosen && isWSStatusAction(chosen)) {
                await handleStatusAction(chosen, artemisWebsocketService, report);
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
    { label: 'Local Development (localhost:8080)',                   url: 'http://localhost:8080' },
];

const CURRENTLY_SELECTED_DETAIL = '$(check) Currently selected';

/**
 * Shows the server list with the row the user is already on highlighted.
 *
 * `showQuickPick` always opens on the first row, which is the production server. Someone
 * working against a test instance would find their own server further down and could
 * switch themselves to production by reflex. `createQuickPick` is the only way to set the
 * initially active row, which costs this promise wrapper.
 */
function pickServer(
    items: vscode.QuickPickItem[],
    currentItem: vscode.QuickPickItem | undefined,
    currentUrl: string,
): Promise<vscode.QuickPickItem | undefined> {
    return new Promise(resolve => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = 'Select Artemis Server';
        quickPick.placeholder = `Current: ${currentUrl || 'not set'}`;
        quickPick.items = items;
        if (currentItem) {
            quickPick.activeItems = [currentItem];
        }
        quickPick.onDidAccept(() => {
            resolve(quickPick.selectedItems[0]);
            quickPick.hide();
        });
        // Also the accept path's second half: hiding after an accept re-resolves a settled
        // promise, which is a no-op, and disposing here covers cancellation too.
        quickPick.onDidHide(() => {
            resolve(undefined);
            quickPick.dispose();
        });
        quickPick.show();
    });
}

/**
 * Sets `artemis.defaultClonePath` from a folder dialog.
 *
 * The dialog options match the "Set Default Folder" branch of the clone flow, so both
 * routes to this setting look the same to a student. Going through a dialog also means the
 * stored path is always absolute, which the setting requires: it is used verbatim, so a
 * hand-typed `~/exercises` reaches the filesystem unexpanded and fails at clone time.
 */
function registerSetDefaultClonePathCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.setDefaultClonePath', async () => {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Set as Default',
            title: 'Select default folder for all exercise repositories',
        });

        const folderPath = folderUri?.[0]?.fsPath;
        if (!folderPath) {
            return;
        }

        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        await config.update(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, folderPath, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`✓ All exercises will now be cloned to: ${folderPath}`);
    });
}

function registerSetServerUrlCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.setServerUrl', async () => {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const currentUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, '');
        const hasCustomCurrent = currentUrl.length > 0 && !KNOWN_SERVERS.some(s => s.url === currentUrl);

        const items: vscode.QuickPickItem[] = [];
        // Tracked while the list is built rather than searched for afterwards, so the
        // highlighted row is decided by the URL itself and not by matching on a label.
        let currentItem: vscode.QuickPickItem | undefined;

        if (hasCustomCurrent) {
            let hostname = currentUrl;
            try {
                hostname = new URL(currentUrl).host || currentUrl;
            } catch {
                // Fall back to the raw value if it fails to parse.
            }
            currentItem = {
                label: `Custom (${hostname})`,
                description: currentUrl,
                detail: CURRENTLY_SELECTED_DETAIL,
            };
            items.push(
                currentItem,
                { label: '', kind: vscode.QuickPickItemKind.Separator },
            );
        }

        const knownItems = KNOWN_SERVERS.map(server => ({
            label: server.label,
            description: server.url,
            detail: server.url === currentUrl ? CURRENTLY_SELECTED_DETAIL : undefined,
        }));
        items.push(...knownItems);
        if (!currentItem) {
            currentItem = knownItems.find(item => item.description === currentUrl);
        }

        items.push(
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            { label: '$(edit) Enter custom URL...', description: 'Use your own Artemis server URL' },
        );

        const selection = await pickServer(items, currentItem, currentUrl);

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

function registerStruggleScoreCommand(telemetryManager: ITelemetryManager): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.showStruggleScore', async () => {
        await telemetryManager.showStruggleScoreDialog();
    });
}

/**
 * Developer-only command: copy the current raw JWT to the clipboard for use
 * in curl/Postman based server testing. Gated on the `artemis.developerMode`
 * setting both at the menu level (commandPalette `when` clause) and at runtime
 * (defense-in-depth against direct invocation via `vscode.commands.executeCommand`).
 *
 * The full token is NEVER shown in the UI or written to logs. Only a masked
 * preview appears in the notification; the full value lands in the clipboard.
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

/**
 * Diagnostic command: dumps the detected Theia environment to verify
 * managed-deployment activation. Token is masked and GIT_URI is reduced to its
 * host so embedded credentials never leak into the UI.
 */
function registerShowTheiaEnvironmentCommand(): vscode.Disposable {
    return vscode.commands.registerCommand('artemis.showTheiaEnvironment', async () => {
        const env = getTheiaEnvironment();
        const uiKind = vscode.env.uiKind === vscode.UIKind.Web ? 'Web' : 'Desktop';
        const dataBridgeEnabled = process.env.DATA_BRIDGE_ENABLED;
        const theiaFlag = process.env.THEIA;
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

        // Render an env-var value safely: tokens reduced to length, git URIs
        // reduced to host+path so embedded credentials never leak into the UI.
        const formatEnvValue = (key: string, value: string | undefined): string => {
            if (!value) { return 'missing'; }
            if (key === 'ARTEMIS_TOKEN') { return `present (${value.length} chars)`; }
            if (key === 'GIT_URI') {
                try {
                    const u = new URL(value);
                    return `present (host: ${u.host}, path: ${u.pathname})`;
                } catch {
                    return 'present (unparseable)';
                }
            }
            return value;
        };

        const probe = await probeDataBridge();

        const probeLines: string[] = ['', '## Live data-bridge probe'];
        if (!probe.commandAvailable) {
            probeLines.push(
                `- \`dataBridge.getEnv\` command: **not registered**`,
                `- Bridge extension is not installed or not active.`,
                `- \`process.env.DATA_BRIDGE_ENABLED\`: ${probe.bridgeEnabledFlag ?? '(unset)'}`,
            );
        } else if (!probe.responded) {
            probeLines.push(
                `- \`dataBridge.getEnv\` command: ✅ registered`,
                `- Probe failed: ${probe.error ?? 'unknown error'}`,
            );
        } else {
            const presentCount = Object.keys(probe.values).length;
            probeLines.push(
                `- \`dataBridge.getEnv\` command: ✅ registered, responded`,
                `- Keys present in bridge: ${presentCount}/${KNOWN_BRIDGE_KEYS.length}`,
            );
            for (const key of KNOWN_BRIDGE_KEYS) {
                probeLines.push(`- \`${key}\`: ${formatEnvValue(key, probe.values[key])}`);
            }
        }

        const lines = [
            `# Theia Environment Diagnostic`,
            ``,
            `**Result:** ${env.isTheia ? 'Theia detected ✅' : 'Theia NOT detected ❌'}`,
            `**Managed environment:** ${env.isManagedEnvironment ? 'Yes' : 'No'}`,
            ``,
            `## Detection signals`,
            `- \`vscode.env.uiKind\`: ${uiKind}`,
            `- \`process.env.DATA_BRIDGE_ENABLED\`: ${dataBridgeEnabled ?? '(unset)'}`,
            `- \`process.env.THEIA\`: ${theiaFlag ?? '(unset)'}`,
            ``,
            `## Environment variables (snapshot at activation)`,
            `- \`ARTEMIS_URL\`: ${formatEnvValue('ARTEMIS_URL', env.artemisUrl)}`,
            `- \`ARTEMIS_TOKEN\`: ${formatEnvValue('ARTEMIS_TOKEN', env.artemisToken)}`,
            ...probeLines,
            ``,
            `## Workspace`,
            `- Folder count: ${workspaceFolders.length}`,
            ...workspaceFolders.map((f, i) => `  ${i + 1}. \`${f.uri.fsPath}\``),
        ];
        const details = lines.join('\n');

        const summary = env.isTheia
            ? `✅ Theia detected (uiKind=${uiKind}, managed=${env.isManagedEnvironment})`
            : `❌ Theia NOT detected (uiKind=${uiKind}, DATA_BRIDGE_ENABLED=${dataBridgeEnabled ?? 'unset'})`;

        const action = await vscode.window.showInformationMessage(
            summary,
            { modal: false },
            'Show Details',
            'Copy to Clipboard',
        );

        if (action === 'Show Details') {
            const doc = await vscode.workspace.openTextDocument({
                content: details,
                language: 'markdown',
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        } else if (action === 'Copy to Clipboard') {
            await vscode.env.clipboard.writeText(details);
            vscode.window.showInformationMessage('Theia environment copied to clipboard');
        }
    });
}

interface CommandDeps {
    context: vscode.ExtensionContext;
    authManager: AuthManager;
    artemisApiService: ArtemisApiService;
    artemisWebsocketService: ArtemisWebsocketService;
    telemetryManager: ITelemetryManager;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>;
}

export function registerAllCommands(deps: CommandDeps): vscode.Disposable {
    return vscode.Disposable.from(
        registerLoginCommand(),
        registerLogoutCommand(deps.authManager, deps.artemisApiService, deps.updateAuthContext, deps.artemisWebviewProvider),
        registerReloadIrisChatCommand(deps.chatWebviewProvider),
        registerIrisHealthCheckCommand(deps.authManager, deps.artemisApiService, deps.chatWebviewProvider),
        registerWebSocketStatusCommand(deps.artemisWebsocketService, deps.authManager),
        registerConnectWebSocketCommand(deps.authManager, deps.artemisWebsocketService),
        registerGoToSourceErrorCommand(),
        registerSetServerUrlCommand(),
        registerSetDefaultClonePathCommand(),
        registerClearTrustedDomainsCommand(deps.context),
        registerStruggleScoreCommand(deps.telemetryManager),
        registerShowJwtTokenCommand(deps.authManager),
        registerShowTheiaEnvironmentCommand(),
    );
}
