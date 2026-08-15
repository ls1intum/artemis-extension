import type { Level } from './episode';
import type { SlotState } from './slotManager';

export interface Decision {
    action: 'silent' | 'ambient' | 'active';
    text: string | null;
    hardEvent: boolean;
}

export type ReconcileAction =
    | { kind: 'take-parked'; text: string }      // FREE + ambient
    | { kind: 'take-delivered'; text: string }    // FREE + active
    | { kind: 'replace-parked'; text: string }    // PARKED + ambient  (new episode, stays PARKED)
    | { kind: 'replace-delivered'; text: string } // PARKED + active   (new episode, fresh first delivery, §6)
    | { kind: 'discard-free' }                    // PARKED + silent
    | { kind: 'escalate' }                        // DELIVERED ambient (revealed) + active + hardEvent
    | { kind: 'suppress' };                       // everything else

/**
 * Apply a decision against the current slot state and derive the action.
 *
 * The escalation precondition is derived from slot state (one source of truth):
 * a delivered slot has level==='ambient' iff it was a revealed ambient hint
 * (the only PARKED-ambient -> DELIVERED path is revealParked, which keeps
 * level='ambient'; takeDelivered/replaceWithDelivered produce level='active';
 * escalate flips delivered-ambient to level='active').
 *
 * No 'ambientWasRevealed' flag is needed or accepted.
 */
export function reconcile(slot: SlotState, decision: Decision): ReconcileAction {
    switch (slot.kind) {
        case 'free':
            return reconcileFree(decision);

        case 'parked':
            return reconcileParked(decision);

        case 'delivered':
            return reconcileDelivered(slot.level, decision);
    }
}

function reconcileFree(decision: Decision): ReconcileAction {
    switch (decision.action) {
        case 'silent':
            return { kind: 'suppress' };
        case 'ambient':
            return { kind: 'take-parked', text: decision.text! };
        case 'active':
            return { kind: 'take-delivered', text: decision.text! };
    }
}

function reconcileParked(decision: Decision): ReconcileAction {
    switch (decision.action) {
        case 'silent':
            return { kind: 'discard-free' };
        case 'ambient':
            return { kind: 'replace-parked', text: decision.text! };
        case 'active':
            // Fresh first delivery: new episode shown immediately (§6).
            // NOT another hidden pointer; NOT escalate.
            return { kind: 'replace-delivered', text: decision.text! };
    }
}

function reconcileDelivered(currentLevel: Level, decision: Decision): ReconcileAction {
    // Escalate ONLY when: active + hardEvent + slot is still at ambient level
    // (level==='ambient' is the fingerprint of a revealed-ambient hint).
    if (
        decision.action === 'active' &&
        decision.hardEvent &&
        currentLevel === 'ambient'
    ) {
        return { kind: 'escalate' };
    }

    // Everything else: softer, same/more-detail, soft drift, or already-active slot.
    // No auto-deepen; no second escalation.
    return { kind: 'suppress' };
}
