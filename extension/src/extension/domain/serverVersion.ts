/** The oldest Artemis this extension works against. */
export const MIN_ARTEMIS_VERSION = '9.9.0';

const MIN_PARTS: readonly number[] = [9, 9, 0];

/**
 * Whether an Artemis `build.version` is new enough for this extension.
 *
 * The boundary is `courses/{id}/exercises-for-overview`, which Artemis added in
 * 9.9. Below that the course contents do not load.
 *
 * Unreadable input answers `true`. The warning this gates is worth having only
 * when it is right: a student on a working server who is told to upgrade it has
 * been actively misled, which is worse than a student on an old server who is
 * merely not told why their course is empty.
 */
export function isSupportedVersion(version: string | undefined): boolean {
    if (version === undefined) {
        return true;
    }
    const trimmed = version.trim();

    // Leading-digit gate, before anything else. Without it the "empty segment is
    // 0" rule below would read '.9.9' as 0.9.9 and warn about a server that is
    // very likely fine.
    if (!/^\d/.test(trimmed)) {
        return true;
    }

    const numeric = /^[\d.]+/.exec(trimmed)?.[0] ?? '';
    const parts = numeric.split('.').slice(0, MIN_PARTS.length);

    for (let i = 0; i < MIN_PARTS.length; i++) {
        const parsed = Number.parseInt(parts[i] ?? '', 10);
        const value = Number.isNaN(parsed) ? 0 : parsed;
        if (value !== MIN_PARTS[i]) {
            return value > MIN_PARTS[i];
        }
    }
    return true;
}
