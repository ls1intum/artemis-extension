import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { checkWorkspaceFiles } from '@extension/services/workspace/workspaceFileChecker';

/**
 * Reads the workspace's uncommitted changes for attachment to a chat send.
 * The single implementation every send path shares; do not copy it into a
 * caller.
 */
export async function collectUncommittedFiles(
    postMessage: (message: ExtensionToWebviewMessage) => void,
): Promise<Map<string, string> | undefined> {
    let uncommittedFiles: Map<string, string> | undefined;

    const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);

    if (!sendUncommittedChanges) {
        logger.irisChat('📁 Uncommitted changes sending is disabled by user setting');
        return undefined;
    }

    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        const result = await checkWorkspaceFiles(workspaceFolder, {
            includeContent: true,
            applyFilters: true,
            includeStatus: true,
            checkUnpushed: true,
            includeDirty: true
        });

        uncommittedFiles = new Map();
        result.files
            .filter(f => f.status === 'included' && f.content !== undefined)
            .forEach(f => uncommittedFiles!.set(f.path, f.content!));

        if (uncommittedFiles.size > 0) {
            logger.irisChat(`📁 Sending ${uncommittedFiles.size} uncommitted file(s) to Iris`);

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
        // Not critical: the send continues without uncommitted files.
        return undefined;
    }
}
