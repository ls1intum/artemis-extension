import { LogCategory, logger } from '@extension/services/loggingService';

export type LatchState = 'eligible' | 'consumed' | 'cancelled';

/**
 * Permission for the chat to acquire a conversation on its own, exactly once.
 *
 * Cancelled by the first explicit student intent, at ADMISSION rather than at
 * success: a navigation that was accepted and then answered `no-course` still
 * means the student said where they wanted to go, and a background detection
 * must not overrule it afterwards.
 */
export class StartupLatch {
    private _state: LatchState = 'eligible';

    public get state(): LatchState { return this._state; }

    public cancel(reason: string): void {
        if (this._state !== 'eligible') { return; }
        this._state = 'cancelled';
        logger.info(`Automatic chat startup cancelled by ${reason}`, LogCategory.IRIS_CHAT);
    }

    /** True only on the single transition out of `eligible`. */
    public consume(): boolean {
        if (this._state !== 'eligible') { return false; }
        this._state = 'consumed';
        return true;
    }
}
