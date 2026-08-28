import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getOptionalPayload, getPayload, WebviewCmd } from '@shared/messageContracts';
import { selectParticipation } from '@shared/utils/participationSelection';

import { LogCategory, logger } from '@extension/services/loggingService';
import { ProblemStatementRenderService } from '@extension/services/problemStatementRenderService';
import { extractErrorMessage, resolveServerUrl } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

export async function openSettings(settingId: string): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
}

/** Falls back to a workspace-wide filename search when the path does not resolve. */
export async function openFileInWorkspace(filePath: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
    }

    try {
        const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    } catch {
        try {
            const fileName = filePath.split('/').pop();
            const files = await vscode.workspace.findFiles(`**/${fileName}`);
            if (files.length > 0) {
                const doc = await vscode.workspace.openTextDocument(files[0]);
                await vscode.window.showTextDocument(doc);
            } else {
                vscode.window.showWarningMessage(`Could not find file: ${filePath}`);
            }
        } catch {
            vscode.window.showWarningMessage(`Could not open file: ${filePath}`);
        }
    }
}

export class UtilityCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.OpenSettings]: this.handleOpenSettings,
            [WebviewCmd.ReloadWindow]: this.handleReloadWindow,
            [WebviewCmd.OpenWebsite]: this.handleOpenWebsite,
            [WebviewCmd.OpenBugReport]: this.handleOpenBugReport,
            [WebviewCmd.OpenInEditor]: this.handleOpenInEditor,
            [WebviewCmd.CopyToClipboard]: this.handleCopyToClipboard,
            [WebviewCmd.SearchMarketplace]: this.handleSearchMarketplace,
            [WebviewCmd.OpenFile]: this.handleOpenFile,
            [WebviewCmd.FreshSsrPreview]: this.handleFreshSsrPreview,
        };
    }

    private handleOpenSettings = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const settingId = getPayload<WebCmd<'openSettings'>>(message).setting ?? 'Artemis';
            await openSettings(settingId);
        } catch (error: unknown) {
            logger.error('Failed to open settings:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to open settings: ${extractErrorMessage(error)}`);
        }
    };

    /**
     * Offered as the way out when the sign-in worked but the host could not put
     * the authenticated UI on screen. A reload rebuilds that host state from the
     * credential, which is still valid.
     *
     * The command is wrapped because this also ships to Theia/EduIDE, where
     * `workbench.action.reloadWindow` may not exist. A button that silently
     * does nothing is worse than a sentence telling the user to reload
     * themselves.
     */
    private handleReloadWindow = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        } catch (error: unknown) {
            logger.error('Reload window command failed', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(
                'Could not reload automatically. Please reload the window to finish signing in.',
            );
        }
    };

    private handleOpenWebsite = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            // Resolve via the single source of truth so EduIDE/Theia (data-bridge
            // ARTEMIS_URL) opens the connected server, not the config default.
            const serverUrl = resolveServerUrl();
            const payload = getOptionalPayload<WebCmd<'openWebsite'>>(message);
            const urlPath = payload?.path || '/courses';
            await vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}${urlPath}`));
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
            // Support opening raw strings (e.g., SSR HTML) with a language hint
            if (typeof payload.data === 'string') {
                const language = ('language' in payload && typeof payload.language === 'string') ? payload.language : 'plaintext';
                const document = await vscode.workspace.openTextDocument({ content: payload.data, language });
                await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
            } else {
                await this.context.actionHandler.openJsonInEditor(payload.data);
            }
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

    private handleOpenFile = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { filePath } = getPayload<WebCmd<'openFile'>>(message);
            if (typeof filePath === 'string') {
                await openFileInWorkspace(filePath);
            }
        } catch (error: unknown) {
            logger.error('Failed to open file:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Failed to open file: ${extractErrorMessage(error)}`);
        }
    };

    private handleFreshSsrPreview = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { darkMode } = getPayload<WebCmd<'freshSsrPreview'>>(message);
        const exerciseData = this.context.appStateManager.currentExerciseData;
        if (!exerciseData?.exercise) { return; }

        const renderService = new ProblemStatementRenderService(this.context.artemisApi);
        try {
            const exercise = exerciseData.exercise;
            // The same selection the real render uses, so the preview shows what a student would see.
            const participation = selectParticipation(
                exercise.studentParticipations,
                this.context.appStateManager.workspaceIsPractice,
            );
            const buildPending = participation?.id !== undefined
                && exerciseData.pendingSubmissionsByParticipationId?.[participation.id] !== undefined;
            const rendered = await renderService.render(exercise, { participation, buildPending, darkModeOverride: darkMode });
            if (!rendered) { return; }

            const label = darkMode ? 'Dark' : 'Light';
            const bg = darkMode ? '#1e1e1e' : '#fff';
            const color = darkMode ? '#e0e0e0' : '#212529';
            const panel = vscode.window.createWebviewPanel(
                'ssrPreview',
                `SSR Preview (${label})`,
                vscode.ViewColumn.One,
                { enableScripts: false },
            );
            panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="padding:20px;background:${bg};color:${color};">${rendered.html}</body></html>`;
        } catch (error: unknown) {
            logger.error('Failed to fetch fresh SSR preview:', LogCategory.VIEW, error);
        } finally {
            renderService.dispose();
        }
    };
}
