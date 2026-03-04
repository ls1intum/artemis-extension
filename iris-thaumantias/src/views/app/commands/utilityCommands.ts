import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { CommandContext, CommandMap } from './types';
import { getPayload, WebviewCmd } from '../../../shared/messageContracts';
import type {
    WebviewToExtensionMessage,
    WebCmd,
} from '../../../shared/messageContracts';
import { normalizeRelativePath, extractErrorMessage, CONFIG, VSCODE_CONFIG } from '../../../utils';
import { logger, LogCategory } from '../../../services/loggingService';

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
            [WebviewCmd.GoToSourceError]: this.handleGoToSourceError,
            [WebviewCmd.OpenExternalLink]: this.handleOpenExternalLink,
            [WebviewCmd.OpenImagePreview]: this.handleOpenImagePreview,
        };
    }

    private handleOpenSettings = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const settingId = (message as WebCmd<'openSettings'>).payload?.setting ?? 'Artemis';
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
