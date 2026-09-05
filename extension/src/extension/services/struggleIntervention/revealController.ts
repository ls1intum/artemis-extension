import { ApiError } from '@extension/domain';

import type { StruggleInterventionDeps } from './interventionDeps';
import type { Level } from './slot/episode';

/** Delay between reveal-persist retries. The server upsert is idempotent (A10), so retries are safe. */
const REVEAL_RETRY_MS = 5_000;
/** Maximum number of reveal-persist retry attempts (~1 min at 5s). After this the bubble stays runtime-only. */
const MAX_REVEAL_RETRIES = 12;
/** Permanent server-side rejection codes. These must not be retried; only transient/5xx/network errors are retried. */
const NON_RETRIABLE_REVEAL_STATUSES = new Set([400, 403, 404, 422]);

/** What persistence needs from the orchestrator. Notably NOT the slot: see the class doc. */
export interface RevealPort {
    deps: StruggleInterventionDeps;
    /** Developer-mode diagnostic line. */
    dbg: (msg: string) => void;
    /** The pending-outcome count shows in the dev dashboard, so a write has to republish it. */
    notifyChanged: () => void;
}

/**
 * Persisting a revealed hint, and the terminal outcomes that may race it.
 *
 * These two belong together because of one contract: an outcome written before the
 * canonical chat row exists cannot be applied, so it is parked here and flushed by
 * the reveal-persist retry that eventually creates the row.
 * Splitting them would put the two halves of that handshake in different files.
 *
 * It owns the consent-epoch generation for the same reason. A revoke bumps it, and
 * every continuation past an await re-checks it, so a request in flight across the
 * boundary settles into a no-op instead of egressing hint content under withdrawn
 * consent (#349 wave 2).
 *
 * Deliberately slot-free: `revealParkedHint` on the orchestrator does the PARKED ->
 * DELIVERED transition, the watchdog re-arm and the in-flight cancel, then hands the
 * persistence here. This side never touches the slot.
 */
export class RevealController {
    /**
     * Generation counter for reveal-persist retries. Bumped by resetSession (exercise switch)
     * and by a consent revoke, to invalidate any in-flight retry closure that captured a stale
     * generation.
     */
    private _retryGen = 0;

    /**
     * Per-exercise pending terminal outcomes, keyed by episodeId. Lives above the slot so it
     * survives a slot free (teardown). Populated when setEpisodeOutcome returns applied=false
     * (canonical row not yet created). Flushed when the reveal-persist retry creates the row.
     * Cleared on resetSession (new exercise = fresh state).
     */
    private readonly _pending = new Map<string, { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }>();

    constructor(private readonly _port: RevealPort) { }

    /** The dev dashboard's counter. */
    get pendingOutcomeCount(): number { return this._pending.size; }

    /** The live map, for the package-internal test seam on the service. */
    get pendingOutcomes(): Map<string, { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }> { return this._pending; }

    /**
     * Invalidate every in-flight and scheduled reveal persist. Called on a consent revoke and on
     * an exercise switch: both mean nothing captured before now may still reach the server.
     */
    invalidateInFlight(): void { this._retryGen++; }

    clearPendingOutcomes(): void { this._pending.clear(); this._port.notifyChanged(); }

    private _setPending(episodeId: string, outcome: { outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED' }): void {
        this._pending.set(episodeId, outcome);
        this._port.notifyChanged();
    }

    private _deletePending(episodeId: string): void {
        this._pending.delete(episodeId);
        this._port.notifyChanged();
    }

    /**
     * Record the student's terminal outcome for the active episode.
     * Used in test harnesses to directly drive outcome writes with back-fill semantics.
     */
    async applyEpisodeOutcome(
        episodeId: string,
        outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED',
    ): Promise<void> {
        const exerciseId = this._port.deps.getExerciseId();
        if (exerciseId === undefined) { return; }
        const { applied } = await this._port.deps.setEpisodeOutcome(exerciseId, episodeId, outcome);
        if (!applied) {
            this._setPending(episodeId, { outcome });
            this._port.dbg(`  -> back-fill: outcome=${outcome} deferred for episodeId=${episodeId} (row not yet created)`);
        }
    }

    /**
     * Write a terminal episode outcome and record a pending back-fill entry when the canonical
     * row does not yet exist (setEpisodeOutcome returns applied=false). The flush fires in
     * _persistReveal once the reveal-persist retry creates the row.
     * Best-effort: errors are swallowed so callers never throw into a terminal teardown path.
     */
    writeOutcomeWithBackfill(
        exerciseId: number,
        episodeId: string,
        outcome: 'DISMISSED' | 'RECOVERED' | 'ABANDONED',
    ): void {
        this._port.dbg(`  -> OUTCOME ${outcome} write (episodeId=${episodeId})`);
        void this._port.deps.setEpisodeOutcome(exerciseId, episodeId, outcome)
            .then(({ applied }) => {
                if (!applied) {
                    this._setPending(episodeId, { outcome });
                    this._port.dbg(`  -> back-fill: outcome=${outcome} deferred for episodeId=${episodeId} (row not yet created)`);
                }
            })
            .catch(() => { /* best-effort */ });
    }

    /**
     * Persist the revealed hint as a canonical chat message row. On success, reconciles the optimistic
     * bubble and flushes any pending terminal outcome. On transient failure, schedules a best-effort retry.
     */
    async persistReveal(
        exerciseId: number,
        episodeId: string,
        hintText: string,
        level: Level,
        localId: string,
        courseId: number,
        sessionId: number,
        title: string,
        navToken: number,
        attempt = 0,
    ): Promise<boolean> {
        // #349 wave 2: epoch capture. Everything that happens after the await below (success
        // reconciliation, outcome flush, retry scheduling) is scoped to the consent epoch that
        // STARTED this request: a revoke bumps _revealRetryGen (as does resetSession), so a
        // request that was in flight across the boundary settles into a no-op.
        const revealGeneration = this._retryGen;
        // #349 Finding 3: never egress a reveal after a consent revoke (the retry is scheduled
        // async, so consent may have flipped since it was queued).
        if (!this._port.deps.isEgressEnabled()) {
            this._port.dbg('  -> reveal persist skipped: egress disabled (consent revoked)');
            return false;
        }
        try {
            const dto = await this._port.deps.revealAmbient(exerciseId, episodeId, hintText, level, localId);
            // #349 wave 2: post-await epoch boundary. A success that lands after a revoke (or a
            // revoke->regrant, which bumped the generation) must not reconcile the bubble, flush an
            // outcome, or navigate - return false, the episode was terminated locally.
            if (this._retryGen !== revealGeneration || !this._port.deps.isEgressEnabled()) {
                this._port.dbg('  -> reveal reply dropped: consent epoch changed during the POST');
                return false;
            }
            if (dto.id === undefined) {
                throw new Error('revealAmbient returned a DTO with no message id');
            }
            const serverId = dto.id;
            const proactiveEpisodeId = typeof dto['proactiveEpisodeId'] === 'string' ? dto['proactiveEpisodeId'] : undefined;
            const sentAt = typeof dto['sentAt'] === 'string' ? dto['sentAt'] : new Date().toISOString();
            this._port.deps.reconcileOptimisticBubble(localId, serverId, proactiveEpisodeId, sentAt);
            this._port.dbg(`  -> reveal persisted: serverId=${serverId} proactiveEpisodeId=${proactiveEpisodeId ?? 'none'}`);
            // Flush any pending terminal outcome recorded before the canonical row existed
            const pending = this._pending.get(episodeId);
            if (pending) {
                this._deletePending(episodeId);
                this._port.dbg(`  -> back-fill flush: outcome=${pending.outcome} for episodeId=${episodeId}`);
                try {
                    await this._port.deps.setEpisodeOutcome(exerciseId, episodeId, pending.outcome);
                } catch (flushErr) {
                    this._port.dbg(`  -> back-fill flush failed (best-effort): ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
                }
            }
            // #364 spec C.6: confirmed same-epoch persistence is the ONLY trigger for navigation.
            // Navigate as if the student switched to the hint's exercise, materialising the persisted
            // row via the A0-preserved reload. Fire-and-forget (a stale navToken makes the provider
            // abort per spec A.1; the hint is persisted and shows on the student's return). The carried
            // courseId/sessionId/title/navToken were captured at reveal time (re-reading state now
            // would be unsafe: a reset/context change can have cleared or replaced it).
            void this._port.deps.openRevealSession(courseId, exerciseId, sessionId, title, navToken);
            return true;
        } catch (err) {
            if (err instanceof ApiError && NON_RETRIABLE_REVEAL_STATUSES.has(err.status)) {
                this._port.dbg(`  -> reveal persist: permanent ${err.status}, not retrying (spec §12 attrition)`);
                // #364: the reveal permanently failed; tell the student. Stay silent if the student
                // changed consent while the POST was in flight (same-epoch guard as everywhere else),
                // so a self-inflicted revoke dies quietly like the other reveal drop paths.
                if (this._retryGen === revealGeneration && this._port.deps.isEgressEnabled()) {
                    this._port.deps.notifyRevealFailed();
                }
                return false;
            }
            if (attempt >= MAX_REVEAL_RETRIES) {
                this._port.dbg(`  -> reveal persist: max retries (${MAX_REVEAL_RETRIES}) reached, giving up`);
                // #364: give-up after the retry cap; same same-epoch guard as the permanent-4xx branch.
                if (this._retryGen === revealGeneration && this._port.deps.isEgressEnabled()) {
                    this._port.deps.notifyRevealFailed();
                }
                return false;
            }
            // #349 wave 2: no retry across a consent epoch boundary. If a revoke (or a
            // revoke->regrant) happened while the request was in flight, the generation captured
            // BEFORE the request no longer matches, so scheduling a retry would smuggle stale
            // pre-revoke hint content into the new epoch. The closure also keeps the CAPTURED
            // generation (not a fresh read), so a revoke between scheduling and firing still
            // invalidates it.
            if (this._retryGen !== revealGeneration || !this._port.deps.isEgressEnabled()) {
                this._port.dbg('  -> reveal persist failed after a consent epoch change; no retry scheduled');
                return false;
            }
            this._port.dbg(`  -> reveal persist failed (attempt ${attempt + 1}/${MAX_REVEAL_RETRIES}), scheduling retry in ${REVEAL_RETRY_MS}ms`);
            const schedule = this._port.deps.setTimeoutFn ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
            schedule(() => {
                if (this._retryGen !== revealGeneration) { return; }
                // Thread the carried navigation args so the retry that first succeeds still has the
                // ORIGINAL courseId/sessionId/title/navToken for the confirmed-success navigation.
                void this.persistReveal(exerciseId, episodeId, hintText, level, localId, courseId, sessionId, title, navToken, attempt + 1);
            }, REVEAL_RETRY_MS);
        }
        // Not confirmed this attempt (transient failure -> retry scheduled). The retry caller ignores
        // this return; revealParkedHint awaits only for sequencing.
        return false;
    }
}
