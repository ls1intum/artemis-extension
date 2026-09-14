import type { AlertRecord } from '@extension/services/struggle/types';

import type { SlotState } from './slot/slotManager';

/** Boundary types that constitute a hard event (drive the escalation path). */
const HARD_BOUNDARIES = new Set<string>(['FM', 'E4', 'N1']);

/**
 * A hard alert is anchored on a student ACTION (build/terminal/paste), not on passive state:
 * it clears/bypasses the awaiting-evidence gate and may escalate a delivered-ambient episode.
 * Edit path: any hard boundary present. Discrete path: the test-stagnation trigger is hard
 * (build-anchored - the engine treats it as warmup-breaking for the same reason). Scoped to
 * the TRIGGER, not the kind: a future discrete add-on must opt into hard semantics explicitly.
 */
export function isHardAlert(alert: AlertRecord): boolean {
    return alert.kind === 'edit'
        ? alert.types.some(t => HARD_BOUNDARIES.has(t))
        : alert.trigger === 'test-stagnation';
}

/**
 * Everything {@link suppressReason} reads, passed in rather than reached for.
 *
 * The orchestrator holds each of these on a different collaborator, and the gate
 * order below is the product rule ("who may switch proactivity off, and in which
 * order do they win"). Naming the inputs is what lets that rule be tested against
 * an object literal instead of a constructed service.
 */
export interface SuppressionState {
    /** Iris enabled for the active exercise's course. Fail-closed: false when not yet known. */
    irisEnabled: boolean;
    /** Server told us proactive is off for this course, this session. */
    courseProactiveOff: boolean;
    /** The student's own durable opt-in. */
    studentProactiveOn: boolean;
    /** Set while the idle watchdog has silently freed a slot; only a hard alert gets through. */
    awaitingEvidence: boolean;
    slot: SlotState;
    /**
     * Whether a Moment-1 stuck offer could be raised for this episode right now.
     * A predicate rather than a value: it is only consulted on the delivered-slot
     * branch, and evaluating it eagerly would read offer state on every alert.
     */
    canRaiseStuckOfferNow: (episodeId: string) => boolean;
}

/**
 * Pre-throttle suppression. Returns the dev-log reason, or null when the alert may proceed.
 *
 * Lifted out of the orchestrator unchanged, gate order included. The service's
 * `shouldSuppress` (the BackoffSource predicate) is `suppressReason(...) !== null`.
 */
export function suppressReason(alert: AlertRecord, state: SuppressionState): string | null {
    if (!state.irisEnabled) {
        return '  -> SKIP (Iris not enabled for this course: no proactivity)';
    }
    if (state.courseProactiveOff) {
        return '  -> SKIP (course proactive disabled for this session)';
    }
    if (!state.studentProactiveOn) {
        return '  -> SKIP (student turned proactive off)';
    }
    if (state.awaitingEvidence && !isHardAlert(alert)) {
        return '  -> SKIP (awaiting fresh evidence after idle-abandon)';
    }
    // Delivered-slot POST gating: while the slot is DELIVERED, reconcile suppresses every
    // inbound result except the escalation case (revealed-ambient level + hard event).
    // When no result could surface, don't pay for the server pipeline run at all.
    const slot = state.slot;
    if (slot.kind === 'delivered' && !(slot.level === 'ambient' && isHardAlert(alert))) {
        if (state.canRaiseStuckOfferNow(slot.episode.episodeId)) {
            return null;
        }
        return '  -> SKIP (delivered slot: reconcile would suppress any result, POST saved)';
    }
    return null;
}
