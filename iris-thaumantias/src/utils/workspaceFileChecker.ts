import * as vscode from 'vscode';
import { promisify } from 'util';
import { execFile } from 'child_process';
import * as fs from 'fs';
import { MAX_FILE_SIZE_BYTES } from './constants';

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

export interface FileCheckOptions {
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
 * Unified workspace file checker
 * Handles all file checking scenarios with configurable options
 */
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
        includeDirty = false
    } = options;

    const allFiles = new Set<string>();

    // 1. Get dirty files from VS Code (if requested)
    if (includeDirty) {
        const dirtyFiles = vscode.workspace.textDocuments
            .filter(doc => doc.isDirty && !doc.isUntitled)
            .map(doc => vscode.workspace.asRelativePath(doc.uri, false));
        dirtyFiles.forEach(file => allFiles.add(file));
    }

    // 2. Get files from git status
    try {
        const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain'], {
            cwd: folder.uri.fsPath,
            timeout: 5000
        });

        if (statusOutput.trim().length > 0) {
            statusOutput
                .split('\n')
                .filter(line => line.trim().length > 0)
                .forEach(line => {
                    if (line.length > 3) {
                        const fileName = line.slice(3).trim();
                        if (fileName) {
                            allFiles.add(fileName);
                        }
                    }
                });
        }
    } catch (error) {
        console.error('[Workspace File Checker] Git status failed:', error);
    }

    // 3. Get unpushed commits (if requested)
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
            console.log('[Workspace File Checker] No upstream branch or git diff failed');
        }
    }

    // 4. Process all files
    const fileInfos: FileInfo[] = [];

    for (const relativePath of allFiles) {
        const fileInfo: FileInfo = { path: relativePath };

        // Apply filters if requested
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

        // File is included
        fileInfo.status = 'included';
        if (includeStatus) {
            fileInfo.reason = 'Will be sent';
        }

        // Read content if requested
        if (includeContent) {
            try {
                const absolutePath = vscode.Uri.joinPath(folder.uri, relativePath).fsPath;
                const content = await readFileAsync(absolutePath, 'utf-8');
                fileInfo.content = content;
            } catch (error) {
                console.error(`[Workspace File Checker] Failed to read ${relativePath}:`, error);
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

/**
 * Check if a file should be excluded based on filters
 * Returns exclusion reason or null if file should be included
 */
async function shouldExcludeFile(folder: vscode.WorkspaceFolder, relativePath: string): Promise<string | null> {
    // Check for excluded directories
    const pathParts = relativePath.split(/[/\\]/);
    for (const part of pathParts) {
        if (EXCLUDED_DIRECTORIES.has(part)) {
            return `Excluded directory (${part})`;
        }
    }

    // Whitelist check: only allow specific extensions
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

    // Check file size
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

    return null; // File should be included
}
