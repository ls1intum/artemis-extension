import type { InFlightMarker } from './interventionDeps';
import type { Episode } from './slot/episode';
import { ProgressCloseLatch } from './slot/progressClose';
import { SlotManager } from './slot/slotManager';
import type { StaleWatchdog } from './slot/staleWatchdog';
import type { StruggleSignal } from './struggleContract';

/**
 * The mutable state both halves of the server conversation share.
 *
 * This is NOT "the orchestrator with a new name". It holds seven fields and no
 * behaviour, and it exists because the inbound and outbound halves of one state
 * machine genuinely write the same slot: an alert preallocates `candidate` and
 * stamps `inFlightMarker`, and the reply that lands minutes later consumes both.
 * Threading those seven through fourteen accessor pairs would be the same
 * coupling with more ceremony, and it would hide which fields are shared.
 *
 * Everything that is NOT shared stays where it belongs: the offers own their
 * three fields, reveal owns the pending outcomes and the consent generation, and
 * the orchestrator owns the lifecycle that resets all of it.
 */
export interface SlotRuntime {
    /** Slot state machine; every decision routes through it. */
    readonly slot: SlotManager;
    /** Progress-close edge-trigger latch (B8). */
    readonly latch: ProgressCloseLatch;
    /** Per-episode stale watchdog (minted fresh on every TAKE; undefined when the slot is FREE). */
    watchdog: StaleWatchdog | undefined;
    /** Preallocated candidate episode for FREE/PARKED-slot decide (cleared on slot take or reject). */
    candidate: Episode | undefined;
    /** Outstanding struggle POST marker (undefined = the wire is free). */
    inFlightMarker: InFlightMarker | undefined;
    /** Most recent StruggleSignal from deliver(); reused for confirmClose POSTs. */
    lastSignal: StruggleSignal | undefined;
    /**
     * The proactive session id from the last inbound ambient event (spec §5, A9).
     * Lives here because the SlotManager does not hold session ids. Cleared on resetSession.
     */
    frozenSessionId: number | undefined;
}

export function newSlotRuntime(latch: ProgressCloseLatch): SlotRuntime {
    return {
        slot: new SlotManager(),
        latch,
        watchdog: undefined,
        candidate: undefined,
        inFlightMarker: undefined,
        lastSignal: undefined,
        frozenSessionId: undefined,
    };
}
