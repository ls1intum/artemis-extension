import type { ErrorSnapshot } from '../types';

/**
 * Check if a new snapshot should be deduped against the previous one.
 * Shared by ErrorQuotientEngine and CompileEquivalentEmitter.
 *
 * Dedup conditions (all must hold):
 * 1. Within time window
 * 2. Same error state (both errored with identical families, or both clean)
 */
export function shouldDedupSnapshot(
    newSnapshot: ErrorSnapshot,
    lastSnapshot: ErrorSnapshot,
    dedupWindowMs: number,
): boolean {
    const timeDiff = newSnapshot.timestamp - lastSnapshot.timestamp;
    if (timeDiff >= dedupWindowMs) {
        return false;
    }

    if (newSnapshot.hasErrors !== lastSnapshot.hasErrors) {
        return false;
    }

    if (!newSnapshot.hasErrors) {
        return true; // Both clean within window
    }

    // Both have errors — check if families are identical
    if (newSnapshot.errorFamilies.size !== lastSnapshot.errorFamilies.size) {
        return false;
    }

    for (const family of newSnapshot.errorFamilies) {
        if (!lastSnapshot.errorFamilies.has(family)) {
            return false;
        }
    }

    return true;
}
