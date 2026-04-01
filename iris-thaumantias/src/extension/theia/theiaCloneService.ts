import * as vscode from 'vscode';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { logger, LogCategory } from '../services/loggingService';
import type { TheiaEnvironment } from './types';
import { getWorkspaceRepositoryUrl, normalizeRepositoryUrl } from '../services/workspace';

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 120_000; // 2 minutes

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
            await execFileAsync('git', ['clone', cloneUrl, targetPath], {
                timeout: CLONE_TIMEOUT_MS,
            });
        },
    );
}

/**
 * Configures git identity from Theia environment variables.
 * Called after auto-clone to ensure commits have the correct author.
 */
export async function configureGitIdentityFromEnv(
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
    const repoName = theiaEnv.gitUri.split('/').pop()?.replace('.git', '') || 'exercise';
    const targetPath = `${workspaceRoot}/${repoName}`;

    logger.info(`Auto-cloning ${theiaEnv.gitUri} into ${targetPath}`, LogCategory.GENERAL);
    await cloneRepositoryProgrammatic(theiaEnv.gitUri, targetPath, repoName);

    // Configure git identity if provided
    await configureGitIdentityFromEnv(theiaEnv, targetPath);
}
