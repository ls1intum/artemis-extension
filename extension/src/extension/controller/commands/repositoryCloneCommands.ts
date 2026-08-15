import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getOptionalPayload, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import {
    getWorkspaceRepositoryUrl as defaultGetWorkspaceRepositoryUrl,
    GitService,
    normalizeRepositoryUrl as defaultNormalizeRepositoryUrl,
} from '@extension/services/workspace';
import {
    cloneRepositoryProgrammatic as defaultCloneRepositoryProgrammatic,
    getTheiaEnvironment as defaultGetTheiaEnvironment,
} from '@extension/theia';
import { extractErrorMessage, VSCODE_CONFIG } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

/**
 * Soft cap on the in-memory map of recently cloned repositories per
 * participation. Bounded to keep the map from growing unboundedly during a
 * long session; FIFO eviction is acceptable because the map is only used to
 * surface "open cloned repo" notices.
 */
const MAX_CLONED_REPO_CACHE_SIZE = 10;

/**
 * Helper functions injected via the constructor so tests can substitute
 * deterministic doubles. The defaults wire up to the production modules.
 *
 * The seam is required: the production helpers are re-exported through the
 * `@extension/services/workspace` and `@extension/theia` barrels, whose
 * TS-emitted descriptors are non-configurable getters. Namespace stubbing
 * fails there with "descriptor is not configurable", so the callables are
 * injected instead.
 */
export interface RepositoryCloneCommandsDeps {
    getWorkspaceRepositoryUrl: typeof defaultGetWorkspaceRepositoryUrl;
    normalizeRepositoryUrl: typeof defaultNormalizeRepositoryUrl;
    cloneRepositoryProgrammatic: typeof defaultCloneRepositoryProgrammatic;
    getTheiaEnvironment: typeof defaultGetTheiaEnvironment;
    statSync: typeof fs.statSync;
    statAsync: (p: fs.PathLike) => Promise<fs.Stats>;
}

const defaultDeps: RepositoryCloneCommandsDeps = {
    getWorkspaceRepositoryUrl: defaultGetWorkspaceRepositoryUrl,
    normalizeRepositoryUrl: defaultNormalizeRepositoryUrl,
    cloneRepositoryProgrammatic: defaultCloneRepositoryProgrammatic,
    getTheiaEnvironment: defaultGetTheiaEnvironment,
    statSync: fs.statSync,
    statAsync: fs.promises.stat,
};

export class RepositoryCloneCommands {
    private clonedRepositoriesByParticipationId: Map<number, { path: string; title: string }> = new Map();
    private readonly deps: RepositoryCloneCommandsDeps;

    constructor(
        private readonly context: CommandContext,
        private readonly gitService: GitService = new GitService(),
        deps: Partial<RepositoryCloneCommandsDeps> = {},
    ) {
        this.deps = { ...defaultDeps, ...deps };
    }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.CloneRepository]: this.handleCloneRepository,
            [WebviewCmd.CopyAuthenticatedCloneUrl]: this.handleCopyAuthenticatedCloneUrl,
            [WebviewCmd.OpenRepository]: this.handleOpenRepository,
            [WebviewCmd.OpenClonedRepository]: this.handleOpenClonedRepository,
        };
    }

    /**
     * Build an authenticated clone URL by fetching a VCS token and the current user's login.
     * Returns the URL string on success, or null if token retrieval or URL construction fails.
     */
    private async buildAuthenticatedUrl(participationId: number, repositoryUri: string): Promise<string | null> {
        let vcsToken: string;
        try {
            vcsToken = await this.context.artemisApi.getOrCreateVcsAccessToken(participationId);
        } catch (tokenErr) {
            logger.error('Failed to get participation token:', LogCategory.SUBMISSION, tokenErr);
            vscode.window.showErrorMessage('Failed to obtain VCS access token.');
            return null;
        }

        let username = 'user';
        try {
            const currentUser = await this.context.artemisApi.getCurrentUser();
            if (currentUser?.login) {
                username = currentUser.login;
            }
        } catch (userErr) {
            logger.warn('Could not fetch current user, defaulting username:', LogCategory.SUBMISSION, userErr);
        }

        try {
            const url = new URL(repositoryUri);
            url.username = username;
            url.password = vcsToken;
            return url.toString();
        } catch {
            vscode.window.showErrorMessage('Invalid repository URL received from server.');
            return null;
        }
    }

    private async _selectFolder(openLabel: string, title: string): Promise<string | undefined> {
        // In Theia, always use the workspace root instead of showing a dialog
        if (this.deps.getTheiaEnvironment().isTheia) {
            return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        }

        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel,
            title,
        });
        return folderUri?.[0]?.fsPath;
    }

    /**
     * Resolve the destination folder for a clone in one of three ways:
     *   1. The configured default-clone-path, if it points to an existing dir.
     *   2. The full "set default / choose / don't ask again" modal (when the
     *      prompt is enabled and no default is configured).
     *   3. A bare folder picker when the prompt has been silenced.
     *
     * Returns `undefined` when the user cancels at any branch; an information
     * notice is shown with the cancellation reason as a side effect.
     */
    private async _resolveCloneDestination(exerciseTitle: string): Promise<string | undefined> {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const defaultClonePath = config.get<string>(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, '').trim();
        const showPrompt = config.get<boolean>(VSCODE_CONFIG.SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY, true);

        if (defaultClonePath) {
            const reasonInvalid = await this._validateDefaultClonePath(defaultClonePath);
            if (!reasonInvalid) {
                return defaultClonePath;
            }
            vscode.window.showWarningMessage(`Default clone path "${defaultClonePath}" ${reasonInvalid}. Please select a folder.`);
            return this._pickFolderOrCancelClone('Select Clone Destination', `Choose where to clone ${exerciseTitle}`);
        }

        if (!showPrompt) {
            return this._pickFolderOrCancelClone('Select Clone Destination', `Choose where to clone ${exerciseTitle}`);
        }

        const choice = await vscode.window.showInformationMessage(
            'Where should exercise repositories be cloned?\n\nYou can set a default folder now (e.g., ~/artemis-exercises) so all future exercises are automatically saved there, or choose a location each time.',
            { modal: true },
            'Set Default Folder',
            'Choose Each Time',
            "Don't Ask Again",
        );

        if (choice === 'Set Default Folder') {
            const defaultFolderPath = await this._selectFolder('Set as Default', 'Select default folder for all exercise repositories');
            if (!defaultFolderPath) {
                vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
                return undefined;
            }
            await config.update(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, defaultFolderPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`✓ All exercises will now be cloned to: ${defaultFolderPath}`);
            return defaultFolderPath;
        }
        if (choice === "Don't Ask Again") {
            await config.update(VSCODE_CONFIG.SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY, false, vscode.ConfigurationTarget.Global);
            return this._pickFolderOrCancelClone('Select Folder', `Where should "${exerciseTitle}" be cloned?`);
        }
        if (choice === 'Choose Each Time') {
            return this._pickFolderOrCancelClone('Select Folder', `Where should "${exerciseTitle}" be cloned?`);
        }

        // ESC or a dismissed modal aborts.
        vscode.window.showInformationMessage('Clone cancelled.');
        return undefined;
    }

    /**
     * Returns `undefined` if the configured default-clone-path is usable; a
     * short reason string ('does not exist' / 'is not a directory') otherwise.
     */
    private async _validateDefaultClonePath(p: string): Promise<string | undefined> {
        try {
            const stats = await this.deps.statAsync(p);
            return stats.isDirectory() ? undefined : 'is not a directory';
        } catch {
            return 'does not exist';
        }
    }

    /** Folder picker + the standard "Clone cancelled" notice on dismissal. */
    private async _pickFolderOrCancelClone(label: string, title: string): Promise<string | undefined> {
        const folderPath = await this._selectFolder(label, title);
        if (!folderPath) {
            vscode.window.showInformationMessage('Clone cancelled - no folder selected.');
            return undefined;
        }
        return folderPath;
    }

    /**
     * Insert a freshly cloned repository into the per-participation cache,
     * evicting the oldest entry by insertion order when the cap is reached.
     */
    private _rememberClonedRepo(participationId: number, repoPath: string, title: string): void {
        if (this.clonedRepositoriesByParticipationId.size >= MAX_CLONED_REPO_CACHE_SIZE
            && !this.clonedRepositoriesByParticipationId.has(participationId)) {
            const firstKey = this.clonedRepositoriesByParticipationId.keys().next().value;
            if (firstKey !== undefined) {
                this.clonedRepositoriesByParticipationId.delete(firstKey);
            }
        }
        this.clonedRepositoriesByParticipationId.set(participationId, { path: repoPath, title });
    }

    private handleCloneRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'cloneRepository'>>(message);
            const { participationId, repositoryUri, exerciseTitle } = payload;
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot clone: missing participation or repository URL.');
                return;
            }

            if (!(await this.gitService.isGitAvailable())) {
                vscode.window.showErrorMessage('Git not found in PATH. Please install Git to clone repositories.');
                return;
            }

            const selectedPath = await this._resolveCloneDestination(exerciseTitle);
            if (!selectedPath) { return; }

            const cloneUrl = await this.buildAuthenticatedUrl(participationId, repositoryUri);
            if (!cloneUrl) { return; }

            const repoName = path.basename(repositoryUri).replace(/\.git$/, '');
            const repoPath = path.join(selectedPath, repoName);

            // Run git clone as an awaitable child process (same for Theia and
            // VS Code Desktop). A terminal-based fire-and-forget clone cannot
            // signal success or failure back, so the "Open Folder" prompt would
            // appear even on a failed clone. Here a thrown error lands in the
            // outer catch and the prompt is reached only on success.
            await this.deps.cloneRepositoryProgrammatic(cloneUrl, repoPath, exerciseTitle);

            this._rememberClonedRepo(participationId, repoPath, exerciseTitle);

            this.context.sendMessage({
                type: ExtensionMsg.ShowClonedRepoNotice,
                exerciseTitle: exerciseTitle,
                participationId,
            });

            const openAction = await vscode.window.showInformationMessage(
                `Open cloned repository "${exerciseTitle}"?`,
                'Open Folder',
                'Skip',
            );
            if (openAction === 'Open Folder') {
                void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repoPath), true);
            }
        } catch (error: unknown) {
            logger.error('Clone repository error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(`Failed to clone repository: ${extractErrorMessage(error)}`);
        }
    };

    private handleCopyAuthenticatedCloneUrl = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { participationId, repositoryUri } = getPayload<WebCmd<'copyAuthenticatedCloneUrl'>>(message);
            if (!participationId || !repositoryUri) {
                vscode.window.showErrorMessage('Cannot copy clone URL: missing participation or repository URL.');
                return;
            }

            const authenticatedUrl = await this.buildAuthenticatedUrl(participationId, repositoryUri);
            if (!authenticatedUrl) {
                return;
            }

            await vscode.env.clipboard.writeText(authenticatedUrl);
            vscode.window.showInformationMessage(
                'Authenticated clone URL copied to clipboard. It contains a VCS access token, so do not share it.'
            );
        } catch (error: unknown) {
            logger.error('Failed to copy authenticated clone URL:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(`Failed to copy clone URL: ${extractErrorMessage(error)}`);
        }
    };

    private handleOpenClonedRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { participationId } = getPayload<WebCmd<'openClonedRepository'>>(message);
            const repoInfo = this.clonedRepositoriesByParticipationId.get(participationId);

            if (!repoInfo) {
                vscode.window.showWarningMessage('Cloned repository not found. It may have been moved or deleted.');
                return;
            }

            try {
                const stats = this.deps.statSync(repoInfo.path);
                if (!stats.isDirectory()) {
                    this.clonedRepositoriesByParticipationId.delete(participationId);
                    vscode.window.showWarningMessage('Cloned repository path is not a directory.');
                    return;
                }
            } catch {
                this.clonedRepositoriesByParticipationId.delete(participationId);
                vscode.window.showWarningMessage('Cloned repository not found. It may have been moved or deleted.');
                return;
            }

            const repoUri = vscode.Uri.file(repoInfo.path);

            const currentFolder = vscode.workspace.workspaceFolders?.[0];
            if (currentFolder && currentFolder.uri.fsPath === repoInfo.path) {
                await vscode.commands.executeCommand('workbench.view.explorer');
                return;
            }

            await vscode.commands.executeCommand('vscode.openFolder', repoUri, true);
        } catch (error: unknown) {
            logger.error('Open cloned repository error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Failed to open cloned repository.');
        }
    };

    private handleOpenRepository = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const repositoryUri = getOptionalPayload<WebCmd<'openRepository'>>(message)?.repositoryUri;

            if (!repositoryUri) {
                vscode.window.showWarningMessage('No repository URL available.');
                return;
            }
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const wsUrl = await this.deps.getWorkspaceRepositoryUrl(workspaceFolder);
                if (wsUrl && this.deps.normalizeRepositoryUrl(wsUrl) === this.deps.normalizeRepositoryUrl(repositoryUri)) {
                    await vscode.commands.executeCommand('workbench.view.explorer');
                    return;
                }
            }

            await vscode.env.openExternal(vscode.Uri.parse(repositoryUri));
        } catch (error: unknown) {
            logger.error('Open repository error:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Failed to open repository.');
        }
    };
}
