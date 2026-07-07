import type { Episode, EpisodeHint, Level, SlotGeneration } from './episode';
import { addHint } from './episode';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SlotState =
    | { kind: 'free' }
    | { kind: 'parked'; episode: Episode; level: 'ambient'; frozenText: string; generation: SlotGeneration }
    | { kind: 'delivered'; episode: Episode; level: Level; generation: SlotGeneration };

export interface SlotSnapshot {
    state: SlotState;
    inSession: boolean;
    generation: SlotGeneration;
}

// ---------------------------------------------------------------------------
// SlotManager
// ---------------------------------------------------------------------------

/**
 * Pure in-memory slot state machine.
 *
 * A single slot may hold at most one episode at a time (FREE / PARKED / DELIVERED).
 * Generation is bumped on every semantic transition (take*, replace*, reveal,
 * escalate, free, discardParkedToFree) but NOT on setInSession.
 *
 * The `now` parameter on transition methods is reserved for Phase C timestamp
 * bookkeeping; this layer does not use it.
 */
export class SlotManager {
    private _state: SlotState = { kind: 'free' };
    private _inSession = false;
    private _gen: SlotGeneration = 0;

    snapshot(): SlotSnapshot {
        return { state: this._state, inSession: this._inSession, generation: this._gen };
    }

    generation(): SlotGeneration {
        return this._gen;
    }

    isFree(): boolean {
        return this._state.kind === 'free';
    }

    // -----------------------------------------------------------------------
    // Semantic transitions (each bumps generation)
    // -----------------------------------------------------------------------

    /** FREE -> PARKED. The episode receives the hint as its first hints[] entry. */
    takeParked(_now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot {
        this._requireKind('takeParked', 'free');
        const ep = addHint(episode, hint);
        this._gen++;
        this._state = { kind: 'parked', episode: ep, level: 'ambient', frozenText: hint.text, generation: this._gen };
        return this.snapshot();
    }

    /** FREE -> DELIVERED. The episode receives the hint as its first hints[] entry. */
    takeDelivered(_now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot {
        this._requireKind('takeDelivered', 'free');
        const ep = addHint(episode, hint);
        this._gen++;
        this._state = { kind: 'delivered', episode: ep, level: hint.level, generation: this._gen };
        return this.snapshot();
    }

    /**
     * PARKED -> PARKED with a new episode (pre-allocated by the orchestrator).
     * The old parked hint is dropped; the new episode carries only the new hint.
     */
    replaceParked(_now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot {
        this._requireKind('replaceParked', 'parked');
        const ep = addHint(episode, hint);
        this._gen++;
        this._state = { kind: 'parked', episode: ep, level: 'ambient', frozenText: hint.text, generation: this._gen };
        return this.snapshot();
    }

    /**
     * PARKED -> DELIVERED with a new episode (first active delivery, spec §6).
     * The old parked hint is dropped; the new episode carries only the active hint.
     */
    replaceWithDelivered(_now: number, episode: Episode, hint: EpisodeHint): SlotSnapshot {
        this._requireKind('replaceWithDelivered', 'parked');
        const ep = addHint(episode, hint);
        this._gen++;
        this._state = { kind: 'delivered', episode: ep, level: hint.level, generation: this._gen };
        return this.snapshot();
    }

    /**
     * PARKED -> DELIVERED (student clicked the ambient cue).
     * The same episode is kept; the ambient hint is already in hints[] from takeParked,
     * so it is NOT re-added here.
     */
    revealParked(_hint: EpisodeHint): SlotSnapshot {
        this._requireKind('revealParked', 'parked');
        const episode = (this._state as Extract<SlotState, { kind: 'parked' }>).episode;
        this._gen++;
        this._state = { kind: 'delivered', episode, level: 'ambient', generation: this._gen };
        return this.snapshot();
    }

    /**
     * DELIVERED ambient -> DELIVERED active (same episode, hint appended via addHint).
     * Throws if the current level is already active.
     */
    escalate(hint: EpisodeHint): SlotSnapshot {
        if (this._state.kind !== 'delivered') {
            throw new Error(`escalate: illegal in state '${this._state.kind}' (requires delivered)`);
        }
        if (this._state.level !== 'ambient') {
            throw new Error(`escalate: can only escalate from ambient level (current: '${this._state.level}')`);
        }
        const ep = addHint(this._state.episode, hint);
        this._gen++;
        this._state = { kind: 'delivered', episode: ep, level: 'active', generation: this._gen };
        return this.snapshot();
    }

    /**
     * DELIVERED -> DELIVERED (consented follow-up, spec B+). Appends the hint to the SAME episode.
     * Unlike escalate, NOT gated on the current level and driven by an explicit help_request reply.
     */
    appendFollowup(hint: EpisodeHint): SlotSnapshot {
        if (this._state.kind !== 'delivered') {
            throw new Error(`appendFollowup: illegal in state '${this._state.kind}' (requires delivered)`);
        }
        const ep = addHint(this._state.episode, hint);
        this._gen++;
        this._state = { kind: 'delivered', episode: ep, level: 'active', generation: this._gen };
        return this.snapshot();
    }

    /** -> FREE from any state. */
    free(): SlotSnapshot {
        this._gen++;
        this._state = { kind: 'free' };
        return this.snapshot();
    }

    /** PARKED -> FREE (silent discard, no row written). Throws if not parked. */
    discardParkedToFree(): SlotSnapshot {
        this._requireKind('discardParkedToFree', 'parked');
        this._gen++;
        this._state = { kind: 'free' };
        return this.snapshot();
    }

    // -----------------------------------------------------------------------
    // Non-semantic transition (does NOT bump generation)
    // -----------------------------------------------------------------------

    /** Toggle the in-session flag without changing the episode state or bumping generation. */
    setInSession(open: boolean): SlotSnapshot {
        this._inSession = open;
        return this.snapshot();
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private _requireKind(op: string, required: SlotState['kind']): void {
        if (this._state.kind !== required) {
            throw new Error(`${op}: requires state '${required}' but slot is '${this._state.kind}'`);
        }
    }
}
