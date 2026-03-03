import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { CommandContext, CommandMap } from './types';
import { getPayload, ExtensionMsg, WebviewCmd } from '../../../shared/messageContracts';
import type {
    WebviewToExtensionMessage,
    WebCmd,
} from '../../../shared/messageContracts';
import { BuildLogParser, normalizeRelativePath, extractErrorMessage, CONFIG, VSCODE_CONFIG } from '../../../utils';
import { logger, LogLevel, LogCategory } from '../../../services/loggingService';

export class UtilityCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.Alert]: this.handleAlert,
            [WebviewCmd.OpenSettings]: this.handleOpenSettings,
            [WebviewCmd.OpenWebsite]: this.handleOpenWebsite,
            [WebviewCmd.OpenBugReport]: this.handleOpenBugReport,
            [WebviewCmd.OpenInEditor]: this.handleOpenInEditor,
            [WebviewCmd.CopyToClipboard]: this.handleCopyToClipboard,
            [WebviewCmd.SearchMarketplace]: this.handleSearchMarketplace,
            [WebviewCmd.ShowSubmissionDetails]: this.handleShowSubmissionDetails,
            [WebviewCmd.FetchTestResults]: this.handleFetchTestResults,
            [WebviewCmd.OpenExerciseInBrowser]: this.handleOpenExerciseInBrowser,
            [WebviewCmd.ViewBuildLog]: this.handleViewBuildLog,
            [WebviewCmd.GoToSourceError]: this.handleGoToSourceError,
            [WebviewCmd.FetchBuildLogsForError]: this.handleFetchBuildLogsForError,
            [WebviewCmd.ClearBuildErrors]: this.handleClearBuildErrors,
            [WebviewCmd.WebviewLog]: this.handleWebviewLog,
            [WebviewCmd.OpenExternalLink]: this.handleOpenExternalLink,
            [WebviewCmd.OpenImagePreview]: this.handleOpenImagePreview,
        };
    }

    private handleAlert = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'alert'>>(message);
            if (payload.text) {
                vscode.window.showErrorMessage(payload.text);
            }
        } catch (error: unknown) {
            logger.error('Failed to show alert:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to show alert: ${extractErrorMessage(error)}`);
        }
    };

    private handleOpenSettings = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'openSettings'>>(message);
            const settingId = payload?.setting || 'Artemis';
            await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
        } catch (error: unknown) {
            logger.error('Failed to open settings:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to open settings: ${extractErrorMessage(error)}`);
        }
    };

    private handleOpenWebsite = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
            await vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/courses`));
        } catch (error: unknown) {
            logger.error('Failed to open website:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to open website: ${extractErrorMessage(error)}`);
        }
    };

    private handleOpenBugReport = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            await vscode.env.openExternal(vscode.Uri.parse('https://github.com/ls1intum/artemis-extension/issues'));
        } catch (error: unknown) {
            logger.error('Failed to open bug report page:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to open bug report page: ${extractErrorMessage(error)}`);
        }
    };

    private handleOpenInEditor = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'openInEditor'>>(message);
            await this.context.actionHandler.openJsonInEditor(payload.data);
        } catch (error: unknown) {
            logger.error('Failed to open in editor:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to open in editor: ${extractErrorMessage(error)}`);
        }
    };

    private handleCopyToClipboard = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'copyToClipboard'>>(message);
            if (typeof payload.text === 'string') {
                await vscode.env.clipboard.writeText(payload.text);
                vscode.window.showInformationMessage('Copied to clipboard');
            }
        } catch (error: unknown) {
            logger.error('Failed to copy to clipboard:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to copy to clipboard: ${extractErrorMessage(error)}`);
        }
    };

    private handleSearchMarketplace = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'searchMarketplace'>>(message);
            if (payload.extensionId) {
                await vscode.commands.executeCommand('workbench.extensions.search', `@id:${payload.extensionId}`);
            }
        } catch (error: unknown) {
            logger.error('Failed to search marketplace:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to search marketplace: ${extractErrorMessage(error)}`);
        }
    };

    private handleShowSubmissionDetails = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'showSubmissionDetails'>>(message);
            const participationId = payload.participationId;
            const resultId = payload.resultId;
            if (!participationId || !resultId) {
                vscode.window.showErrorMessage('Cannot fetch submission details: missing participation or result ID.');
                return;
            }

            vscode.window.showInformationMessage('Loading submission details...');

            const resultDetails = await this.context.artemisApi.getResultDetails(participationId, resultId);

            if (resultDetails) {
                await this.context.actionHandler.openJsonInEditor(resultDetails);
                vscode.window.showInformationMessage('Submission details opened in editor');
            } else {
                vscode.window.showErrorMessage('No submission details found');
            }
        } catch (error: unknown) {
            logger.submissionError('Show submission details error:', error);
            vscode.window.showErrorMessage(`Failed to fetch submission details: ${extractErrorMessage(error)}`);
        }
    };

    private handleFetchTestResults = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'fetchTestResults'>>(message);
            const participationId = payload.participationId;
            const resultId = payload.resultId;
            if (!participationId || !resultId) {
                this.context.sendMessage({
                    type: ExtensionMsg.TestResultsData,
                    testCases: [],
                    error: 'Missing participation or result ID'
                });
                return;
            }

            const resultDetails = await this.context.artemisApi.getResultDetails(participationId, resultId);

            logger.submission('[Test Results] Result details received:', JSON.stringify(resultDetails, null, 2));

            let feedbacks: unknown[] = [];

            if (Array.isArray(resultDetails)) {
                feedbacks = resultDetails;
            } else if (resultDetails && typeof resultDetails === 'object' && 'feedbacks' in resultDetails && Array.isArray(resultDetails.feedbacks)) {
                feedbacks = resultDetails.feedbacks;
            }

            logger.submission('[Test Results] Feedbacks array:', feedbacks.length, 'items');

            if (feedbacks.length > 0) {
                const testCases = feedbacks
                    .filter((feedback): feedback is Record<string, unknown> =>
                        typeof feedback === 'object' && feedback !== null && 'testCase' in feedback)
                    .map((feedback) => ({
                        testName: (typeof feedback.testCase === 'object' && feedback.testCase !== null && 'testName' in feedback.testCase && typeof feedback.testCase.testName === 'string')
                            ? feedback.testCase.testName
                            : 'Unnamed Test',
                        successful: feedback.positive === true,
                        message: typeof feedback.detailText === 'string' ? feedback.detailText : '',
                        type: (typeof feedback.testCase === 'object' && feedback.testCase !== null && 'type' in feedback.testCase)
                            ? feedback.testCase.type
                            : feedback.type,
                        credits: feedback.credits,
                        visibility: (typeof feedback.testCase === 'object' && feedback.testCase !== null && 'visibility' in feedback.testCase)
                            ? feedback.testCase.visibility
                            : undefined
                    }));

                logger.submission('[Test Results] Mapped test cases:', testCases.length, 'items');

                this.context.sendMessage({
                    type: ExtensionMsg.TestResultsData,
                    testCases: testCases
                });
            } else {
                logger.submission('[Test Results] No feedbacks found in result details');
                this.context.sendMessage({
                    type: ExtensionMsg.TestResultsData,
                    testCases: []
                });
            }
        } catch (error: unknown) {
            logger.submissionError('Fetch test results error:', error);
            this.context.sendMessage({
                type: ExtensionMsg.TestResultsData,
                testCases: [],
                error: extractErrorMessage(error)
            });
        }
    };

    private handleOpenExerciseInBrowser = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'openExerciseInBrowser'>>(message);
            const exerciseId = payload.exerciseId;
            const courseId = payload.courseId;

            if (!exerciseId) {
                vscode.window.showErrorMessage('Cannot open exercise: missing exercise ID');
                return;
            }
            // Get the server URL from configuration
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);

            if (!courseId) {
                vscode.window.showErrorMessage('Cannot open exercise in browser: missing course ID');
                return;
            }

            const exerciseUrl = `${serverUrl}/courses/${courseId}/exercises/${exerciseId}`;

            // Open in external browser
            await vscode.env.openExternal(vscode.Uri.parse(exerciseUrl));
        } catch (error: unknown) {
            logger.viewError('Open exercise in browser error:', error);
            vscode.window.showErrorMessage(`Failed to open exercise in browser: ${extractErrorMessage(error)}`);
        }
    };

    private handleViewBuildLog = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'viewBuildLog'>>(message);
            const participationId = payload.participationId;
            const resultId = payload.resultId;
            if (!participationId) {
                vscode.window.showErrorMessage('Cannot fetch build log: missing participation ID.');
                return;
            }

            vscode.window.showInformationMessage('Loading build log...');

            const buildLogs = await this.context.artemisApi.getBuildLogs(participationId, resultId);

            if (!buildLogs || buildLogs.length === 0) {
                vscode.window.showInformationMessage('No build logs available for this submission.');
                return;
            }

            // Parse the first error from build logs
            const firstError = BuildLogParser.parseFirstError(buildLogs);

            // Format the build log for display
            const logContent = buildLogs
                .map((entry: unknown) => {
                    if (typeof entry !== 'object' || entry === null) {return '';}
                    const entryObj = entry as { time?: unknown; log?: unknown };
                    const timestamp = entryObj.time ? new Date(entryObj.time as string).toISOString().replace('T', ' ').substring(0, 19) : '';
                    const log = typeof entryObj.log === 'string' ? entryObj.log : '';
                    return `${timestamp}\n    ${log}`;
                })
                .join('\n');

            // Create header with metadata and error summary
            let header = `${'='.repeat(80)}\nArtemis Build Log\n${'='.repeat(80)}\n\n`;

            if (firstError) {
                header += `⚠️  First Error Found:\n`;
                header += `   ${BuildLogParser.formatError(firstError)}\n\n`;
                header += `${'='.repeat(80)}\n\n`;
            }

            const fullContent = header + logContent;

            // Open in a new editor tab
            const document = await vscode.workspace.openTextDocument({
                content: fullContent,
                language: 'log'
            });

            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.Active
            });

            // Send parsed error back to webview so it can show "Go to Source" button
            this.context.sendMessage({
                type: ExtensionMsg.BuildLogParsed,
                error: firstError,
                participationId: participationId,
                resultId: resultId
            });

            vscode.window.showInformationMessage('Build log opened in editor');
        } catch (error: unknown) {
            logger.error('View build log error:', LogCategory.BUILD, error);
            vscode.window.showErrorMessage(`Failed to fetch build log: ${extractErrorMessage(error)}`);
        }
    };

    private handleGoToSourceError = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'goToSourceError'>>(message);
            const filePath: string = normalizeRelativePath(payload.filePath);
            const line = payload.line;
            const column = payload.column;
            if (!filePath) {
                vscode.window.showErrorMessage('Cannot navigate to source: missing file path.');
                return;
            }

            // Check if workspace is open
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open. Please open the exercise repository first.');
                return;
            }

            // Construct full file path
            const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);

            // Check if file exists
            try {
                await vscode.workspace.fs.stat(fullPath);
            } catch {
                vscode.window.showErrorMessage(`File not found: ${filePath}\n\nMake sure you have the exercise repository open in the workspace.`);
                return;
            }

            // Open the file
            const document = await vscode.workspace.openTextDocument(fullPath);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });

            // Navigate to the error location
            if (line > 0) {
                const position = new vscode.Position(line - 1, column ? column - 1 : 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            }

            vscode.window.showInformationMessage(`Navigated to ${filePath}:${line}`);
        } catch (error: unknown) {
            logger.viewError('Go to source error:', error);
            vscode.window.showErrorMessage(`Failed to navigate to source: ${extractErrorMessage(error)}`);
        }
    };

    private handleFetchBuildLogsForError = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'fetchBuildLogsForError'>>(message);
            const participationId = payload.participationId;
            const resultId = payload.resultId;
            if (!participationId) {
                logger.error('Cannot fetch build logs for error: missing participation ID.', LogCategory.BUILD);
                return;
            }

            logger.info('[Build Log] 🔍 Fetching build logs in background to parse errors...', LogCategory.BUILD);

            const buildLogs = await this.context.artemisApi.getBuildLogs(participationId, resultId);

            if (!buildLogs || buildLogs.length === 0) {
                logger.info('[Build Log] No build logs available for error parsing', LogCategory.BUILD);
                return;
            }

            // Parse the first error from build logs
            const firstError = BuildLogParser.parseFirstError(buildLogs);

            // Send parsed error back to webview so it can show "Go to Source" button
            if (firstError) {
                logger.info('[Build Log] ✅ Parsed error from build logs:', LogCategory.BUILD, firstError);

                // Show CodeLens above the error line
                if (this.context.buildCodeLens) {
                    this.context.buildCodeLens.setErrors(firstError.filePath, [firstError]);
                }

                this.context.sendMessage({
                    type: ExtensionMsg.BuildLogParsed,
                    error: firstError,
                    participationId: participationId,
                    resultId: resultId
                });
            } else {
                logger.info('No parseable errors found in build logs', LogCategory.BUILD);
            }
        } catch (error: unknown) {
            logger.error('Fetch build logs for error:', LogCategory.BUILD, error);
            // Silently fail - this is a background operation
        }
    };

    private handleClearBuildErrors = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            logger.info('🧹 Clearing CodeLens build errors...', LogCategory.BUILD);

            // Clear all build errors from CodeLens
            if (this.context.buildCodeLens) {
                this.context.buildCodeLens.clearErrors();
                logger.info('✅ CodeLens errors cleared', LogCategory.BUILD);
            }
        } catch (error: unknown) {
            logger.error('Error clearing build errors:', LogCategory.BUILD, error);
            // Silently fail - this is a background operation
        }
    };

    /**
     * Handles log messages from webview scripts
     */
    private handleWebviewLog = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'webviewLog'>>(message);
            const { level, text } = payload;
            const logCategory = LogCategory.VIEW;

            switch (level) {
                case 'error':
                    logger.error(text, logCategory, payload.error);
                    break;
                case 'warn':
                    logger.warn(text, logCategory);
                    break;
                case 'debug':
                    logger.debug(text, logCategory);
                    break;
                case 'info':
                default:
                    logger.info(text, logCategory);
                    break;
            }
        } catch (error: unknown) {
            logger.error('Failed to process webview log:', LogCategory.VIEW, error);
        }
    };

    /**
     * Handle opening external links with trusted domain confirmation
     */
    private handleOpenExternalLink = async (message: WebviewToExtensionMessage): Promise<void> => {
        let url: string | undefined;
        try {
            // Input validation
            const payload = getPayload<WebCmd<'openExternalLink'>>(message);
            url = payload.url;
            if (!url || typeof url !== 'string') {
                vscode.window.showErrorMessage('Invalid URL: missing or not a string');
                return;
            }

            // Protocol validation
            if (!this.isAllowedProtocol(url)) {
                logger.error('Invalid URL protocol', LogCategory.VIEW, { url });
                const action = await vscode.window.showErrorMessage(
                    'Invalid URL protocol. Only http:// and https:// links are allowed.',
                    'Copy URL'
                );
                if (action === 'Copy URL') {
                    await vscode.env.clipboard.writeText(url);
                }
                return;
            }

            // Domain extraction
            const domain = this.extractDomain(url);
            if (!domain) {
                logger.error('Failed to extract domain', LogCategory.VIEW, { url });
                const action = await vscode.window.showErrorMessage(
                    'Invalid URL format.',
                    'Copy URL'
                );
                if (action === 'Copy URL') {
                    await vscode.env.clipboard.writeText(url);
                }
                return;
            }

            // Trusted domain check
            const trustedDomains = this.context.extensionContext.globalState.get<string[]>('artemis.trustedDomains', []);
            const validatedDomains = Array.isArray(trustedDomains) ? trustedDomains : [];

            if (validatedDomains.includes(domain)) {
                // Domain is trusted, open directly
                await vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }

            // Confirmation dialog for untrusted domain
            const truncatedUrl = this.truncateUrl(url);
            const result = await vscode.window.showInformationMessage(
                `Open external link?\n\n${truncatedUrl}`,
                { modal: true },
                'Open',
                'Trust this domain'
            );

            if (result === 'Open') {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            } else if (result === 'Trust this domain') {
                // Add domain to trusted list
                const updatedDomains = [...validatedDomains, domain];
                await this.context.extensionContext.globalState.update('artemis.trustedDomains', updatedDomains);
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        } catch (error: unknown) {
            logger.error('Open external link error:', LogCategory.VIEW, error);
            const action = await vscode.window.showErrorMessage(
                `Failed to open external link: ${extractErrorMessage(error)}`,
                'Copy URL'
            );
            if (action === 'Copy URL' && url) {
                await vscode.env.clipboard.writeText(url);
            }
        }
    };

    /**
     * Handle opening image previews (data URIs or remote URLs)
     */
    private handleOpenImagePreview = async (message: WebviewToExtensionMessage): Promise<void> => {
        let uri: string | undefined;
        try {
            // Input validation
            const payload = getPayload<WebCmd<'openImagePreview'>>(message);
            uri = payload.uri;
            if (!uri || typeof uri !== 'string') {
                vscode.window.showErrorMessage('Invalid image URI: missing or not a string');
                return;
            }

            // Data URI handling
            if (uri.startsWith('data:')) {
                const parsed = this.parseDataUri(uri);
                if (!parsed) {
                    vscode.window.showErrorMessage('Failed to decode image data');
                    return;
                }

                const { mimeType, data } = parsed;
                const extension = this.getExtensionFromMime(mimeType);
                const tempFileName = `image-${crypto.randomBytes(8).toString('hex')}${extension}`;
                const tempFileUri = vscode.Uri.joinPath(this.context.extensionContext.globalStorageUri, tempFileName);

                // Ensure directory exists
                await vscode.workspace.fs.createDirectory(this.context.extensionContext.globalStorageUri);

                // Write file
                await vscode.workspace.fs.writeFile(tempFileUri, data);

                // Open in VS Code viewer
                await vscode.commands.executeCommand('vscode.open', tempFileUri);
                return;
            }

            // Remote URL handling
            if (!this.isAllowedProtocol(uri)) {
                logger.error('Invalid image URL protocol', LogCategory.VIEW, { uri });
                const action = await vscode.window.showErrorMessage(
                    'Invalid image URL protocol. Only http:// and https:// are allowed.',
                    'Copy URL'
                );
                if (action === 'Copy URL') {
                    await vscode.env.clipboard.writeText(uri);
                }
                return;
            }

            // Open remote image in default browser
            await vscode.env.openExternal(vscode.Uri.parse(uri));
        } catch (error: unknown) {
            logger.error('Open image preview error:', LogCategory.VIEW, error);
            const action = await vscode.window.showErrorMessage(
                `Failed to open image: ${extractErrorMessage(error)}`,
                'Copy URL'
            );
            if (action === 'Copy URL' && uri) {
                await vscode.env.clipboard.writeText(uri);
            }
        }
    };

    /**
     * Check if URL has an allowed protocol (http or https)
     */
    private isAllowedProtocol(url: string): boolean {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    /**
     * Extract domain from URL
     */
    private extractDomain(url: string): string | null {
        try {
            const parsed = new URL(url);
            return parsed.hostname;
        } catch {
            return null;
        }
    }

    /**
     * Truncate URL for display
     */
    private truncateUrl(url: string, maxLength: number = 80): string {
        if (url.length <= maxLength) {
            return url;
        }
        return url.slice(0, maxLength - 3) + '...';
    }

    /**
     * Parse data URI into mime type and decoded data
     */
    private parseDataUri(dataUri: string): { mimeType: string; data: Buffer } | null {
        try {
            // Strip "data:" prefix
            const dataContent = dataUri.slice(5);
            const commaIndex = dataContent.indexOf(',');
            if (commaIndex === -1) {
                return null;
            }

            const metadata = dataContent.slice(0, commaIndex);
            const dataString = dataContent.slice(commaIndex + 1);

            // Parse metadata
            const isBase64 = metadata.includes(';base64');
            let mimeType = metadata.split(';')[0] || 'image/png';

            // Decode data
            let buffer: Buffer;
            if (isBase64) {
                buffer = Buffer.from(dataString, 'base64');
            } else {
                buffer = Buffer.from(decodeURIComponent(dataString));
            }

            return { mimeType, data: buffer };
        } catch {
            return null;
        }
    }

    /**
     * Get file extension from MIME type
     */
    private getExtensionFromMime(mimeType: string): string {
        const mimeMap: Record<string, string> = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/gif': '.gif',
            'image/svg+xml': '.svg',
            'image/webp': '.webp',
        };
        return mimeMap[mimeType] || '.png';
    }
}
