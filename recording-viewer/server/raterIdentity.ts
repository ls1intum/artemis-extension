import { createHash } from 'node:crypto';

export class RaterNameError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RaterNameError';
    }
}

/**
 * Normalize a free-text rater name into the display form persisted in records:
 *   1. NFC-normalize (combining sequences fold into precomposed code points).
 *   2. Trim leading/trailing whitespace.
 *   3. Collapse internal whitespace runs to single ASCII spaces.
 *   4. Require length 1-80 after the above.
 * Case is preserved; lowercasing happens only in `deriveRaterId`.
 */
export function normalizeRaterName(raw: string): string {
    const cleaned = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (cleaned.length < 1) throw new RaterNameError('Rater name is required');
    if (cleaned.length > 80) throw new RaterNameError('Rater name must be 80 characters or fewer');
    return cleaned;
}

/**
 * Derive a stable opaque rater id from a display name. Case-only and
 * whitespace-only differences collapse to the same id; any other typo
 * yields a different id (and thus a different file).
 *
 * Format: `r_` + first 22 base64url chars of sha256(canonical).
 */
export function deriveRaterId(displayName: string): string {
    const canonical = normalizeRaterName(displayName).toLocaleLowerCase('en-US');
    const digest = createHash('sha256').update(canonical, 'utf8').digest('base64url');
    return 'r_' + digest.slice(0, 22);
}
