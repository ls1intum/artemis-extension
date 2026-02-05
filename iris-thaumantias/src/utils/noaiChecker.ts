import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Checks if a .noai file exists in the workspace root.
 * This file is used to disable Iris AI assistance for specific projects.
 * @param workspaceFolder Optional workspace folder, defaults to first workspace folder
 * @returns True if .noai file exists, false otherwise
 */
export async function hasNoAiFile(workspaceFolder?: vscode.WorkspaceFolder): Promise<boolean> {
    const folder = workspaceFolder || vscode.workspace.workspaceFolders?.[0];
    
    if (!folder) {
        return false;
    }

    try {
        const noaiPath = path.join(folder.uri.fsPath, '.noai');
        await fs.access(noaiPath);
        return true;
    } catch (error) {
        // File doesn't exist or can't be accessed
        return false;
    }
}

/**
 * Creates a file watcher for the .noai file to detect when it's added or removed.
 * @param workspaceFolder Optional workspace folder
 * @param callback Function to call when .noai file is added or removed
 * @returns Disposable to stop watching
 */
export function watchNoAiFile(
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    callback: (exists: boolean) => void
): vscode.Disposable {
    const folder = workspaceFolder || vscode.workspace.workspaceFolders?.[0];
    
    if (!folder) {
        return { dispose: () => {} };
    }

    const noaiPattern = new vscode.RelativePattern(folder, '.noai');
    const watcher = vscode.workspace.createFileSystemWatcher(noaiPattern);

    const checkAndCallback = async () => {
        const exists = await hasNoAiFile(folder);
        callback(exists);
    };

    watcher.onDidCreate(() => checkAndCallback());
    watcher.onDidDelete(() => checkAndCallback());

    return watcher;
}
