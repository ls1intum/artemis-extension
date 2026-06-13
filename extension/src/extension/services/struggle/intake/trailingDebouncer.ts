/**
 * Per-key trailing debounce mirroring the recorder's observationRegistry
 * semantics: every push resets the key's timer; after `delayMs` of quiet the
 * LAST pushed payload is emitted (the payload carries its own trigger-time
 * timestamp, so downstream sees burst-end event time, not flush time).
 */
export class TrailingDebouncer<T> {
    private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly _pending = new Map<string, T>();
    private _disposed = false;

    constructor(
        private readonly _delayMs: number,
        private readonly _emit: (payload: T) => void,
    ) {}

    push(key: string, payload: T): void {
        if (this._disposed) {
            return;
        }
        this._pending.set(key, payload);
        const existing = this._timers.get(key);
        if (existing !== undefined) {
            clearTimeout(existing);
        }
        this._timers.set(key, setTimeout(() => {
            this._timers.delete(key);
            const value = this._pending.get(key);
            this._pending.delete(key);
            if (value !== undefined) {
                this._emit(value);
            }
        }, this._delayMs));
    }

    /** Emit everything pending now (session end). */
    flush(): void {
        for (const timer of this._timers.values()) {
            clearTimeout(timer);
        }
        this._timers.clear();
        for (const value of this._pending.values()) {
            this._emit(value);
        }
        this._pending.clear();
    }

    /** Discard everything pending (engine teardown). */
    dispose(): void {
        this._disposed = true;
        for (const timer of this._timers.values()) {
            clearTimeout(timer);
        }
        this._timers.clear();
        this._pending.clear();
    }
}
