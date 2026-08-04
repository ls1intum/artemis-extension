import { LogCategory, logger } from '@extension/services/loggingService';

export type LatchState = 'eligible' | 'consumed' | 'cancelled';

/**
 * Permission for the chat to acquire a conversation on its own, exactly once.
 *
 * Cancelled by the first explicit student intent, at ADMISSION rather than at
 * success: a navigation that was accepted and then answered `no-course` still
 * means the student said where they wanted to go, and a background detection
 * must not overrule it afterwards.
 *
 * `consumed` is no longer a terminal state (`reArmAfterFailedStart` can leave
 * it), so `cancel()` has to be able to record an intent that arrives WHILE an
 * automatic attempt is still in flight, not only while the latch is still
 * `eligible`. That in-flight attempt cannot itself be aborted, but recording
 * the cancellation here is what stops it being revived if that attempt goes
 * on to fail: without this, a start still pending when the student explicitly
 * navigates away silently drops that intent, and a later `reArmAfterFailedStart`
 * hands the automatic path a second chance the student had already refused.
 */
export class StartupLatch {
    private _state: LatchState = 'eligible';

    public get state(): LatchState { return this._state; }

    /**
     * Acts from `eligible` (nothing has started yet) OR `consumed` (an
     * automatic attempt is in flight, or already finished) — anything but
     * `cancelled` itself, which is left alone rather than re-logged.
     */
    public cancel(reason: string): void {
        if (this._state === 'cancelled') { return; }
        this._state = 'cancelled';
        logger.info(`Automatic chat startup cancelled by ${reason}`, LogCategory.IRIS_CHAT);
    }

    /** True only on the single transition out of `eligible`. */
    public consume(): boolean {
        if (this._state !== 'eligible') { return false; }
        this._state = 'consumed';
        return true;
    }

    /**
     * Undoes a single `consume()`, but ONLY from `consumed`. Exists for one
     * caller: the automatic start attempt itself failed (a transient network
     * error, not a decision), so the permission it spent is given back
     * rather than burned for good. A `cancelled` latch never moves — INCLUDING
     * one `cancel()` moved there FROM `consumed`, while that very attempt was
     * still in flight: an explicit student intent still wins permanently,
     * even when the automatic attempt that raced it goes on to fail.
     */
    public reArmAfterFailedStart(): void {
        if (this._state !== 'consumed') { return; }
        this._state = 'eligible';
        logger.info('Automatic chat startup re-armed after a failed attempt', LogCategory.IRIS_CHAT);
    }
}
