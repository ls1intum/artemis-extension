import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { extractErrorMessage } from '@extension/utils';

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
                const original = extractErrorMessage(error);
                throw new Error(redactUrlCredentials(original));
            }
        },
    );
}
