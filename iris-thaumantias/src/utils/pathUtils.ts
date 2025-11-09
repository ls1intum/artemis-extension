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
