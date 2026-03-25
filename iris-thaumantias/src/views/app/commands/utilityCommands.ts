import * as vscode from 'vscode';
import type { CommandContext, CommandMap } from './types';
import { BuildLogParser, normalizeRelativePath } from '../../../utils';
import { logger, LogLevel, LogCategory } from '../../../services/loggingService';

export class UtilityCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            alert: this.handleAlert,
            openSettings: this.handleOpenSettings,
            openWebsite: this.handleOpenWebsite,
            openBugReport: this.handleOpenBugReport,
            openInEditor: this.handleOpenInEditor,
            copyToClipboard: this.handleCopyToClipboard,
            searchMarketplace: this.handleSearchMarketplace,
            showSubmissionDetails: this.handleShowSubmissionDetails,
            fetchTestResults: this.handleFetchTestResults,
            openExerciseInBrowser: this.handleOpenExerciseInBrowser,
            viewBuildLog: this.handleViewBuildLog,
            goToSourceError: this.handleGoToSourceError,
            fetchBuildLogsForError: this.handleFetchBuildLogsForError,
            clearBuildErrors: this.handleClearBuildErrors,
            webviewLog: this.handleWebviewLog,
            openExternalLink: this.handleOpenExternalLink,
            downloadFile: this.handleDownloadFile,
        };
    }

    private handleAlert = async (message: any): Promise<void> => {
        if (message?.text) {
            vscode.window.showErrorMessage(message.text);
        }
    };

    private handleOpenSettings = async (message: any): Promise<void> => {
        const settingId = message?.settingId || 'Artemis';
        await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
    };

    private handleOpenWebsite = async (): Promise<void> => {
        await vscode.env.openExternal(vscode.Uri.parse('https://artemis.tum.de/courses'));
    };

    private handleOpenBugReport = async (): Promise<void> => {
        await vscode.env.openExternal(vscode.Uri.parse('https://github.com/ls1intum/artemis-extension/issues'));
    };

    private handleOpenInEditor = async (message: any): Promise<void> => {
        await this.context.actionHandler.openJsonInEditor(message.data);
    };

    private handleCopyToClipboard = async (message: any): Promise<void> => {
        if (typeof message.text === 'string') {
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.showInformationMessage('Copied to clipboard');
        }
    };

    private handleSearchMarketplace = async (message: any): Promise<void> => {
        if (message.extensionId) {
            await vscode.commands.executeCommand('workbench.extensions.search', `@id:${message.extensionId}`);
        }
    };

    private handleShowSubmissionDetails = async (message: any): Promise<void> => {
        const participationId: number = message.participationId;
        const resultId: number = message.resultId;

        try {
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
        } catch (error) {
            logger.submissionError('Show submission details error:', error);
            vscode.window.showErrorMessage(`Failed to fetch submission details: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    private handleFetchTestResults = async (message: any): Promise<void> => {
        const participationId: number = message.participationId;
        const resultId: number = message.resultId;

        try {
            if (!participationId || !resultId) {
                this.context.sendMessage({
                    command: 'testResultsData',
                    testCases: [],
                    error: 'Missing participation or result ID'
                });
                return;
            }

            const resultDetails = await this.context.artemisApi.getResultDetails(participationId, resultId);

            logger.submission('[Test Results] Result details received:', JSON.stringify(resultDetails, null, 2));

            let feedbacks: any[] = [];

            if (Array.isArray(resultDetails)) {
                feedbacks = resultDetails;
            } else if (resultDetails && resultDetails.feedbacks) {
                feedbacks = resultDetails.feedbacks;
            }

            logger.submission('[Test Results] Feedbacks array:', feedbacks.length, 'items');

            if (feedbacks.length > 0) {
                const testCases = feedbacks
                    .filter((feedback: any) => feedback.testCase)
                    .map((feedback: any) => ({
                        testName: feedback.testCase?.testName || 'Unnamed Test',
                        successful: feedback.positive === true,
                        message: feedback.detailText || '',
                        type: feedback.testCase?.type || feedback.type,
                        credits: feedback.credits,
                        visibility: feedback.testCase?.visibility
                    }));

                logger.submission('[Test Results] Mapped test cases:', testCases.length, 'items');

                this.context.sendMessage({
                    command: 'testResultsData',
                    testCases: testCases
                });
            } else {
                logger.submission('[Test Results] No feedbacks found in result details');
                this.context.sendMessage({
                    command: 'testResultsData',
                    testCases: []
                });
            }
        } catch (error) {
            logger.submissionError('Fetch test results error:', error);
            this.context.sendMessage({
                command: 'testResultsData',
                testCases: [],
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    private handleOpenExerciseInBrowser = async (message: any): Promise<void> => {
        const exerciseId: number = message.exerciseId;
        const courseId: number = message.courseId;

        if (!exerciseId) {
            vscode.window.showErrorMessage('Cannot open exercise: missing exercise ID');
            return;
        }

        try {
            // Get the server URL from configuration
            const config = vscode.workspace.getConfiguration('artemis');
            const serverUrl = config.get<string>('serverUrl', 'https://artemis.cit.tum.de');

            // Construct the exercise URL
            // Format: https://artemis.cit.tum.de/courses/{courseId}/exercises/{exerciseId}
            let exerciseUrl: string;
            if (courseId) {
                exerciseUrl = `${serverUrl}/courses/${courseId}/exercises/${exerciseId}`;
            } else {
                // Fallback if no course ID is available
                exerciseUrl = `${serverUrl}/courses/exercises/${exerciseId}`;
            }

            // Open in external browser
            await vscode.env.openExternal(vscode.Uri.parse(exerciseUrl));
        } catch (error) {
            logger.viewError('Open exercise in browser error:', error);
            vscode.window.showErrorMessage(`Failed to open exercise in browser: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    private handleViewBuildLog = async (message: any): Promise<void> => {
        const participationId: number = message.participationId;
        const resultId: number | undefined = message.resultId;

        try {
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
                .map((entry: any) => {
                    const timestamp = new Date(entry.time).toISOString().replace('T', ' ').substring(0, 19);
                    return `${timestamp}\n    ${entry.log}`;
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
            if (firstError) {
                this.context.sendMessage({
                    command: 'buildLogParsed',
                    error: firstError,
                    participationId: participationId,
                    resultId: resultId
                });
            }

            vscode.window.showInformationMessage('Build log opened in editor');
        } catch (error) {
            logger.error('View build log error:', LogCategory.BUILD, error);
            vscode.window.showErrorMessage(`Failed to fetch build log: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    private handleGoToSourceError = async (message: any): Promise<void> => {
        const filePath: string = normalizeRelativePath(message.filePath);
        const line: number = message.line;
        const column: number | undefined = message.column;

        try {
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
        } catch (error) {
            logger.viewError('Go to source error:', error);
            vscode.window.showErrorMessage(`Failed to navigate to source: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    private handleFetchBuildLogsForError = async (message: any): Promise<void> => {
        const participationId: number = message.participationId;
        const resultId: number | undefined = message.resultId;

        try {
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
                    command: 'buildLogParsed',
                    error: firstError,
                    participationId: participationId,
                    resultId: resultId
                });
            } else {
                logger.info('No parseable errors found in build logs', LogCategory.BUILD);
            }
        } catch (error) {
            logger.error('Fetch build logs for error:', LogCategory.BUILD, error);
            // Silently fail - this is a background operation
        }
    };

    private handleClearBuildErrors = async (): Promise<void> => {
        try {
            logger.info('🧹 Clearing CodeLens build errors...', LogCategory.BUILD);

            // Clear all build errors from CodeLens
            if (this.context.buildCodeLens) {
                this.context.buildCodeLens.clearErrors();
                logger.info('✅ CodeLens errors cleared', LogCategory.BUILD);
            }
        } catch (error) {
            logger.error('Error clearing build errors:', LogCategory.BUILD, error);
            // Silently fail - this is a background operation
        }
    };

    /**
     * Handles log messages from webview scripts
     */
    private handleWebviewLog = async (message: any): Promise<void> => {
        const { level, text, category } = message;
        const logCategory = LogCategory.VIEW;

        switch (level) {
            case 'error':
                logger.error(text, logCategory, message.error);
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
    };

    private handleOpenExternalLink = async (message: any): Promise<void> => {
        if (!message?.url) {return;}
        let url: string = message.url;
        // If relative URL, prepend server URL
        if (url.startsWith('/')) {
            const config = vscode.workspace.getConfiguration('artemis');
            const serverUrl = config.get<string>('serverUrl') || 'https://artemis.tum.de';
            url = serverUrl + url;
        }
        // Only allow http/https schemes
        if (!url.startsWith('http://') && !url.startsWith('https://')) {return;}
        await vscode.env.openExternal(vscode.Uri.parse(url));
    };

    private handleDownloadFile = async (message: any): Promise<void> => {
        if (!message?.url) {return;}
        let url: string = message.url;
        if (url.startsWith('/')) {
            const config = vscode.workspace.getConfiguration('artemis');
            const serverUrl = config.get<string>('serverUrl') || 'https://artemis.tum.de';
            url = serverUrl + url;
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {return;}
        await vscode.env.openExternal(vscode.Uri.parse(url));
    };
}
