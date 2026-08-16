import type { IrisChatMessage } from '@shared/types/apiResponses';
import type { ServerContext, SessionDetail, SessionSummary } from '@shared/types/serverContext';
import { sameContext, summaryOfDetail } from '@shared/types/serverContext';

import type { ContextSwap } from '@extension/services/iris/context/contextMarkers';
import { isContextSwap } from '@extension/services/iris/context/contextMarkers';

/**
 * `unknown` is NOT `empty`. It holds while no detail for the current session is
 * installed. The topic controls (the picker, the chip's remove icon, the
 * Ask-Iris commands) stay disabled while it holds: without the transcript we
 * cannot tell a real change from a no-op.
 */
export type ContentState = 'unknown' | 'empty' | 'content';

/**
 * Captured at the start of every asynchronous chat operation and compared on
 * its result. Two context-free counters are not enough: a revision earned in
 * conversation B would otherwise look causally newer than intent formed in A.
 */
export interface GuardTuple {
    sessionId: number | undefined;
    navigationGeneration: number;
    contextRevision: number;
    sendSeq: number;
    /**
     * Issued by `beginLoad()` at REQUEST START, not read from state. Two loads
     * that start while nothing else moves get different tickets, and only a
     * strictly newer ticket may install. Reading a counter off the state at
     * capture time cannot do this: both loads would read the same value, and
     * whichever answered first would win by accident.
     */
    loadTicket: number;
}

interface PendingContext {
    ctx: ServerContext;
    sessionId: number;
    baseRevision: number;
}

interface ConversationSnapshot {
    courseId: number | undefined;
    currentSessionId: number | undefined;
    detail: SessionDetail | undefined;
    committedContext: ServerContext | undefined;
    pendingContext: PendingContext | undefined;
    courseSessions: SessionSummary[];
    knownInvisible: SessionSummary[];
}

type SwapOutcome = 'pending-satisfied' | 'pending-dropped' | 'pending-kept' | 'no-pending';

/**
 * Only the overview endpoint returns `entityName`; every DETAIL load builds
 * its context from mode and entityId alone. Merging a detail-derived summary
 * over an overview row would therefore discard the name, and the row the
 * student just clicked would lose the very label they clicked.
 *
 * Kept only when the incoming context names the SAME topic. A CTXSWAP
 * changes the topic without changing the conversation, and it must not
 * inherit the previous exercise's name.
 */
function keepKnownName(previous: ServerContext | undefined, next: ServerContext): ServerContext {
    if (next.name !== undefined) { return next; }
    if (!previous?.name || !sameContext(previous, next)) { return next; }
    return { ...next, name: previous.name };
}

export class ConversationState {
    private _courseId: number | undefined;
    private _currentSessionId: number | undefined;
    private _detail: SessionDetail | undefined;
    private _committed: ServerContext | undefined;
    private _pending: PendingContext | undefined;
    private _courseSessions: SessionSummary[] = [];
    private readonly _knownInvisible = new Map<number, SessionSummary>();

    private _navigationGeneration = 0;
    private _contextRevision = 0;
    private _sendSeq = 0;
    private _nextLoadTicket = 1;
    private _lastInstalledTicket = 0;
    private _overviewSeq = 0;
    /**
     * Bumped by the service before each overview request, and compared by the
     * service when the response lands, so an older request cannot install over
     * a newer one for the same course.
     */
    public nextOverviewSeq(): number { return ++this._overviewSeq; }
    public get overviewSeq(): number { return this._overviewSeq; }
    private _sendInFlight = false;
    private _optimisticBubble = false;

    /**
     * Captures the guard for a NON-load operation (a send, a subscription). Its
     * `loadTicket` is `0`, which no install can use.
     */
    public guard(): GuardTuple {
        return {
            sessionId: this._currentSessionId,
            navigationGeneration: this._navigationGeneration,
            contextRevision: this._contextRevision,
            sendSeq: this._sendSeq,
            loadTicket: 0,
        };
    }

    /** Call this immediately BEFORE issuing a detail request, never after it. */
    public beginLoad(): GuardTuple {
        return { ...this.guard(), loadTicket: this._nextLoadTicket++ };
    }

    /**
     * A load is an OBSERVATION: an observation that started before a mutation is
     * not newer than it. So a result is installed only if nothing moved since it
     * began, AND its ticket is strictly newer than the last installed one, so a
     * delayed earlier load cannot overwrite a later one.
     */
    public accepts(captured: GuardTuple): boolean {
        return captured.sessionId === this._currentSessionId
            && captured.navigationGeneration === this._navigationGeneration
            && captured.contextRevision === this._contextRevision
            && captured.sendSeq === this._sendSeq
            && captured.loadTicket > this._lastInstalledTicket;
    }

    /**
     * Announces that we are moving to `sessionId`. Resets the per-session
     * counters, drops the detail (content becomes `unknown`) and invalidates
     * every guard captured for the previous conversation.
     */
    public beginNavigation(sessionId: number | undefined): number {
        this._navigationGeneration++;
        // Only a change of conversation discards the transcript. Re-acquiring the
        // SAME session (reload, revalidation, a repeat open) must keep it, or the
        // merge below has nothing to carry and every same-session install silently
        // deletes any message that arrived while the request was in flight.
        const sameSession = sessionId !== undefined && sessionId === this._currentSessionId;
        this._currentSessionId = sessionId;
        if (!sameSession) {
            this._detail = undefined;
        }
        this._committed = undefined;
        this._contextRevision = 0;
        this._sendSeq = 0;
        // Per session: the next conversation's first load must be installable.
        // Loads still in flight for the PREVIOUS session are already rejected by
        // the navigation generation, so lowering this cannot let one through.
        this._lastInstalledTicket = 0;
        this._optimisticBubble = false;
        // Intent formed in another conversation has no standing here.
        if (this._pending && this._pending.sessionId !== sessionId) {
            this._pending = undefined;
        }
        return this._navigationGeneration;
    }

    public get navigationGeneration(): number { return this._navigationGeneration; }

    public setCourse(courseId: number | undefined): void {
        if (this._courseId === courseId) { return; }
        this._courseId = courseId;
        this._courseSessions = [];
        // Which sessions exist is course-scoped; carrying the cache across
        // courses would let a stale id answer a lookup in the wrong course.
        this._knownInvisible.clear();
    }

    /** A reconnect changes nothing about which sessions exist. */
    public noteReconnect(): void { /* deliberately empty; documents the decision */ }

    /** Drops every local cache. The "Reload Iris chat" escape hatch. */
    public resetCachesForReload(): void {
        this._courseSessions = [];
        this._knownInvisible.clear();
        // `_detail` deliberately SURVIVES until the fresh detail installs over
        // it. `upsertMessage` returns immediately when `_detail` is undefined,
        // so clearing it here would drop any USER or LLM frame arriving during
        // the reload GET and report `empty` while the student is looking at
        // their own message. A failed reload would also leave `contentState`
        // stuck at `unknown` forever.
    }

    /**
     * An identity boundary. Unlike a reload this drops the conversation itself:
     * a session id, a transcript and a course from the previous account name
     * nothing here. `beginNavigation(undefined)` does most of it (it bumps the
     * navigation generation, so every request already in flight is refused when
     * it lands), and `setCourse(undefined)` drops the course-scoped indexes.
     */
    public resetForSessionChange(): void {
        this.beginNavigation(undefined);
        this.setCourse(undefined);
        // A POST that outlives the identity change will fail on the server
        // anyway; leaving the flag set would lock every navigation forever.
        this._sendInFlight = false;
        this._optimisticBubble = false;
    }

    /** Drops a session from both index sources after a 400/404 open. */
    public forgetSession(sessionId: number): void {
        this._courseSessions = this._courseSessions.filter((s) => s.sessionId !== sessionId);
        this._knownInvisible.delete(sessionId);
    }

    /**
     * Returns false when the guard failed and nothing was written. The guard is
     * checked unconditionally, including when `captured.sessionId` is
     * `undefined`: an acquisition that started before a `beginNavigation` must
     * not install afterwards just because it had no session id to name.
     * `undefined === undefined` already lets a legitimate cold start through.
     */
    public installDetail(detail: SessionDetail, captured: GuardTuple): boolean {
        if (!this.accepts(captured)) { return false; }
        if (this._currentSessionId !== undefined && detail.sessionId !== this._currentSessionId) { return false; }

        this._currentSessionId = detail.sessionId;
        // THROUGH setCourse, not a direct assignment. Assigning `_courseId`
        // changes the course while `_courseSessions` and `_knownInvisible`
        // still hold the previous course's sessions, so the history would offer
        // rows from the course we just left.
        this.setCourse(detail.courseId);
        // MONOTONIC UNION by server message id. A load reads a snapshot taken at
        // request time, so a message that arrived AFTER the request began is
        // newer than that snapshot even though it moved no guard counter; a
        // replacing install would silently delete it. The union never removes,
        // so that loss is impossible by construction.
        //
        // The cost, accepted: a message the server deleted survives locally
        // until a reload or a restart. That error only ever makes a conversation
        // look MORE full than it is, and the only decision keyed on `empty` is
        // the automatic staging on acquisition, which then simply does not
        // happen.
        //
        // Spread, not replace: a locally known frame may be partial (a resend
        // that only attaches activities), and the response may carry fields it
        // lacks, so the two are merged field-wise with the local copy winning.
        const known = new Map<number, IrisChatMessage>();
        if (this._detail?.sessionId === detail.sessionId) {
            for (const m of this._detail.messages) {
                if (typeof m.id === 'number') { known.set(m.id, m); }
            }
        }
        const merged = detail.messages.map((m) =>
            (typeof m.id === 'number' && known.has(m.id)) ? { ...m, ...known.get(m.id)! } : m);
        for (const [id, m] of known) {
            if (!detail.messages.some((sm) => sm.id === id)) { merged.push(m); }
        }
        this._detail = { ...detail, messages: merged };
        const previouslyCommitted = this._committed;
        this._committed = detail.context;
        this._lastInstalledTicket = captured.loadTicket;
        this._optimisticBubble = false;

        // Three ways a staging dies on an install: it belongs to another
        // conversation, the detail already carries it (the send landed and the
        // server committed it), or the detail reveals a context we never
        // committed. The last one is a repoint by someone else, discovered by a
        // read rather than by a marker, and it has to have the same effect as
        // the marker would: our staging predates it and now contradicts it.
        // `previouslyCommitted` is undefined on an acquisition, where
        // `beginNavigation` has just cleared it and there is nothing to compare.
        const movedUnderUs = previouslyCommitted !== undefined && !sameContext(previouslyCommitted, detail.context);
        if (this._pending && (this._pending.sessionId !== detail.sessionId || sameContext(this._pending.ctx, detail.context) || movedUnderUs)) {
            this._pending = undefined;
        }
        // A repoint learned from a READ is the same event as one learned from a
        // marker, so it must invalidate the same guards. Without this bump a
        // send whose response is still outstanding passes the revision check in
        // `_commitWriteBack` and writes the context it sent over the newer truth
        // we just installed.
        if (movedUnderUs) { this._contextRevision++; }
        this._rememberFromDetail(detail);
        return true;
    }

    /**
     * Atomic acquisition: switch to `detail.sessionId` and install it in one
     * step, guarded only by the ticket reserved before the request.
     *
     * Splitting this into `beginNavigation` then `installDetail` cannot work:
     * the navigation invalidates any guard captured before it, and any guard
     * captured after it is tautological.
     */
    public installAcquired(detail: SessionDetail, captured: GuardTuple): boolean {
        if (detail.sessionId === this._currentSessionId) {
            // Same conversation: this is an ORDINARY LOAD and the FULL guard
            // applies. Guarding it by the ticket alone reintroduces exactly the
            // race the context guard exists for: a CTXSWAP moves the session to
            // E7 while the GET is in flight, the response carries the older E5,
            // and a ticket-only check installs E5 over it. The transcript would
            // then show a marker announcing E7 next to a committed topic of E5.
            return this.installDetail(detail, captured);
        }
        // Different conversation. The per-session counters are not comparable
        // across sessions, so the caller's navigation token is what authorises
        // this; `_install` checks it immediately before calling, synchronously.
        this.beginNavigation(detail.sessionId);
        return this.installDetail(detail, { ...this.guard(), loadTicket: captured.loadTicket });
    }

    /**
     * Records a message that arrived AFTER the detail load: the persisted user
     * message from a send response, an assistant or ARTIFACT frame, and the
     * CTXSWAP marker. Without this, `contentState()` reports `empty` for a
     * conversation the student has already written in, and the message count,
     * the in-flight union and the marker handling all read a transcript that is
     * missing its newest rows.
     *
     * Deduplicated by server id, because the same message reaches us twice: once
     * in the POST response and once as a websocket frame.
     */
    public upsertMessage(message: IrisChatMessage): void {
        if (!this._detail) { return; }
        // Keep the detail canonical for activity too, or `setOverview`'s
        // re-derivation of the current row would hand back a value older than
        // what we already know and the history would sort backwards.
        const at = message.sentAt ? Date.parse(message.sentAt) : NaN;
        if (!Number.isNaN(at) && at > this._detail.lastActivity) {
            this._detail = { ...this._detail, lastActivity: at };
        }
        if (typeof message.id === 'number') {
            const existing = this._detail.messages.findIndex((m) => m.id === message.id);
            if (existing >= 0) {
                this._detail.messages[existing] = { ...this._detail.messages[existing], ...message };
                return;
            }
        }
        this._detail.messages.push(message);
    }

    /**
     * Installs an overview response. Latest-request-wins for the course as a
     * whole is the SERVICE's job (`_overviewSeq`); the only per-row rule left
     * here is that the response may not contradict the OPEN conversation.
     *
     * A CTXSWAP can land while an overview is in flight, and the response then
     * describes the old topic, but for the current conversation the loaded
     * detail is authoritative and simply re-derives its row. Other conversations
     * are allowed to be briefly stale; that is how the cache learns about
     * repoints it never saw.
     */
    public setOverview(summaries: SessionSummary[]): void {
        this._courseSessions = summaries;
        for (const summary of summaries) {
            this._knownInvisible.delete(summary.sessionId);
        }
        // The open conversation's row comes from the detail, in the SAME
        // collection the history reads. Applying this only at render time would
        // leave the stored row claiming a topic the conversation no longer
        // holds.
        if (this._detail && this._detail.sessionId === this._currentSessionId) {
            const fromOverview = summaries.find((s) => s.sessionId === this._detail!.sessionId);
            this.updateSummary({
                ...summaryOfDetail(this._detail),
                // MAX, not the detail's value. The detail is canonical for the
                // topic and the title, but activity only ever moves forward and
                // the two sources learn about it independently: the server may
                // have counted a message we have not seen, and we may have seen
                // one it had not counted when the request was answered. Taking
                // the detail's value alone would let an overview response walk
                // the history sort order backwards.
                lastActivity: Math.max(this._detail.lastActivity, fromOverview?.lastActivity ?? 0),
            });
        }
    }

    public rememberInvisible(summary: SessionSummary): void {
        this._knownInvisible.set(summary.sessionId, summary);
    }

    /**
     * ENTERS the session when it is not in the overview, and UPDATES it when it
     * already is, so a cached summary can never contradict authoritative state.
     * Entering (not merely updating) is what makes every acquisition path -
     * start, history open, new conversation, course switch - remember a
     * proactive-only conversation the USER-only overview hides. Only updating an
     * existing entry loses exactly those conversations.
     */
    private _rememberFromDetail(detail: SessionDetail): void {
        this.updateSummary(summaryOfDetail(detail));
    }

    /**
     * The single place a summary is written. It updates the entry WHEREVER the
     * session currently lives and enters it into the invisible cache only when
     * the overview does not list it. Two separate paths (one that updated the
     * overview row, one that added an invisible entry) could leave the same
     * session recorded twice with contradictory topics, so history and lookup
     * would disagree about the same conversation.
     */
    public updateSummary(summary: SessionSummary): void {
        const previous = this._courseSessions.find((s) => s.sessionId === summary.sessionId)
            ?? this._knownInvisible.get(summary.sessionId);
        const merged: SessionSummary = { ...summary, context: keepKnownName(previous?.context, summary.context) };
        const index = this._courseSessions.findIndex((s) => s.sessionId === merged.sessionId);
        if (index >= 0) {
            this._courseSessions = [
                ...this._courseSessions.slice(0, index),
                { ...this._courseSessions[index], ...merged },
                ...this._courseSessions.slice(index + 1),
            ];
            this._knownInvisible.delete(merged.sessionId);
            return;
        }
        this.rememberInvisible({ ...this._knownInvisible.get(merged.sessionId), ...merged });
    }

    /** Title changes are a summary lifecycle event, like context changes. */
    public setTitle(title: string): void {
        if (!this._detail) { return; }
        this._detail = { ...this._detail, title };
        this.updateSummary({ ...summaryOfDetail(this._detail) });
    }

    public effectiveContext(): ServerContext | undefined {
        return this._pending?.ctx ?? this._committed;
    }

    public stagePending(ctx: ServerContext): void {
        if (this._currentSessionId === undefined) { return; }
        if (sameContext(ctx, this._committed)) {
            this._pending = undefined;
            return;
        }
        this._pending = { ctx, sessionId: this._currentSessionId, baseRevision: this._contextRevision };
    }

    public clearPending(): void { this._pending = undefined; }

    /**
     * Applies an accepted CTXSWAP frame. Bumps `contextRevision`, so every load
     * in flight is invalidated: a frame is pushed at mutation time and is
     * therefore always newer than anything already on the wire.
     *
     * `markerMessage` is the persisted CTXSWAP row and MUST be appended: it is
     * what makes the switch visible in the transcript.
     *
     * A divergent staging dies here, EXCEPT when the marker only repeats the
     * context we already committed: that one is our own send's marker arriving
     * after the write-back applied it, and it may not outrank a pick made since.
     */
    public applyContextSwap(swap: ContextSwap, markerMessage: IrisChatMessage): SwapOutcome {
        const next: ServerContext = swap.context
            // `removed` carries no entity fields, so derive the course context.
            ?? { mode: 'COURSE_CHAT', entityId: this._courseId ?? 0 };
        // A marker for the context we ALREADY hold changes nothing about the
        // topic. It is our own send's marker arriving after the write-back
        // already applied it, and by then the student may have staged something
        // newer. See the pending handling at the end.
        const confirmsWhatWeHold = this._committed !== undefined && sameContext(this._committed, next);
        this._committed = next;
        this._contextRevision++;
        // The detail and the cached summary must move with it, or the history
        // row keeps claiming the old topic while the chip shows the new one.
        if (this._detail) { this._detail = { ...this._detail, context: next }; }
        // The marker's own timestamp, not the stale detail's: this IS the most
        // recent activity on the conversation, and the history sorts on it.
        const markerAt = markerMessage.sentAt ? Date.parse(markerMessage.sentAt) : NaN;
        this.updateSummary({
            sessionId: this._currentSessionId!,
            courseId: this._courseId!,
            context: next,
            title: this._detail?.title,
            lastActivity: Number.isNaN(markerAt) ? (this._detail?.lastActivity ?? 0) : markerAt,
        });
        this.upsertMessage(markerMessage);

        if (!this._pending) { return 'no-pending'; }
        if (sameContext(this._pending.ctx, next)) {
            this._pending = undefined;
            return 'pending-satisfied';
        }
        // A marker that only confirms what we already committed carries no
        // instruction, so it cannot outrank a staging formed after it. Dropping
        // here would silently undo the student's newer pick AND tell them the
        // topic was changed elsewhere, which it was not.
        if (confirmsWhatWeHold) { return 'pending-kept'; }
        // Otherwise the topic was just set by someone else (another client, or
        // Artemis repointing after a build result). Our staging was formed
        // before that and now contradicts it, so it is intent the student would
        // have to re-express deliberately.
        this._pending = undefined;
        return 'pending-dropped';
    }

    /**
     * The send coordinator's write-back. Installs EXACTLY the context that
     * was attached to the POST, never whatever happens to be pending now: the
     * caller has already decided (via the context-revision guard) that
     * nothing moved since the send captured it.
     *
     * Mirrors `applyContextSwap`: the detail and the cached summary must move
     * with it, or the history row keeps claiming the old topic while the chip
     * shows the new one, and the next `refreshOverview` re-derives the open row
     * from the stale detail and re-stamps the old topic. This covers the window
     * before the server's own CTXSWAP frame arrives, which is exactly the case
     * when the socket is down and this write-back is all that runs. There is no
     * marker message here, so unlike `applyContextSwap` the cached summary's
     * `lastActivity` is left as it already was.
     */
    public commitContext(ctx: ServerContext): void {
        this._committed = ctx;
        if (this._detail) { this._detail = { ...this._detail, context: ctx }; }
        if (this._currentSessionId !== undefined && this._courseId !== undefined) {
            this.updateSummary({
                sessionId: this._currentSessionId,
                courseId: this._courseId,
                context: ctx,
                title: this._detail?.title,
                lastActivity: this._detail?.lastActivity ?? 0,
            });
        }
        if (this._pending && sameContext(this._pending.ctx, ctx)) {
            this._pending = undefined;
        }
    }

    public get sendInFlight(): boolean { return this._sendInFlight; }
    public beginSend(): void { this._sendInFlight = true; }
    /** Call once the send's result is FULLY processed, reconciliation included. */
    public endSend(): void { this._sendInFlight = false; this._sendSeq++; }
    public setOptimisticBubble(present: boolean): void { this._optimisticBubble = present; }

    public contentState(): ContentState {
        if (this._optimisticBubble) { return 'content'; }
        if (!this._detail || this._detail.sessionId !== this._currentSessionId) { return 'unknown'; }
        return this._detail.messages.length > 0 ? 'content' : 'empty';
    }

    /** Display value only. NEVER a content predicate: it hides markers. */
    public displayMessageCount(): number {
        return (this._detail?.messages ?? []).filter((m: IrisChatMessage) => !isContextSwap(m)).length;
    }

    public snapshot(): ConversationSnapshot {
        return {
            courseId: this._courseId,
            currentSessionId: this._currentSessionId,
            detail: this._detail,
            committedContext: this._committed,
            pendingContext: this._pending,
            courseSessions: this._courseSessions,
            knownInvisible: [...this._knownInvisible.values()],
        };
    }
}
