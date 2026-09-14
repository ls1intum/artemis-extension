import type { ProactiveLevel } from '@shared/messageContracts';

import type { StruggleInterventionDeps } from './interventionDeps';
import type { SlotSnapshot } from './slot/slotManager';

/** The single offer awaiting an answer. Shape kept as it was on the orchestrator. */
export interface OutstandingOffer {
    offerId: string;
    episodeId: string;
    moment: 'stuck' | 'abandon';
}

/**
 * What the offers need from the rest of the orchestrator, named rather than reached for.
 *
 * Deliberately narrow: offers read the slot and the wire, and they can ask for a
 * follow-up hint, but they must not be able to drive the slot themselves. That is
 * the whole reason this is a port and not a reference to the service.
 */
export interface OfferPort {
    deps: StruggleInterventionDeps;
    slotSnapshot: () => SlotSnapshot;
    /** The DELIVERED episode's id, or undefined when the slot is not delivered. */
    deliveredEpisodeId: () => string | undefined;
    /** True while a struggle POST is outstanding. Offers never queue behind one. */
    isWireBusy: () => boolean;
    /** The student answered, so they are present: push the idle deadline out. */
    resetWatchdogProgress: () => void;
    /** Deliver the accepted follow-up hint (single-flight, owned by the egress path). */
    sendHelpRequest: () => void;
}

/**
 * The proactive help offers: Moment-1 "still stuck?" and Moment-3 "still on this?".
 *
 * Its own unit because it owns three pieces of state that nothing else writes
 * (the per-episode accepted count, the declined set, and the single outstanding
 * offer) and because the level-and-visibility matrix below is a product rule in
 * its own right: Off never offers, Less offers only where the student can
 * actually answer, More may fall back to a banner plus a badge.
 */
export class OfferController {
    /** Per-episode accepted-offer count (the cap: Less 1 / More 3). The opening hint is NOT counted. */
    readonly offeredHintCounts = new Map<string, number>();

    /** Episodes for which a Moment-1 stuck offer was declined (no re-offer for that episode). */
    readonly offersDeclined = new Set<string>();

    /** The single in-flight offer awaiting an answer (accept/decline/timeout), if any. */
    outstanding: OutstandingOffer | undefined;

    constructor(private readonly _port: OfferPort) { }

    private _capForLevel(level: ProactiveLevel): number {
        return level === 'more' ? 3 : level === 'less' ? 1 : 0;
    }

    canOfferStuck(episodeId: string): boolean {
        if (this.offersDeclined.has(episodeId)) { return false; }
        const level = this._port.deps.getProactiveLevel();
        return (this.offeredHintCounts.get(episodeId) ?? 0) < this._capForLevel(level);
    }

    canRaiseStuckOfferNow(episodeId: string): boolean {
        return this.outstanding === undefined && !this._port.isWireBusy() && this.canOfferStuck(episodeId);
    }

    /** Count one delivered follow-up against the episode's cap. */
    countAcceptedHint(episodeId: string): void {
        this.offeredHintCounts.set(episodeId, (this.offeredHintCounts.get(episodeId) ?? 0) + 1);
    }

    /** Resolve (as timeout) + clear any outstanding offer. Idempotent. Used on teardown, supersede, opt-out. */
    clearOutstanding(): void {
        if (this.outstanding) {
            this._port.deps.resolveOfferBubble(this.outstanding.offerId, 'timeout');
            this.outstanding = undefined;
        }
    }

    /** Forget every offer this exercise ever made. Called from the new-exercise teardown. */
    resetForNewExercise(): void {
        this.offeredHintCounts.clear();
        this.offersDeclined.clear();
        this.outstanding = undefined;
    }

    raiseStuckOffer(): void {
        const snap = this._port.slotSnapshot();
        if (snap.state.kind !== 'delivered') { return; }
        const episodeId = snap.state.episode.episodeId;
        const level = this._port.deps.getProactiveLevel();
        // Off = 0 offers. raiseStuckOffer is already gated upstream via suppressReason, but keep
        // this guard for defence and symmetry with raiseAbandonOffer.
        if (level === 'off') { return; }
        // Less + chat closed: stay fully quiet. A badge-only offer can never be answered (opening the
        // chat later does not surface it) and would strand the single-offer slot -- so skip it entirely.
        if (!snap.inSession && level === 'less') { return; }
        this._raise(episodeId, 'stuck', snap.inSession);
    }

    /** Moment-3 "Still on this?" presence check (60s before the idle-abandon force-free). */
    raiseAbandonOffer(episodeId: string): void {
        const level = this._port.deps.getProactiveLevel();
        // Off = 0 offers.
        if (level === 'off') { return; }
        const inSession = this._port.slotSnapshot().inSession;
        // Less + chat closed: stay fully quiet (see raiseStuckOffer).
        if (!inSession && level === 'less') { return; }
        this._raise(episodeId, 'abandon', inSession);
    }

    /**
     * The one place an offer becomes visible. In-session it is a chat bubble the student can
     * answer inline; out of session only More gets here (both callers screen Less out above),
     * and it becomes a banner plus a badge.
     */
    private _raise(episodeId: string, moment: 'stuck' | 'abandon', inSession: boolean): void {
        const offerId = crypto.randomUUID();
        this.outstanding = { offerId, episodeId, moment };
        if (inSession) {
            this._port.deps.postOfferBubble({ offerId, episodeId, moment });
        } else {
            this._port.deps.showOfferBanner({ offerId, episodeId, moment });   // level === 'more' here
            this._port.deps.setBadge(true);
        }
    }

    /** Every answer applies to the outstanding offer on the live episode, and nothing else. */
    private _isAnswerable(offerId: string, episodeId: string): boolean {
        return this.outstanding?.offerId === offerId && episodeId === this._port.deliveredEpisodeId();
    }

    /** Moment-1 "Show me": generate + deliver the next hint. Guarded to the outstanding offer + live episode. */
    accept(offerId: string, episodeId: string): void {
        if (!this._isAnswerable(offerId, episodeId)) { return; }
        // A request is already in flight (e.g. a concurrent escalation decide): single-flight
        // sendHelpRequest would drop this. Leave the offer outstanding for a retry rather than
        // resolving to a false "accepted" with no follow-up hint.
        if (this._port.isWireBusy()) { return; }
        this.outstanding = undefined;
        this._port.deps.resolveOfferBubble(offerId, 'accept');
        this._port.sendHelpRequest();
    }

    /** Moment-1 "Not now": quiet for this episode. */
    decline(offerId: string, episodeId: string): void {
        if (!this._isAnswerable(offerId, episodeId)) { return; }
        this.outstanding = undefined;
        this.offersDeclined.add(episodeId);
        this._port.deps.resolveOfferBubble(offerId, 'decline');
    }

    /**
     * A stuck offer's out-of-session banner auto-closed (ignored). Clear the outstanding offer so a later
     * alert may offer again (spec: "Ignored -> short cooldown, may offer again"); NOT added to declined.
     * (An in-session stuck bubble has no countdown, so this only fires for the banner path.)
     */
    timedOut(offerId: string, episodeId: string): void {
        if (!this._isAnswerable(offerId, episodeId)) { return; }
        this.outstanding = undefined;
        this._port.deps.resolveOfferBubble(offerId, 'timeout');
    }

    /** Moment-3 "I'm still on it": keep watching, reset the idle clock, no hint, no POST. */
    stillOnIt(offerId: string, episodeId: string): void {
        if (!this._isAnswerable(offerId, episodeId)) { return; }
        this.outstanding = undefined;
        this._port.deps.resolveOfferBubble(offerId, 'decline');
        this._port.resetWatchdogProgress();
    }

    /** Moment-3 "I need more help": deliver on demand, overriding an exhausted cap; reset idle. */
    needMoreHelp(offerId: string, episodeId: string): void {
        if (!this._isAnswerable(offerId, episodeId)) { return; }
        this._port.resetWatchdogProgress();   // student is present -> keep the episode alive even if the send defers
        if (this._port.isWireBusy()) { return; }   // in flight: leave the offer outstanding for a retry
        this.outstanding = undefined;
        this._port.deps.resolveOfferBubble(offerId, 'accept');
        this._port.sendHelpRequest();
    }
}
