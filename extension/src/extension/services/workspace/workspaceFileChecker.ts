import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

import { LogCategory, logger } from '@extension/services/loggingService';
import { MAX_FILE_SIZE_BYTES } from '@extension/utils/constants';

const execFileAsync = promisify(execFile);
const readFileAsync = promisify(fs.readFile);
const statAsync = promisify(fs.stat);

// Whitelist of allowed file extensions (source code and configs only)
const ALLOWED_EXTENSIONS = new Set([
    // Programming languages
    '.java', '.kt', '.scala', '.groovy',           // JVM languages
    '.py', '.pyw',                                  // Python
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',  // JavaScript/TypeScript
    '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',     // C/C++
    '.cs', '.vb',                                   // .NET
    '.go',                                          // Go
    '.rs',                                          // Rust
    '.swift',                                       // Swift
    '.php',                                         // PHP
    '.rb',                                          // Ruby
    '.r',                                           // R
    '.m', '.mm',                                    // Objective-C
    '.sql',                                         // SQL
    '.sh', '.bash', '.zsh', '.fish',               // Shell scripts
    '.ps1', '.psm1',                                // PowerShell

    // Markup & Data
    '.html', '.htm', '.xml', '.xhtml',             // Markup
    '.css', '.scss', '.sass', '.less',             // Stylesheets
    '.json', '.yaml', '.yml', '.toml',             // Config formats
    '.md', '.markdown', '.rst', '.txt',            // Documentation

    // Build & Config files
    '.gradle', '.properties', '.pro',               // Build configs
    '.cmake', '.mk',                                // Build systems
    '.dockerfile',                                  // Docker

    // Other
    '.gitignore', '.gitattributes',                // Git configs
    '.env', '.envrc',                               // Environment files
]);

const EXCLUDED_DIRECTORIES = new Set([
    'node_modules', 'target', 'build', 'dist', 'out', '.git',
    'bin', 'obj', '.gradle', '.idea', '.vscode', 'coverage',
    '__pycache__', '.pytest_cache', '.mypy_cache',
    'vendor', 'packages', 'deps',
]);

interface FileCheckOptions {
    /** Include file contents in the result */
    includeContent?: boolean;
    /** Include detailed status/reason for each file */
    includeStatus?: boolean;
    /** Apply filtering (size, binary, excluded dirs) */
    applyFilters?: boolean;
    /** Check for unpushed commits in addition to local changes */
    checkUnpushed?: boolean;
    /** Include dirty (unsaved) files from VS Code */
    includeDirty?: boolean;
    /** Optional override for dirty files (used for testing or custom collection) */
    dirtyFilesOverride?: string[];
    /**
     * Propagate a `git status` failure instead of swallowing it. Off by default
     * so existing callers (status polling, file watchers) keep their best-effort
     * behaviour; the submit flow opts in so an unreadable/locked repo surfaces
     * as an error rather than a misleading "no changes" result.
     */
    throwOnGitError?: boolean;
}

export interface FileInfo {
    path: string;
    content?: string;
    status?: 'included' | 'excluded';
    reason?: string;
}

export interface FileCheckResult {
    hasChanges: boolean;
    files: FileInfo[];
    totalCount: number;
    includedCount: number;
    excludedCount: number;
}

/**
 * Parse the output of `git status --porcelain=v1 -z`.
 *
 * The `-z` format terminates each record with a NUL byte and, unlike the default
 * porcelain format, does NOT C-quote paths containing spaces or special characters.
 * Rename/copy entries (status code `R`/`C`) span two NUL-separated fields: the
 * destination path (carrying the `XY ` prefix) followed by the bare source path.
 * We keep the destination (the file that exists on disk now) and skip the source.
 *
 * @returns changed file paths, relative to the repository root.
 */
export function parseGitStatusZ(stdout: string): string[] {
    const paths: string[] = [];
    const fields = stdout.split('\0');

    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        // A status record is "XY PATH": two-char status, separator space, path.
        // The final field after the trailing NUL is empty; shorter fields are malformed.
        if (field.length < 4) {
            continue;
        }
        const status = field.slice(0, 2);
        const filePath = field.slice(3);
        if (filePath) {
            paths.push(filePath);
        }
        // Rename/copy records are followed by the original path as a separate
        // field; consume it so it is not mis-parsed as its own status record.
        if (status.includes('R') || status.includes('C')) {
            i++;
        }
    }

    return paths;
}

export async function checkWorkspaceFiles(
    workspaceFolder?: vscode.WorkspaceFolder,
    options: FileCheckOptions = {}
): Promise<FileCheckResult> {
    const folder = workspaceFolder || vscode.workspace.workspaceFolders?.[0];

    if (!folder) {
        return {
            hasChanges: false,
            files: [],
            totalCount: 0,
            includedCount: 0,
            excludedCount: 0
        };
    }

    const {
        includeContent = false,
        includeStatus = false,
        applyFilters = false,
        checkUnpushed = false,
        includeDirty = false,
        dirtyFilesOverride,
        throwOnGitError = false
    } = options;

    const allFiles = new Set<string>();

    if (includeDirty) {
        const dirtyFiles = dirtyFilesOverride ?? vscode.workspace.textDocuments
            .filter(doc => doc.isDirty && !doc.isUntitled && doc.uri.scheme === 'file')
            .map(doc => vscode.workspace.asRelativePath(doc.uri, false));

        // Skip git checks when an explicit override is provided
        if (dirtyFilesOverride) {
            dirtyFiles.forEach(file => allFiles.add(file));
        } else {
            // Check if files are gitignored using VS Code's Git extension
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension && dirtyFiles.length > 0) {
                try {
                    if (!gitExtension.isActive) {
                        await gitExtension.activate();
                    }
                    // Git extension API is untyped external API - use unknown with type guards
                    const gitExports: unknown = gitExtension.exports;
                    let gitApi: unknown;

                    if (gitExports && typeof gitExports === 'object' && 'getAPI' in gitExports) {
                        const getAPI = (gitExports as { getAPI: unknown }).getAPI;
                        if (typeof getAPI === 'function') {
                            gitApi = (getAPI as (version: number) => unknown)(1);
                        }
                    }

                    if (gitApi && typeof gitApi === 'object' && 'repositories' in gitApi) {
                        const repositories = (gitApi as { repositories: unknown }).repositories;

                        if (Array.isArray(repositories) && repositories.length > 0) {
                            const repo: unknown = folder ?
                                repositories.find((r: unknown) =>
                                    r && typeof r === 'object' && 'rootUri' in r &&
                                    (r as { rootUri: { fsPath: string } }).rootUri.fsPath === folder.uri.fsPath
                                ) :
                                repositories[0];

                            if (repo && typeof repo === 'object' && 'status' in repo) {
                                const repoWithStatus = repo as { status: (uri: vscode.Uri) => Promise<unknown> };

                                for (const file of dirtyFiles) {
                                    const fileUri = vscode.Uri.joinPath(folder.uri, file);
                                    try {
                                        const isIgnored: boolean = await repoWithStatus.status(fileUri).then(
                                            () => false, // File is tracked, not ignored
                                            () => true   // File is not tracked (likely ignored)
                                        );

                                        if (!isIgnored) {
                                            allFiles.add(file);
                                        } else {
                                            logger.info(`Skipping gitignored dirty file: ${file}`, LogCategory.FILE_MONITOR);
                                        }
                                    } catch {
                                        // If we can't determine, include it to be safe
                                        allFiles.add(file);
                                    }
                                }
                            } else {
                                dirtyFiles.forEach(file => allFiles.add(file));
                            }
                        } else {
                            dirtyFiles.forEach(file => allFiles.add(file));
                        }
                    } else {
                        dirtyFiles.forEach(file => allFiles.add(file));
                    }
                } catch (error) {
                    logger.error('Error checking gitignore status', LogCategory.FILE_MONITOR, error);
                    // On error, include all dirty files to be safe
                    dirtyFiles.forEach(file => allFiles.add(file));
                }
            } else {
                dirtyFiles.forEach(file => allFiles.add(file));
            }
        }
    }

    // The NUL-terminated porcelain format (-z) leaves paths unquoted and lists
    // rename/copy destinations explicitly, so paths with spaces survive intact.
    try {
        const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], {
            cwd: folder.uri.fsPath,
            timeout: 5000
        });

        for (const file of parseGitStatusZ(statusOutput)) {
            allFiles.add(file);
        }
    } catch (error) {
        logger.error('Git status failed', LogCategory.FILE_MONITOR, error);
        // Submit opts into fail-fast so a locked/unreadable repo is not misread
        // as "no changes"; all other callers keep the best-effort behaviour.
        if (throwOnGitError) {
            throw error;
        }
    }

    if (checkUnpushed) {
        try {
            const { stdout: diffOutput } = await execFileAsync('git', ['diff', '--name-only', '@{u}..HEAD'], {
                cwd: folder.uri.fsPath,
                timeout: 5000
            });

            if (diffOutput.trim().length > 0) {
                diffOutput.split('\n')
                    .filter(line => line.trim().length > 0)
                    .forEach(file => allFiles.add(file.trim()));
            }
        } catch (error) {
            // No upstream or other error - ignore
            logger.info('No upstream branch or git diff failed', LogCategory.FILE_MONITOR);
        }
    }

    const fileInfos: FileInfo[] = [];

    for (const relativePath of allFiles) {
        const fileInfo: FileInfo = { path: relativePath };

        if (applyFilters) {
            const exclusionReason = await shouldExcludeFile(folder, relativePath);
            if (exclusionReason) {
                fileInfo.status = 'excluded';
                fileInfo.reason = exclusionReason;
                if (includeStatus) {
                    fileInfos.push(fileInfo);
                }
                continue;
            }
        }

        fileInfo.status = 'included';
        if (includeStatus) {
            fileInfo.reason = 'Will be sent';
        }

        if (includeContent) {
            try {
                const absolutePath = vscode.Uri.joinPath(folder.uri, relativePath).fsPath;
                const content = await readFileAsync(absolutePath, 'utf-8');
                fileInfo.content = content;
            } catch (error) {
                logger.error(`Failed to read ${relativePath}`, LogCategory.FILE_MONITOR, error);
                fileInfo.content = '';
            }
        }

        fileInfos.push(fileInfo);
    }

    const includedFiles = fileInfos.filter(f => f.status === 'included');
    const excludedFiles = fileInfos.filter(f => f.status === 'excluded');

    return {
        hasChanges: fileInfos.length > 0,
        files: fileInfos,
        totalCount: fileInfos.length,
        includedCount: includedFiles.length,
        excludedCount: excludedFiles.length
    };
}

/** Returns the exclusion reason, or null when the file should be included. */
async function shouldExcludeFile(folder: vscode.WorkspaceFolder, relativePath: string): Promise<string | null> {
    const pathParts = relativePath.split(/[/\\]/);
    for (const part of pathParts) {
        if (EXCLUDED_DIRECTORIES.has(part)) {
            return `Excluded directory (${part})`;
        }
    }

    const ext = relativePath.substring(relativePath.lastIndexOf('.')).toLowerCase();

    // Special case: files without extensions (like Dockerfile, Makefile, etc.)
    const fileName = pathParts[pathParts.length - 1];
    const hasNoExtension = !fileName.includes('.') || fileName.startsWith('.');
    const isSpecialFile = hasNoExtension && (
        fileName.toLowerCase() === 'dockerfile' ||
        fileName.toLowerCase() === 'makefile' ||
        fileName.toLowerCase() === 'rakefile' ||
        fileName.toLowerCase() === 'gradlew' ||
        fileName.toLowerCase() === 'mvnw'
    );

    if (!isSpecialFile && !ALLOWED_EXTENSIONS.has(ext)) {
        return `File type not allowed (${ext || 'no extension'})`;
    }

    try {
        const absolutePath = vscode.Uri.joinPath(folder.uri, relativePath).fsPath;
        const stats = await statAsync(absolutePath);

        if (stats.size > MAX_FILE_SIZE_BYTES) {
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            return `File too large (${sizeMB}MB > 1MB)`;
        }

        // Check if binary by reading first few bytes
        if (stats.size > 0) {
            const buffer = Buffer.alloc(Math.min(512, stats.size));
            const fd = fs.openSync(absolutePath, 'r');
            fs.readSync(fd, buffer, 0, buffer.length, 0);
            fs.closeSync(fd);

            // Check for null bytes (binary indicator)
            if (buffer.includes(0)) {
                return 'Binary file detected';
            }
        }
    } catch (error) {
        return 'File not accessible';
    }

    return null;
}
