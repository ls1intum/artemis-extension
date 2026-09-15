import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { extractRedactedErrorMessage } from '@extension/utils';

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
            try {
                await execFileAsync('git', ['clone', cloneUrl, targetPath], {
                    timeout: CLONE_TIMEOUT_MS,
                });
            } catch (error: unknown) {
                throw new Error(extractRedactedErrorMessage(error));
            }
        },
    );
}
