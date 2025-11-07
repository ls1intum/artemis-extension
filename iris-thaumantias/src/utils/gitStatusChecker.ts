import * as vscode from 'vscode';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

export interface GitStatusResult {
    hasChanges: boolean;
    changedFiles: string[];
}

/**
 * Lightweight check for repository changes using git status --porcelain
 * This is the same method used by the exercise details page
 * 
 * @param workspaceFolder The workspace folder to check
 * @returns Object with hasChanges flag and list of changed files
 */
export async function checkGitStatus(workspaceFolder?: vscode.WorkspaceFolder): Promise<GitStatusResult> {
    const folder = workspaceFolder || vscode.workspace.workspaceFolders?.[0];
    
    if (!folder) {
        return { hasChanges: false, changedFiles: [] };
    }

    try {
        const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
            cwd: folder.uri.fsPath,
            timeout: 5000 // 5 second timeout
        });

        console.log('[Git Status] Raw output:', JSON.stringify(stdout));

        // Don't trim the output - git status format is fixed-width!
        if (stdout.trim().length === 0) {
            return { hasChanges: false, changedFiles: [] };
        }

        // Parse the output to get file paths
        const changedFiles = stdout
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => {
                // Git status --porcelain format (BEFORE trim):
                // XY filename
                // Where X = index status, Y = worktree status (each 1 char), then a space
                // Examples: " M file.txt", "M  file.txt", "MM file.txt", "A  file.txt"
                // We need to skip: XY (2 chars) + space (1 char) = 3 chars total
                console.log('[Git Status] Parsing line:', JSON.stringify(line));
                if (line.length <= 3) {
                    return '';
                }
                const fileName = line.slice(3).trim();
                console.log('[Git Status] Extracted filename:', fileName);
                return fileName;
            })
            .filter(file => file.length > 0);

        console.log('[Git Status] Final file list:', changedFiles);

        return {
            hasChanges: true,
            changedFiles
        };
    } catch (error) {
        // Git command failed or not a git repository
        return { hasChanges: false, changedFiles: [] };
    }
}
