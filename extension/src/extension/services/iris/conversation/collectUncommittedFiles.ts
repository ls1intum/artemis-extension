import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { checkWorkspaceFiles } from '@extension/services/workspace/workspaceFileChecker';

/**
 * Reads the workspace's uncommitted changes for attachment to a chat send.
 * Extracted out of `ChatMessageService` so it and `SendCoordinator` share ONE
 * implementation rather than a copy that drifts.
 */
export async function collectUncommittedFiles(
    postMessage: (message: ExtensionToWebviewMessage) => void,
): Promise<Map<string, string> | undefined> {
    let uncommittedFiles: Map<string, string> | undefined;

    // Check if the user has enabled sending uncommitted changes
    const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);

    if (!sendUncommittedChanges) {
        logger.irisChat('📁 Uncommitted changes sending is disabled by user setting');
        return undefined;
    }

    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        // Use unified checker with full options (content + filters + status)
        const result = await checkWorkspaceFiles(workspaceFolder, {
            includeContent: true,
            applyFilters: true,
            includeStatus: true,
            checkUnpushed: true,
            includeDirty: true
        });

        // Convert to Map for backward compatibility
        uncommittedFiles = new Map();
        result.files
            .filter(f => f.status === 'included' && f.content !== undefined)
            .forEach(f => uncommittedFiles!.set(f.path, f.content!));

        if (uncommittedFiles.size > 0) {
            logger.irisChat(`📁 Sending ${uncommittedFiles.size} uncommitted file(s) to Iris`);

            // Update display with detailed analysis
            const excludedFiles = result.files
                .filter(f => f.status === 'excluded')
                .map(f => ({ path: f.path, reason: f.reason || 'Excluded' }));

            postMessage({
                type: ExtensionMsg.UpdateReferencedFiles,
                includedFiles: Array.from(uncommittedFiles.keys()),
                excludedFiles: excludedFiles,
                totalCount: result.totalCount
            });
        }

        return uncommittedFiles;
    } catch (error: unknown) {
        logger.error('Error collecting uncommitted files', LogCategory.IRIS_CHAT, error);
        // Continue without uncommitted files - this is not a critical error
        return undefined;
    }
}
