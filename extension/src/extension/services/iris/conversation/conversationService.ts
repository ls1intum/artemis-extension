import * as vscode from 'vscode';

import type { IrisChatMode } from '@shared/types/apiResponses';
import type { ServerContext, SessionDetail } from '@shared/types/serverContext';
import { sameContext, summaryOfDetail } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { ApiError } from '@extension/domain';
import { LogCategory, logger } from '@extension/services/loggingService';

import type { GuardTuple } from './conversationState';
import { ConversationState } from './conversationState';
import type { TopicResolutionInput } from './topicResolution';
import { resolveTopic } from './topicResolution';

/**
 * Guard matrix. Every asynchronous chat operation states what invalidates it.
 *
 * | Operation                | Guard                                                        |
 * |--------------------------|--------------------------------------------------------------|
 * | start acquisition        | navigationGeneration only (no session id exists yet)          |
 * | course switch acquisition| navigationGeneration + requested courseId                     |
 * | new-conversation POST    | navigationGeneration + requested courseId                     |
 * | history / picker open    | navigationGeneration + requested sessionId                    |
 * | index revalidation GET   | navigationGeneration + requested sessionId (ONE attempt)      |
 * | overview refresh         | requested courseId + overviewSeq (single-flight, latest wins) |
 * | reconnect detail         | full GuardTuple (it is a load like any other)                 |
 * | send response            | { sessionId, contextRevision } captured before the POST       |
 * | ambiguous reconciliation | full GuardTuple; installs, never merges                       |
 *
 * Session-scoped operations reject on any tuple movement. Course-scoped ones
 * carry the requested courseId, because a slow course-A overview must not
 * replace course-B's list.
 */

export interface IrisConversationDeps {
    /**
     * Declares the desired subscription. SYNCHRONOUS by contract: it records the
     * intent immediately and converges in the background, so two rapid
     * navigations cannot leave the transport on the older conversation.
     */
    subscribeToSession(sessionId: number): void;
    /** Resolves the workspace exercise, or undefined when none is detected. */
    getWorkspaceExercise(): { exerciseId: number; courseId: number } | undefined;
}

export type TopicChangeOutcome =
    | { kind: 'noop' }
    | { kind: 'staged' }
    | { kind: 'unstaged' }
    | { kind: 'opened'; sessionId: number }
    /** A newer navigation superseded this one; nothing was changed. */
    | { kind: 'stale' }
    | { kind: 'rejected'; reason: 'loading' | 'cross-course' | 'send-in-flight' | 'no-course' | 'failed' };

type ProbeResult =
    | { kind: 'ok'; detail: SessionDetail; guard: GuardTuple }
    /** 400/404: the row is wrong and has been forgotten. */
    | { kind: 'gone'; error: unknown }
    /** 403/5xx/network: the conversation may still exist, so the row stays. */
    | { kind: 'failed'; error: unknown }
    | { kind: 'stale' };

export class IrisConversationService {
    public readonly state = new ConversationState();
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    private _overviewInFlight: { courseId: number; seq: number; promise: Promise<void> } | undefined;
    private _navRequestSeq = 0;
    private _navInFlight = 0;
    private _reloadWhenSendSettles = false;

    constructor(
        private readonly _api: ArtemisApiService,
        private readonly _deps: IrisConversationDeps,
    ) {}

    public get navigationInFlight(): boolean { return this._navInFlight > 0; }

    private _emit(): void { this._onDidChange.fire(); }

    /** Public form of `_emit`, for the send coordinator. */
    public notifyChanged(): void { this._emit(); }

    /**
     * The ONE commit point. Every acquisition path funnels through it, which is
     * how the websocket subscription, the course, the invisible cache and the
     * emitted snapshot stay in step. Subscribing here (and only here) is why a
     * newly opened conversation actually receives its assistant frames; the old
     * model did this inside the deleted `initializeSession`.
     *
     * It takes the ENCLOSING navigation's token and re-checks it twice: before
     * committing, and again after the subscription resolves. Two navigations
     * whose subscribe calls settle in reverse order would otherwise both commit,
     * leaving the visible conversation and the live subscription disagreeing.
     */
    private _install(detail: SessionDetail, captured: GuardTuple, isCurrent: () => boolean): boolean {
        if (!isCurrent()) { return false; }
        // ONE atomic state call. An earlier draft did `beginLoad()` here, then
        // `beginNavigation()`, then `installDetail(detail, captured)`: the
        // navigation bumps the generation, so the captured guard was already
        // invalid and installDetail returned false on EVERY install. The return
        // value was ignored, so the service reported success while leaving
        // `detail` and `committedContext` undefined for a session it had just
        // named as current.
        //
        // `captured` is reserved BEFORE the request that produced `detail`,
        // never here, for two independent reasons:
        //
        // - it carries the MUTATION guards as they stood at request start, so a
        //   stale same-session response cannot overwrite a CTXSWAP that landed
        //   while it was in flight. Capturing after the response would read the
        //   post-swap values and accept unconditionally;
        // - its load ticket records request-start ORDER, so a delayed earlier
        //   load cannot install over a later one. A ticket taken here would
        //   reflect arrival order instead, which is exactly the wrong order.
        if (!this.state.installAcquired(detail, captured)) { return false; }
        // SYNCHRONOUS declaration of intent; the transport converges in the
        // background and owns latest-wins (Task 6). It does NOT mean the STOMP
        // subscription is live, which is why the reconciliation below exists.
        this._deps.subscribeToSession(detail.sessionId);
        this._emit();
        return true;
    }

    /**
     * Called when a subscription actually becomes active, via the client's
     * `onDidResubscribe`. This is the production wiring for spec §7.7's rule
     * that a CTXSWAP can land between adopting a snapshot and the subscription
     * going live, and it covers BOTH cases with one path:
     *
     * - a reconnect, where the socket dropped and came back;
     * - a first subscribe that was delayed or retried after a throw, during
     *   which the server can repoint the session and we would simply not hear it.
     *
     * Installing the detail and then never checking again is what leaves the
     * chip showing a topic the server abandoned.
     */
    public onSubscriptionActive(sessionId: number): void {
        if (sessionId !== this.state.snapshot().currentSessionId) { return; }
        void this.reconcileCurrent();
    }

    /**
     * Wraps a whole navigation so only the newest requested one may install, and
     * so `navigationInFlight` stays true for its ENTIRE duration.
     *
     * Two rules, both load-bearing:
     *
     * 1. **One token per user-visible operation, spanning probe AND install.**
     *    An earlier draft gave `_probe` its own token. It expired when the probe
     *    returned, so `navigationInFlight` dropped to false in the window before
     *    `_install` ran. A send admitted in that window POSTs to the OLD session
     *    while the install switches the view to the new one, and the send's
     *    `upsertMessage` then writes the old conversation's message into the new
     *    conversation's transcript.
     * 2. **`_navigate` never nests.** Helpers take `isCurrent` as a parameter
     *    rather than opening their own token. A nested call would bump
     *    `_navRequestSeq` and make the outer `isCurrent()` permanently false,
     *    silently turning every outer install into a no-op.
     */
    private async _navigate<T>(run: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
        const seq = ++this._navRequestSeq;
        this._navInFlight++;
        this._emit();
        try {
            return await run(() => seq === this._navRequestSeq);
        } finally {
            this._navInFlight--;
            this._emit();
        }
    }

    /**
     * Start. One call gives id, mode, entityId, title and messages. Without a
     * detected workspace exercise this makes NO Iris session acquisition
     * request; the webview shows the cold-start course chooser (spec 5.7). The
     * dashboard course-list request is a different request and is unaffected.
     */
    public async start(workspace: { exerciseId: number; courseId: number } | undefined): Promise<void> {
        if (!workspace) { return; }
        const target: ServerContext = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: workspace.exerciseId };
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const detail = await this._api.getCurrentChat('PROGRAMMING_EXERCISE_CHAT', workspace.exerciseId, workspace.courseId);
            if (!this._install(detail, captured, isCurrent)) { return; }
            // A course session came back: it is empty by construction
            // (findOrCreateEmptyCourseSession), so staging cannot rehome content.
            if (!sameContext(detail.context, target) && this.state.contentState() === 'empty') {
                this.state.stagePending(target);
            }
            void this.refreshOverview();
            this._emit();
        });
    }

    /** Header `+`. The displayed topic carries over as pending when it is an exercise. */
    public async newConversation(): Promise<TopicChangeOutcome> {
        if (this.state.sendInFlight) { return { kind: 'rejected', reason: 'send-in-flight' }; }
        const courseId = this.state.snapshot().courseId;
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
        const carried = this.state.effectiveContext();
        return await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const fresh = await this._api.createCourseSession(courseId);
            if (!this._install(fresh, captured, isCurrent)) { return { kind: 'stale' } as const; }
            if (carried && !sameContext(carried, fresh.context)) { this.state.stagePending(carried); }
            this._emit();
            return { kind: 'opened', sessionId: fresh.sessionId } as const;
        });
    }

    /**
     * The "Reload Iris chat" escape hatch. Drops every local cache and re-reads
     * from the server: the open conversation when there is one, the start path
     * when there is not.
     */
    public async reload(): Promise<void> {
        // Must refuse while a send is unresolved. The malformed-marker branch of
        // the websocket handler calls this, and that marker arrives WHILE our own
        // POST is open, so an ungated reload would navigate mid-send and bypass
        // the dispatcher gating of spec 7.3 entirely.
        if (this.state.sendInFlight) { this._reloadWhenSendSettles = true; return; }
        const { currentSessionId, courseId } = this.state.snapshot();
        // The escape hatch drops EVERYTHING local, which is the whole point of
        // the command. `setOverview([])` alone leaves knownInvisible in place,
        // so a wedged client stays wedged.
        this.state.resetCachesForReload();
        if (currentSessionId === undefined || courseId === undefined) {
            await this.start(this._deps.getWorkspaceExercise());
            return;
        }
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const detail = await this._api.getChatSessionById(courseId, currentSessionId);
            if (!this._install(detail, captured, isCurrent)) { return; }
            void this.refreshOverview();
        });
    }

    /** Called by SendCoordinator's finally, so a deferred reload is not lost. */
    public runDeferredReload(): void {
        if (!this._reloadWhenSendSettles) { return; }
        this._reloadWhenSendSettles = false;
        this.reload().catch((error: unknown) => {
            logger.warn('Deferred Iris reload failed', LogCategory.IRIS_CHAT, error);
        });
    }

    /**
     * Topic-based. Used by the picker, the chip's remove icon and the Ask-Iris
     * commands. Never by history or the course switch: those address a
     * conversation by id and go through navigateTo.
     */
    public async resolveTopicChange(target: ServerContext, courseHint?: number): Promise<TopicChangeOutcome> {
        if (this.state.sendInFlight) { return { kind: 'rejected', reason: 'send-in-flight' }; }
        // ONE token for the whole resolution, probes and installs included. A
        // token that expired between the probe and the install would leave a
        // window in which a send is admitted against the OLD conversation while
        // the view moves to the new one, and the send's upsertMessage would then
        // write the old conversation's message into the new transcript.
        return await this._navigate((isCurrent) => this._resolveWithin(target, courseHint, isCurrent));
    }

    private async _resolveWithin(
        target: ServerContext,
        courseHint: number | undefined,
        isCurrent: () => boolean,
    ): Promise<TopicChangeOutcome> {
        // Cut 4: at most TWO passes, and the second one cannot probe again.
        // `revalidated` is set once a probe has come back with a different
        // context; the index has been corrected by then, so the re-resolution
        // can only produce `create-and-stage` (or a no-op if the correction
        // happened to satisfy the target). There is no candidate walk.
        let revalidated = false;
        for (;;) {
            const decision = resolveTopic(this._resolutionInput(target));
            switch (decision.kind) {
                case 'noop': return { kind: 'noop' };
                case 'refuse': return { kind: 'rejected', reason: decision.reason };
                case 'clear-pending': this.state.clearPending(); this._emit(); return { kind: 'unstaged' };
                case 'stage': this.state.stagePending(decision.target); this._emit(); return { kind: 'staged' };
                case 'acquire': return await this._acquireForTarget(decision.target, courseHint, isCurrent);
                case 'create-and-stage':
                    return await this._createAndStage(decision.target, courseHint, isCurrent);
                case 'open': {
                    // A second `open` can only mean the index still points at
                    // something after we already probed once. Refuse to probe
                    // again and create instead; this is what bounds the loop now
                    // that there is no exclusion set.
                    if (revalidated) { return await this._createAndStage(target, courseHint, isCurrent); }
                    const courseId = this.state.snapshot().courseId;
                    if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
                    const probe = await this._probeIn(courseId, decision.sessionId, isCurrent);
                    if (probe.kind === 'stale') { return { kind: 'stale' }; }
                    // 403/5xx/network: the conversation may still exist, so the row
                    // stays and we report rather than silently creating a duplicate.
                    // Without this branch the union is not exhausted and the file
                    // does not type-check.
                    if (probe.kind === 'failed') { return { kind: 'rejected', reason: 'failed' }; }
                    // 400/404: `_probeIn` already forgot the row, so a fresh
                    // conversation is the only remaining outcome.
                    if (probe.kind === 'gone') { revalidated = true; continue; }
                    if (!sameContext(probe.detail.context, decision.target)) {
                        // The index was a hypothesis and it was wrong: another
                        // client repointed this session. Do NOT adopt what came
                        // back; that would hand the student a conversation about
                        // a different exercise. Record the truth we just learned
                        // and start a fresh conversation instead of hunting for
                        // an older candidate (cut 4). Visible state is untouched,
                        // so contentState is still `content`.
                        this.state.updateSummary(summaryOfDetail(probe.detail));
                        revalidated = true;
                        continue;
                    }
                    if (!this._install(probe.detail, probe.guard, isCurrent)) { return { kind: 'stale' }; }
                    return { kind: 'opened', sessionId: decision.sessionId };
                }
            }
        }
    }

    /**
     * Reads a conversation WITHOUT touching visible state. This is what makes
     * revalidation safe: a mismatch, a 404 or a network failure leaves the open
     * conversation exactly as it was.
     */
    /** Takes the ENCLOSING navigation's token; it never opens one of its own. */
    private async _probeIn(courseId: number, sessionId: number, isCurrent: () => boolean): Promise<ProbeResult> {
        // Reserved before the request so the caller installs with a guard that
        // predates anything arriving while it is in flight.
        const guard = this.state.beginLoad();
        try {
            const detail = await this._api.getChatSessionById(courseId, sessionId);
            if (!isCurrent()) { return { kind: 'stale' }; }
            return { kind: 'ok', detail, guard };
        } catch (error) {
            if (!isCurrent()) { return { kind: 'stale' }; }
            // 400 (wrong course / not a chat session) and 404 (absent) mean the
            // row is wrong. 403, 5xx and network failures may be transient and
            // the conversation may still exist, so the row stays and the caller
            // reports rather than forgets.
            if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
                this._forgetSession(sessionId);
                return { kind: 'gone', error };
            }
            return { kind: 'failed', error };
        }
    }

    /**
     * Cold start: no conversation is open, so there is nothing to stage onto.
     * Acquire through `sessions/current` for the target, then stage the target
     * if a course session came back (empty by construction).
     */
    private async _acquireForTarget(
        target: ServerContext,
        courseHint: number | undefined,
        isCurrent: () => boolean,
    ): Promise<TopicChangeOutcome> {
        // The course must come from the CALLER on a cold start. Deriving it from
        // state alone yields undefined when no conversation is open, which is
        // exactly the situation this row exists for: the dashboard's "Ask Iris
        // about this exercise" knows the course, and discarding it turns the
        // command into a permanent `no-course` rejection.
        const courseId = target.mode === 'COURSE_CHAT'
            ? target.entityId
            : (courseHint ?? this.state.snapshot().courseId);
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
        const captured = this.state.beginLoad();
        const detail = await this._api.getCurrentChat(target.mode as IrisChatMode, target.entityId, courseId);
        if (!this._install(detail, captured, isCurrent)) { return { kind: 'stale' }; }
        if (!sameContext(detail.context, target) && this.state.contentState() === 'empty') {
            this.state.stagePending(target);
        }
        void this.refreshOverview();
        this._emit();
        return { kind: 'opened', sessionId: detail.sessionId };
    }

    /**
     * Fresh conversation for `target`. Extracted because cut 4 gave it a second
     * caller: a revalidation that came back with a different context creates
     * instead of walking to the next candidate.
     */
    private async _createAndStage(
        target: ServerContext,
        courseHint: number | undefined,
        isCurrent: () => boolean,
    ): Promise<TopicChangeOutcome> {
        const courseId = this.state.snapshot().courseId ?? courseHint;
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }
        const captured = this.state.beginLoad();
        const fresh = await this._api.createCourseSession(courseId);
        if (!this._install(fresh, captured, isCurrent)) { return { kind: 'stale' }; }
        if (!sameContext(target, fresh.context)) { this.state.stagePending(target); }
        this._emit();
        return { kind: 'opened', sessionId: fresh.sessionId };
    }

    private _resolutionInput(target: ServerContext): TopicResolutionInput {
        const snapshot = this.state.snapshot();
        return {
            target,
            courseId: snapshot.courseId,
            currentSessionId: snapshot.currentSessionId,
            committedContext: snapshot.committedContext,
            pendingContext: snapshot.pendingContext,
            contentState: this.state.contentState(),
            findSessionFor: (t) => this.state.findSessionFor(t),
        };
    }

    /**
     * Id-based. The history opens a conversation through this. The course
     * switch cannot: it has no session id yet, so it acquires first (see
     * `switchCourse`). Never consults the topic index.
     * It stages NOTHING: an explicit "open this conversation" outranks passive
     * detection, and cut 2 removed the saved-pending restoration that undo
     * needed.
     */
    public async navigateTo(params: { courseId: number; sessionId: number }): Promise<void> {
        if (this.state.sendInFlight) { return; }
        await this._navigate(async (isCurrent) => {
            // Reading across courses is legitimate here (a history row can name
            // course A while course B is open), so the probe's course is the
            // REQUESTED one, not the currently installed one.
            const probe = await this._probeIn(params.courseId, params.sessionId, isCurrent);
            if (probe.kind === 'stale') { return; }
            if (probe.kind === 'gone' || probe.kind === 'failed') { this._emit(); throw probe.error; }

            if (!this._install(probe.detail, probe.guard, isCurrent)) { return; }
            this._emit();
        });
    }

    /**
     * A course switch has no session id when it begins, so it cannot be a
     * navigateTo. It acquires first and installs the result, which lands on an
     * EMPTY course conversation by construction.
     */
    public async switchCourse(courseId: number): Promise<void> {
        if (this.state.sendInFlight) { return; }
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            const detail = await this._api.getCurrentChat('COURSE_CHAT', courseId, courseId);
            // setCourse clears knownInvisible; it runs inside installAcquired,
            // AFTER the request, so a failed switch does not throw away the
            // current course's cache and with it the only route to its hidden
            // conversations.
            if (!this._install(detail, captured, isCurrent)) { return; }
            void this.refreshOverview();
            this._emit();
        });
    }

    /**
     * Genuinely single-flight: a second caller joins the outstanding request
     * instead of issuing another. Both `start` and the reload command ask for a
     * refresh, and latest-wins alone would still spend two round trips on the
     * same answer. `_overviewSeq` then guards the install, because a course
     * switch can land between the request and its response.
     */
    public refreshOverview(): Promise<void> {
        const courseId = this.state.snapshot().courseId;
        if (courseId === undefined) { return Promise.resolve(); }
        // Keyed by course. A global single-flight would let a switch to course 43
        // JOIN the outstanding course-42 request, whose response is then correctly
        // discarded by the course check below, so course 43 never gets an
        // overview at all: its history stays empty and the positive lookup misses
        // conversations that exist, creating duplicates.
        if (this._overviewInFlight?.courseId === courseId) { return this._overviewInFlight.promise; }
        const seq = this.state.nextOverviewSeq();
        // `_overviewInFlight` is ONE slot, so a switch to another course
        // overwrites this entry rather than queueing beside it. The cleanup
        // below must therefore identify the request, not merely its course:
        // A1 starts, B replaces it, A2 replaces B, A1 settles, and a
        // course-equality check would clear A2's tracking. The next A refresh
        // would then issue a duplicate request while A2 is still open.
        // `seq` is unique per request, so it is the identity to compare.
        // The overview is a best-effort CACHE, and every caller fires it as
        // `void refreshOverview()`. So it catches internally and always settles
        // successfully: relying on each present and future caller to append
        // `.catch(...)` is how a 500 becomes an unhandled rejection.
        //
        // Also note the shape: the request lives in its own async method and the
        // cleanup is attached with `.finally`, so nothing reads `promise` from
        // inside its own initializer. The previous form did, and would have hit
        // the temporal dead zone if the API ever threw synchronously.
        const promise = this._runOverviewRequest(courseId, seq)
            .catch((error: unknown) => {
                logger.warn('Iris overview refresh failed', LogCategory.IRIS_CHAT, error);
            })
            .finally(() => {
                if (this._overviewInFlight?.seq === seq) { this._overviewInFlight = undefined; }
                // The course may have changed while this was in flight; the new
                // one then still needs its own request.
                const current = this.state.snapshot().courseId;
                if (current !== undefined && current !== courseId) {
                    void this.refreshOverview();
                }
            });
        this._overviewInFlight = { courseId, seq, promise };
        return promise;
    }

    private async _runOverviewRequest(courseId: number, seq: number): Promise<void> {
        const summaries = await this._api.listChatSessionsForCourse(courseId);
        if (this.state.snapshot().courseId !== courseId) { return; }
        // Course equality is not enough on its own: A starts, the student
        // switches to B and back to A, a second A request starts, and the FIRST
        // A response then arrives under a matching course and installs over the
        // newer one. Latest-request-wins as well.
        if (seq !== this.state.overviewSeq) { return; }
        this.state.setOverview(summaries);
        this._emit();
    }

    /** Removes a session the server says is not openable. */
    private _forgetSession(sessionId: number): void {
        this.state.forgetSession(sessionId);
        this._emit();
    }

    /**
     * Re-reads the CURRENT conversation without changing which one is current,
     * called by `onSubscriptionActive` when the transport confirms the
     * subscription is live. This is what catches a CTXSWAP that landed in the
     * window between adopting a snapshot and the subscription actually going
     * live: `_install` only declares the subscription intent, it does not wait
     * for it, so that window is real.
     *
     * A LOAD like any other (guard matrix: "reconnect detail"), so it goes
     * through `beginLoad` and `installDetail` directly, never `_install`: the
     * subscription is already confirmed live, so re-declaring it here would be
     * redundant and would misname this as an acquisition path. Best-effort, like
     * `refreshOverview`: the only caller fires it as `void reconcileCurrent()`,
     * so a network failure is logged, not thrown.
     */
    public async reconcileCurrent(): Promise<void> {
        const { currentSessionId, courseId } = this.state.snapshot();
        if (currentSessionId === undefined || courseId === undefined) { return; }
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            try {
                const detail = await this._api.getChatSessionById(courseId, currentSessionId);
                if (!isCurrent()) { return; }
                if (!this.state.installDetail(detail, captured)) { return; }
                this._emit();
            } catch (error) {
                logger.warn('Iris reconcile-on-resubscribe failed', LogCategory.IRIS_CHAT, error);
            }
        });
    }

    public dispose(): void {
        this._onDidChange.dispose();
        this._overviewInFlight = undefined;
    }
}
