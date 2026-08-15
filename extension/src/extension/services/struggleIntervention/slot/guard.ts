import type { SlotGeneration } from './episode';

/** Wire values for the intent field (spec §17, snake_case on the wire). */
export type Intent = 'decide' | 'confirm_close' | 'help_request';

/**
 * Snapshot captured at issue time.
 *
 * - `episodeId` + `generation`: reply-correlation pair; the inbound websocket
 *   response is accepted only if these match the live slot state.
 * - `hardEvent`: captured from the triggering alert's boundaryTypes
 *   (FM/E4/N1) because the async websocket reply does not carry
 *   boundary info; reconcile reads it back.
 * - `requestToken`: the scoped-cancel id (A6/A10); minted per POST (C3) and
 *   carried here so the in-flight identity is single-source. NOT a correlation
 *   key -- correlation stays tokenless via single-outstanding guarantee.
 */
export interface PendingStamp {
    episodeId: string;
    generation: SlotGeneration;
    hardEvent: boolean;
    /** Scoped-cancel uuid; forwarded to the server so it can cancel the exact job. */
    requestToken: string;
}

/**
 * Single-flight registry: tracks the LATEST outstanding request per intent.
 *
 * Three distinct tokens -- do not conflate:
 *   1. The local `number` token returned by `issue` -- client-local supersession
 *      only. Lets a timer callback and a button both targeting the same ask
 *      cheaply detect which one arrived first.
 *   2. `(episodeId, generation)` on the stamp -- reply-correlation + stale-drop.
 *      An inbound websocket event is applied only when these still match the
 *      live slot (at most one outstanding struggle request on the wire, so no
 *      echoed wire-token is needed).
 *   3. `requestToken` (uuid string on PendingStamp) -- scoped-cancel id only;
 *      forwarded to the server, never used for client-side correlation.
 */
export class InFlightGuard {
    private _counter = 0;
    private _latest = new Map<Intent, number>();
    private _stamps = new Map<Intent, PendingStamp>();

    /**
     * Register a new outstanding request for `intent`.
     * Returns a monotonic local token that supersedes any previous token for
     * the same intent; a subsequent `accept` with an older token returns null.
     */
    issue(intent: Intent, stamp: PendingStamp): number {
        const token = ++this._counter;
        this._latest.set(intent, token);
        this._stamps.set(intent, stamp);
        return token;
    }

    /**
     * Validate and consume a response for `intent`.
     *
     * Returns the pending `PendingStamp` (carrying `hardEvent` and `requestToken`)
     * only when ALL of the following hold:
     *   - `token` equals the LATEST issued token for that intent (supersession guard).
     *   - `stamp.episodeId === expectedEpisodeId` (stale-drop: slot moved on).
     *   - `stamp.generation === expectedGeneration` (stale-drop: generation changed).
     *
     * Returns null on any mismatch.
     */
    accept(intent: Intent, token: number, expectedEpisodeId: string, expectedGeneration: SlotGeneration): PendingStamp | null {
        const latest = this._latest.get(intent);
        if (latest === undefined || latest !== token) {
            return null;
        }
        const stamp = this._stamps.get(intent);
        if (stamp === undefined) {
            return null;
        }
        if (stamp.episodeId !== expectedEpisodeId || stamp.generation !== expectedGeneration) {
            return null;
        }
        return stamp;
    }

    /** Clear the outstanding request for `intent` (e.g. on slot free). */
    cancel(intent: Intent): void {
        this._latest.delete(intent);
        this._stamps.delete(intent);
    }
}

