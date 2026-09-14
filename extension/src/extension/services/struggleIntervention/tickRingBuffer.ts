import type { TickRecord } from '@extension/services/struggle/types';

/** Bounded FIFO of the most recent ticks (default cap 12 ≈ 120s) for the signal trajectory. */
export class TickRingBuffer {
    private readonly _buf: TickRecord[] = [];

    constructor(private readonly _capacity: number = 12) {}

    push(tick: TickRecord): void {
        this._buf.push(tick);
        while (this._buf.length > this._capacity) {
            this._buf.shift();
        }
    }

    /** oldest → newest */
    snapshot(): readonly TickRecord[] {
        return [...this._buf];
    }

    clear(): void {
        this._buf.length = 0;
    }
}
