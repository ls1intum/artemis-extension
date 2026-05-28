const fileLocks = new Map<string, Promise<void>>();

/**
 * Serialize async callers operating on the same `filepath`. Subsequent
 * callers wait for the previous holder's promise to resolve before running.
 * Errors thrown by `fn` propagate to its caller but do NOT block the queue.
 *
 * GC: the map entry for `filepath` is removed when nothing is queued behind
 * the current caller. Strict-identity check guarantees we never delete a
 * later caller's lock.
 */
export async function withFileLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    const prev = fileLocks.get(filepath) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>(r => { release = r; });
    fileLocks.set(filepath, done);
    try {
        await prev;
        return await fn();
    } finally {
        release();
        if (fileLocks.get(filepath) === done) {
            fileLocks.delete(filepath);
        }
    }
}

/** Test-only handle to the internal map. Not exported via index. */
export const _fileLocksForTest: ReadonlyMap<string, Promise<void>> = fileLocks;
