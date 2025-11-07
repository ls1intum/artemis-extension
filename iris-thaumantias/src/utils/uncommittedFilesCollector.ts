import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Maximum file size in bytes (1 MB) to prevent sending overly large files
 */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

export { MAX_FILE_SIZE }; // Export for use in other modules

/**
 * File extensions to exclude from uncommitted files
 */
const EXCLUDED_EXTENSIONS = new Set([
    '.class', '.jar', '.war', '.ear', // Java binaries
    '.exe', '.dll', '.so', '.dylib', // Native binaries
    '.zip', '.tar', '.gz', '.rar', // Archives
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg', // Images
    '.mp4', '.avi', '.mov', '.wmv', // Videos
    '.mp3', '.wav', '.flac', // Audio
    '.pdf', '.doc', '.docx', // Documents
    '.lock', // Lock files
]);

/**
 * Directory patterns to exclude
 */
const EXCLUDED_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    'target',
    'build',
    'dist',
    'out',
    'bin',
    '.idea',
    '.vscode',
    '__pycache__',
    '.gradle',
    '.mvn',
]);

/**
 * Collects uncommitted files from the workspace
 * 
 * This function collects all files that have changes not yet pushed to the remote repository.
 * This includes:
 * - Unsaved changes (dirty files)
 * - Uncommitted changes (modified, staged, or unstaged files)
 * - Committed but unpushed changes (local commits not yet pushed to remote)
 * 
 * @param workspaceFolder Optional workspace folder to limit the search. If not provided, uses all workspace folders.
 * @returns A Map where keys are relative file paths (with forward slashes) and values are file contents
 */
export async function collectUncommittedFiles(workspaceFolder?: vscode.WorkspaceFolder): Promise<Map<string, string>> {
    const uncommittedFiles = new Map<string, string>();

    // Strategy 1: Collect all dirty (unsaved) documents
    await collectDirtyFiles(uncommittedFiles, workspaceFolder);

    // Strategy 2: Collect Git modified files (staged and unstaged)
    await collectGitModifiedFiles(uncommittedFiles, workspaceFolder);

    // Strategy 3: Collect committed but unpushed files
    await collectUnpushedFiles(uncommittedFiles, workspaceFolder);

    return uncommittedFiles;
}

export interface FileStatus {
    path: string;
    included: boolean; // Whether file will be sent to Iris
    reason?: string;   // Reason for exclusion (if excluded)
}

/**
 * Collects detailed information about all uncommittedfiles including which ones are excluded and why
 * 
 * @param workspaceFolder Optional workspace folder to limit the search
 * @returns Object with included files (content), excluded files (with reasons), and total count
 */
export async function collectUncommittedFilesWithStatus(
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<{
    includedFiles: Map<string, string>;
    excludedFiles: FileStatus[];
    allFiles: FileStatus[];
}> {
    const includedFiles = new Map<string, string>();
    const excludedFiles: FileStatus[] = [];
    const processedPaths = new Set<string>();

    async function processFile(uri: vscode.Uri, category: 'dirty' | 'git' | 'unpushed'): Promise<void> {
        const relativePath = getRelativePath(uri, workspaceFolder);
        if (!relativePath || processedPaths.has(relativePath)) {
            return;
        }
        processedPaths.add(relativePath);

        // Check for exclusions
        if (shouldExcludeFile(uri)) {
            const ext = path.extname(relativePath);
            if (EXCLUDED_EXTENSIONS.has(ext)) {
                excludedFiles.push({ path: relativePath, included: false, reason: `Binary/excluded extension (${ext})` });
            } else {
                const dirName = path.basename(path.dirname(uri.fsPath));
                excludedFiles.push({ path: relativePath, included: false, reason: `Excluded directory (${dirName})` });
            }
            return;
        }

        // Check if binary
        if (await isBinaryFile(uri)) {
            excludedFiles.push({ path: relativePath, included: false, reason: 'Binary file' });
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();

            // Check file size
            const size = Buffer.byteLength(content, 'utf8');
            if (size > MAX_FILE_SIZE) {
                const sizeMB = (size / (1024 * 1024)).toFixed(2);
                excludedFiles.push({ path: relativePath, included: false, reason: `Too large (${sizeMB} MB)` });
                return;
            }

            includedFiles.set(relativePath, content);
        } catch (error) {
            excludedFiles.push({ path: relativePath, included: false, reason: 'Cannot read file' });
        }
    }

    // Collect dirty files
    const dirtyDocuments = vscode.workspace.textDocuments.filter(doc => {
        if (!doc.isDirty || doc.uri.scheme !== 'file') {
            return false;
        }
        if (workspaceFolder && !doc.uri.fsPath.startsWith(workspaceFolder.uri.fsPath)) {
            return false;
        }
        return true;
    });

    for (const doc of dirtyDocuments) {
        await processFile(doc.uri, 'dirty');
    }

    // Collect Git modified files
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
        if (!gitExtension.isActive) {
            await gitExtension.activate();
        }
        const git = gitExtension.exports.getAPI(1);
        if (git) {
            const repositories = workspaceFolder
                ? git.repositories.filter((repo: any) => repo.rootUri.fsPath === workspaceFolder.uri.fsPath)
                : git.repositories;

            for (const repository of repositories) {
                const state = repository.state;
                const changedFiles = [
                    ...(state.workingTreeChanges || []),
                    ...(state.indexChanges || []),
                ];

                for (const change of changedFiles) {
                    if (change.uri && change.status !== 6) { // 6 = DELETED
                        await processFile(change.uri, 'git');
                    }
                }
            }

            // Collect unpushed files
            const { execSync } = await import('child_process');
            for (const repository of repositories) {
                try {
                    const head = repository.state.HEAD;
                    if (!head || !head.upstream || (head.ahead || 0) === 0) {
                        continue;
                    }

                    const upstream = `${head.upstream.remote}/${head.upstream.name}`;
                    const repoPath = repository.rootUri.fsPath;

                    const output = execSync(`git diff --name-only ${upstream}..HEAD`, {
                        cwd: repoPath,
                        encoding: 'utf8',
                        timeout: 10000,
                        stdio: ['pipe', 'pipe', 'pipe']
                    });

                    const changedFilesPaths = output.trim().split('\n').filter(Boolean);

                    for (const filePath of changedFilesPaths) {
                        const fullPath = path.join(repoPath, filePath);
                        const fileUri = vscode.Uri.file(fullPath);

                        try {
                            const stat = await vscode.workspace.fs.stat(fileUri);
                            if (stat.type === vscode.FileType.File) {
                                await processFile(fileUri, 'unpushed');
                            }
                        } catch {
                            // File might be deleted, skip
                        }
                    }
                } catch (error) {
                    // Error with unpushed files, skip this repository
                }
            }
        }
    }

    const allFiles: FileStatus[] = [
        ...Array.from(includedFiles.keys()).map(path => ({ path, included: true })),
        ...excludedFiles
    ];

    return { includedFiles, excludedFiles, allFiles };
}

/**
 * Collects dirty (unsaved) documents from the workspace
 */
async function collectDirtyFiles(
    uncommittedFiles: Map<string, string>,
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<void> {
    const dirtyDocuments = vscode.workspace.textDocuments.filter(doc => {
        if (!doc.isDirty || doc.uri.scheme !== 'file') {
            return false;
        }

        // If a specific workspace folder is provided, only include files from that folder
        if (workspaceFolder && !doc.uri.fsPath.startsWith(workspaceFolder.uri.fsPath)) {
            return false;
        }

        // Exclude files based on path and extension
        if (shouldExcludeFile(doc.uri)) {
            return false;
        }

        return true;
    });

    for (const doc of dirtyDocuments) {
        try {
            // Check if file is binary
            if (await isBinaryFile(doc.uri)) {
                console.log(`Skipping binary file: ${doc.uri.fsPath}`);
                continue;
            }

            const content = doc.getText();
            
            // Skip if file is too large
            if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
                console.warn(`Skipping file ${doc.uri.fsPath} - exceeds maximum size`);
                continue;
            }

            const relativePath = getRelativePath(doc.uri, workspaceFolder);
            if (relativePath) {
                uncommittedFiles.set(relativePath, content);
                console.log(`Added dirty file: ${relativePath}`);
            }
        } catch (error) {
            console.error(`Error reading dirty file ${doc.uri.fsPath}:`, error);
        }
    }
}

/**
 * Collects Git modified files (staged and unstaged changes)
 */
async function collectGitModifiedFiles(
    uncommittedFiles: Map<string, string>,
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<void> {
    // Get Git extension
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        console.log('Git extension not available');
        return;
    }

    if (!gitExtension.isActive) {
        await gitExtension.activate();
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git) {
        console.log('Git API not available');
        return;
    }

    // Get repositories
    const repositories = workspaceFolder
        ? git.repositories.filter((repo: any) => repo.rootUri.fsPath === workspaceFolder.uri.fsPath)
        : git.repositories;

    for (const repository of repositories) {
        try {
            const state = repository.state;
            
            // Collect both staged and unstaged changes
            const changedFiles = [
                ...(state.workingTreeChanges || []),
                ...(state.indexChanges || []),
            ];

            for (const change of changedFiles) {
                const fileUri = change.uri;
                
                // Skip deleted files
                if (!fileUri || change.status === 6) { // 6 = DELETED
                    continue;
                }

                // Skip already collected files
                const relativePath = getRelativePath(fileUri, workspaceFolder);
                if (!relativePath || uncommittedFiles.has(relativePath)) {
                    continue;
                }

                // Exclude files based on path and extension
                if (shouldExcludeFile(fileUri)) {
                    continue;
                }

                // Check if file is binary
                if (await isBinaryFile(fileUri)) {
                    console.log(`Skipping binary file: ${relativePath}`);
                    continue;
                }

                try {
                    // Read file content from disk
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const content = document.getText();

                    // Skip if file is too large
                    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
                        console.warn(`Skipping file ${fileUri.fsPath} - exceeds maximum size`);
                        continue;
                    }

                    uncommittedFiles.set(relativePath, content);
                    console.log(`Added Git modified file: ${relativePath}`);
                } catch (error) {
                    console.error(`Error reading Git modified file ${fileUri.fsPath}:`, error);
                }
            }
        } catch (error) {
            console.error('Error collecting Git modified files:', error);
        }
    }
}

/**
 * Collects files from commits that haven't been pushed yet
 * 
 * This gets all files that were changed in local commits that haven't been pushed to the remote.
 * We use child_process to run git commands directly since VSCode Git API has limitations.
 */
async function collectUnpushedFiles(
    uncommittedFiles: Map<string, string>,
    workspaceFolder?: vscode.WorkspaceFolder
): Promise<void> {
    // Get Git extension to check repository status
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        console.log('Git extension not available for unpushed files');
        return;
    }

    if (!gitExtension.isActive) {
        await gitExtension.activate();
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git) {
        console.log('Git API not available for unpushed files');
        return;
    }

    // Get repositories
    const repositories = workspaceFolder
        ? git.repositories.filter((repo: any) => repo.rootUri.fsPath === workspaceFolder.uri.fsPath)
        : git.repositories;

    // Import child_process at runtime
    const { execSync } = await import('child_process');

    for (const repository of repositories) {
        try {
            const head = repository.state.HEAD;
            if (!head || !head.upstream) {
                console.log('No upstream branch configured, skipping unpushed files');
                continue;
            }

            // Check if there are commits ahead
            const ahead = head.ahead || 0;
            if (ahead === 0) {
                console.log('No unpushed commits (ahead count is 0)');
                continue;
            }

            console.log(`Found ${ahead} unpushed commit(s), collecting changed files...`);
            
            // Get the upstream branch name
            const upstream = `${head.upstream.remote}/${head.upstream.name}`;
            const repoPath = repository.rootUri.fsPath;

            try {
                // Execute git diff to get list of changed files
                const gitCommand = `git diff --name-only ${upstream}..HEAD`;
                const output = execSync(gitCommand, {
                    cwd: repoPath,
                    encoding: 'utf8',
                    timeout: 10000, // 10 second timeout to prevent hanging
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                const changedFilesPaths = output.trim().split('\n').filter(Boolean);
                console.log(`Found ${changedFilesPaths.length} files in unpushed commits`);

                for (const filePath of changedFilesPaths) {
                    // Construct full file URI using path.join for proper path handling
                    const fullPath = path.join(repoPath, filePath);
                    const fileUri = vscode.Uri.file(fullPath);

                    // Skip already collected files
                    const relativePath = getRelativePath(fileUri, workspaceFolder);
                    if (!relativePath || uncommittedFiles.has(relativePath)) {
                        continue;
                    }

                    // Exclude files based on path and extension
                    if (shouldExcludeFile(fileUri)) {
                        continue;
                    }

                    try {
                        // Check if file exists (wasn't deleted)
                        const stat = await vscode.workspace.fs.stat(fileUri);
                        if (stat.type !== vscode.FileType.File) {
                            continue;
                        }

                        // Read file content from disk
                        const document = await vscode.workspace.openTextDocument(fileUri);
                        const content = document.getText();

                        // Skip if file is too large
                        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
                            console.warn(`Skipping file ${fileUri.fsPath} - exceeds maximum size`);
                            continue;
                        }

                        uncommittedFiles.set(relativePath, content);
                        console.log(`Added unpushed file: ${relativePath}`);
                    } catch (error) {
                        // File might have been deleted in a later commit, skip it
                        console.log(`Skipping unpushed file ${filePath} (might be deleted or inaccessible)`);
                    }
                }
            } catch (gitError: any) {
                console.error('Error running git diff command:', gitError.message);
                if (gitError.code === 'ETIMEDOUT') {
                    console.error('Git diff timed out - repository might be too large');
                    throw new Error('Git operation timed out. Repository might be too large.');
                } else if (gitError.status !== 0) {
                    console.error(`Git diff exited with code ${gitError.status}`);
                    throw new Error(`Git command failed with exit code ${gitError.status}`);
                } else {
                    throw new Error('Git diff command failed: ' + gitError.message);
                }
            }

        } catch (error: any) {
            // Re-throw Git errors to be handled at higher level
            if (error.message?.includes('Git')) {
                throw error;
            }
            console.error('Error collecting unpushed files:', error);
        }
    }
}

/**
 * Gets the relative path from the workspace root, using forward slashes
 */
function getRelativePath(uri: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder): string | null {
    const folder = workspaceFolder || vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
        return null;
    }

    const relativePath = path.relative(folder.uri.fsPath, uri.fsPath);
    
    // Convert to forward slashes (important for cross-platform compatibility)
    return relativePath.split(path.sep).join('/');
}

/**
 * Determines if a file should be excluded based on its path and extension
 */
function shouldExcludeFile(uri: vscode.Uri): boolean {
    const filePath = uri.fsPath;
    const fileName = path.basename(filePath);
    const fileExt = path.extname(filePath).toLowerCase();

    // Check file extension
    if (EXCLUDED_EXTENSIONS.has(fileExt)) {
        return true;
    }

    // Check if file is in an excluded directory
    const pathParts = filePath.split(path.sep);
    for (const part of pathParts) {
        if (EXCLUDED_DIRECTORIES.has(part)) {
            return true;
        }
    }

    // Exclude hidden files (starting with .)
    if (fileName.startsWith('.')) {
        return true;
    }

    return false;
}

/**
 * Checks if a file is likely binary by reading its first bytes
 * Binary files contain null bytes or high percentage of non-text characters
 */
async function isBinaryFile(uri: vscode.Uri): Promise<boolean> {
    try {
        // Read first 512 bytes to check for binary content
        const bytes = await vscode.workspace.fs.readFile(uri);
        const sample = bytes.slice(0, Math.min(512, bytes.length));
        
        // Check for null bytes (strong indicator of binary)
        for (let i = 0; i < sample.length; i++) {
            if (sample[i] === 0) {
                return true;
            }
        }
        
        // Check percentage of non-printable characters
        let nonPrintable = 0;
        for (let i = 0; i < sample.length; i++) {
            const byte = sample[i];
            // Count non-printable ASCII (excluding common whitespace: \t=9, \n=10, \r=13)
            if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
                nonPrintable++;
            }
            if (byte > 126) {
                nonPrintable++;
            }
        }
        
        // If more than 30% non-printable, consider it binary
        const threshold = 0.3;
        return (nonPrintable / sample.length) > threshold;
        
    } catch (error) {
        console.error(`Error checking if file is binary: ${uri.fsPath}`, error);
        // If we can't read it, assume it's binary to be safe
        return true;
    }
}
