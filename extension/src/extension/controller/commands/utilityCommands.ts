import * as vscode from 'vscode';
import * as crypto from 'crypto';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getOptionalPayload, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { ProblemStatementRenderService } from '@extension/services/problemStatementRenderService';
import { executeReplayCommand } from '@extension/services/telemetry/replay';
import { CONFIG, extractErrorMessage, VSCODE_CONFIG } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

/**
 * Open VS Code settings filtered by the given setting ID.
 */
export async function openSettings(settingId: string): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
}

/**
 * Open a file in the workspace by path, falling back to a filename search.
 */
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
            [WebviewCmd.OpenWebsite]: this.handleOpenWebsite,
            [WebviewCmd.OpenBugReport]: this.handleOpenBugReport,
            [WebviewCmd.OpenInEditor]: this.handleOpenInEditor,
            [WebviewCmd.CopyToClipboard]: this.handleCopyToClipboard,
            [WebviewCmd.SearchMarketplace]: this.handleSearchMarketplace,
            [WebviewCmd.OpenExternalLink]: this.handleOpenExternalLink,
            [WebviewCmd.OpenImagePreview]: this.handleOpenImagePreview,
            [WebviewCmd.OpenFile]: this.handleOpenFile,
            [WebviewCmd.FreshSsrPreview]: this.handleFreshSsrPreview,
            [WebviewCmd.OpenRecordingsFolder]: this.handleOpenRecordingsFolder,
            [WebviewCmd.ReplaySession]: this.handleReplaySession,
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

    private handleOpenWebsite = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
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

    private handleOpenRecordingsFolder = async (_message: WebviewToExtensionMessage): Promise<void> => {
        const recordingsUri = vscode.Uri.joinPath(this.context.extensionContext.globalStorageUri, 'recordings');
        await vscode.commands.executeCommand('revealFileInOS', recordingsUri);
    };

    private handleReplaySession = async (_message: WebviewToExtensionMessage): Promise<void> => {
        await executeReplayCommand(this.context.extensionContext.globalStorageUri);
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
            const participation = exercise.studentParticipations?.[0];
            const rendered = await renderService.render(exercise, { participation, darkModeOverride: darkMode });
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
