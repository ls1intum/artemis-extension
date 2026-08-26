import * as os from 'os';
import * as path from 'path';

/**
 * Normalizes relative file paths parsed from build logs or user input.
 * - Converts Windows backslashes to forward slashes
 * - Trims leading slashes to keep the path relative
 * - Removes a trailing ".git" suffix accidentally appended to filenames
 */
export function normalizeRelativePath(filePath?: string | null): string {
    if (!filePath) {
        return '';
    }

    let normalized = filePath.trim();
    normalized = normalized.replace(/\\/g, '/');
    normalized = normalized.replace(/^\/+/, '');

    // Guard against paths like "StorageStation.java.git"
    normalized = normalized.replace(/(\.[a-z0-9]+)\.git$/i, '$1');
    normalized = normalized.replace(/\.git$/i, '');

    return normalized;
}

/**
 * Expands a leading `~` in a user-supplied path to the current user's home directory.
 *
 * Only the shell's own bare-tilde form is expanded: `~`, `~/exercises`, `~\exercises`.
 * `~student/exercises` is left alone, because resolving another user's home is not
 * portable, and a path that reaches the filesystem unchanged fails validation with a
 * plain "does not exist" rather than silently pointing somewhere else.
 *
 * Only the prefix is interpreted; the rest keeps whatever separators it was written with.
 * Rewriting them is not an option: a backslash is a legal character in a POSIX filename,
 * so a path is only ever readable on the platform whose separators it uses.
 */
export function expandHomePath(filePath: string): string {
    if (filePath !== '~' && !filePath.startsWith('~/') && !filePath.startsWith('~\\')) {
        return filePath;
    }

    const home = os.homedir();
    return filePath === '~' ? home : path.join(home, filePath.slice(2));
}
