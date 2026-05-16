import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

import { LogCategory, logger } from '../services/loggingService';
import { getWorkspaceRepositoryUrl, normalizeRepositoryUrl } from '../services/workspace';
import type { TheiaEnvironment } from './types';

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Strips embedded credentials from any https URL appearing in a string.
 * execFile errors typically include the full failed command (with auth URL),
 * so we sanitize before bubbling the error up to logs or notifications.
 */
function redactUrlCredentials(text: string): string {
    return text
        .replace(/(\bhttps?:\/\/)[^/\s@]+:[^/\s@]+@/gi, '$1***:***@')
        .replace(/(\bhttps?:\/\/)[^/\s@]+@/gi, '$1***@');
}

/**
 * Clones a git repository programmatically (without terminal).
 * Used in Theia where the Terminal API may behave differently.
 */
export async function cloneRepositoryProgrammatic(
    cloneUrl: string,
    targetPath: string,
    exerciseTitle: string,
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Cloning ${exerciseTitle}...`,
            cancellable: false,
        },
        async () => {
            try {
                await execFileAsync('git', ['clone', cloneUrl, targetPath], {
                    timeout: CLONE_TIMEOUT_MS,
                });
            } catch (error: unknown) {
                const original = error instanceof Error ? error.message : String(error);
                throw new Error(redactUrlCredentials(original));
            }
        },
    );
}

/**
 * Configures git identity from Theia environment variables.
 * Called after auto-clone to ensure commits have the correct author.
 */
async function configureGitIdentityFromEnv(
    theiaEnv: TheiaEnvironment,
    cwd: string,
): Promise<void> {
    if (theiaEnv.gitUser) {
        await execFileAsync('git', ['config', 'user.name', theiaEnv.gitUser], { cwd });
    }
    if (theiaEnv.gitMail) {
        await execFileAsync('git', ['config', 'user.email', theiaEnv.gitMail], { cwd });
    }
}

/**
 * Auto-clones the exercise repository in Theia if GIT_URI is set and
 * the workspace does not already contain a matching repository.
 */
export async function autoCloneIfNeeded(
    theiaEnv: TheiaEnvironment,
): Promise<void> {
    if (!theiaEnv.gitUri) { return; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
        logger.warn('No workspace folder available for auto-clone', LogCategory.GENERAL);
        return;
    }

    // Check if workspace already contains the target repository
    const existingUrl = await getWorkspaceRepositoryUrl();
    if (existingUrl) {
        const normalizedExisting = normalizeRepositoryUrl(existingUrl);
        const normalizedTarget = normalizeRepositoryUrl(theiaEnv.gitUri);
        if (normalizedExisting === normalizedTarget) {
            logger.info('Workspace already contains the target repository, skipping auto-clone', LogCategory.GENERAL);
            return;
        }
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const repoName = path.basename(theiaEnv.gitUri).replace(/\.git$/, '') || 'exercise';
    const targetPath = path.join(workspaceRoot, repoName);

    logger.info(`Auto-cloning ${theiaEnv.gitUri} into ${targetPath}`, LogCategory.GENERAL);

    try {
        await cloneRepositoryProgrammatic(theiaEnv.gitUri, targetPath, repoName);
        await configureGitIdentityFromEnv(theiaEnv, targetPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Auto-clone failed: ${message}`, LogCategory.GENERAL, error);
        const retry = await vscode.window.showErrorMessage(
            `Failed to clone exercise repository: ${message}`,
            'Retry',
        );
        if (retry === 'Retry') {
            await cloneRepositoryProgrammatic(theiaEnv.gitUri, targetPath, repoName);
            await configureGitIdentityFromEnv(theiaEnv, targetPath);
        }
    }
}
