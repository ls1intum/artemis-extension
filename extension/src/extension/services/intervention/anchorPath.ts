/**
 * Pure (vscode-free) anchor-path contract shared by every proactive anchor surface — the inline
 * after-line cue, the ambient gutter pointer, and the active jump lamp. Kept dependency-free so the
 * vscode-free orchestrator can enforce it at the point an anchor surface is armed, alongside the
 * telemetry wiring that resolves the absolute Uri.
 */

/**
 * True when `anchorFile` is a safe repo-relative path: not absolute, no empty / `.` / `..` segments.
 * A server anchor is a repo-relative path under the exercise root; a traversal like `../x` could open
 * or decorate a file OUTSIDE the root, so every anchor surface rejects it (treats it as no anchor).
 */
export function isSafeAnchorPath(anchorFile: string): boolean {
    if (anchorFile.length === 0 || anchorFile.startsWith('/')) { return false; }
    return anchorFile.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
}
