import * as vscode from 'vscode';
import type { CommandContext, CommandMap } from './types';

export class UtilityCommandModule {
    constructor(private readonly context: CommandContext) {}

    public getHandlers(): CommandMap {
        return {
            alert: this.handleAlert,
            openSettings: this.handleOpenSettings,
            openWebsite: this.handleOpenWebsite,
            openInEditor: this.handleOpenInEditor,
            copyToClipboard: this.handleCopyToClipboard,
            searchMarketplace: this.handleSearchMarketplace,
            showSubmissionDetails: this.handleShowSubmissionDetails,
            fetchTestResults: this.handleFetchTestResults,
            openExerciseInBrowser: this.handleOpenExerciseInBrowser,
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
            console.error('Show submission details error:', error);
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

            console.log('Result details received:', JSON.stringify(resultDetails, null, 2));

            let feedbacks: any[] = [];

            if (Array.isArray(resultDetails)) {
                feedbacks = resultDetails;
            } else if (resultDetails && resultDetails.feedbacks) {
                feedbacks = resultDetails.feedbacks;
            }

            console.log('Feedbacks array:', feedbacks.length, 'items');

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

                console.log('Mapped test cases:', testCases.length, 'items');

                this.context.sendMessage({
                    command: 'testResultsData',
                    testCases: testCases
                });
            } else {
                console.log('No feedbacks found in result details');
                this.context.sendMessage({
                    command: 'testResultsData',
                    testCases: []
                });
            }
        } catch (error) {
            console.error('Fetch test results error:', error);
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
            console.error('Open exercise in browser error:', error);
            vscode.window.showErrorMessage(`Failed to open exercise in browser: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };
}
