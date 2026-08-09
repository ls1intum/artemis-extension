import * as vscode from 'vscode';

import type { IrisChatMode } from '@shared/types/apiResponses';
import type { ServerContext, SessionDetail } from '@shared/types/serverContext';
import { sameContext } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { ApiError, isIrisCourseDisabled } from '@extension/domain';
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
 * | overview refresh         | requested courseId + overviewSeq (single-flight, latest wins) |
 * | reconnect detail         | full GuardTuple (it is a load like any other)                 |
 * | send response            | { sessionId, contextRevision } captured before the POST       |
 * | ambiguous reconciliation | full GuardTuple; installs, never merges                       |
 *
 * Session-scoped operations reject on any tuple movement. Course-scoped ones
 * carry the requested courseId, because a slow course-A overview must not
 * replace course-B's list.
 */

interface IrisConversationDeps {
    /**
     * Declares the desired subscription. SYNCHRONOUS by contract: it records the
     * intent immediately and converges in the background, so two rapid
     * navigations cannot leave the transport on the older conversation.
     *
     * The production adapter wired in `chatWebviewProvider.ts` delegates to
     * `IrisWebSocketSessionClient.subscribeToSession`, whose `_converge` loop
     * provides exactly this: it records `_desiredSessionId` synchronously and
     * is not rate-limited for a deliberate navigation.
     */
    subscribeToSession(sessionId: number): void;
    /**
     * Stops following the current conversation without intending another. Only
     * entering a course that has none needs this: `subscribeToSession` records
     * an intent, and leaving that intent in place makes the next reconnect
     * resubscribe to a conversation we have left.
     */
    leaveSession(): void;
    /** Resolves the workspace exercise, or undefined when none is detected. */
    getWorkspaceExercise(): { exerciseId: number; courseId: number } | undefined;
    /**
     * Renders an installed conversation's transcript.
     *
     * Every install goes through it, which is what makes "the conversation
     * model owns the transcript" true rather than aspirational: the service is
     * the only thing that knows a conversation was just adopted, and a caller
     * that has to remember to render afterwards is a caller that will forget on
     * one of the six paths.
     *
     * `mode: 'load'` REPLACES the visible transcript (a fresh install: the
     * student is now looking at a different conversation, or at a re-read of
     * this one). `mode: 'merge'` folds the rows in by id and is used by
     * reconnect reconciliation, which must not wipe an optimistic bubble or a
     * live draft.
     */
    deliverTranscript(detail: SessionDetail, mode: 'load' | 'merge'): void;
}

export type TopicChangeOutcome =
    | { kind: 'noop' }
    | { kind: 'staged' }
    | { kind: 'unstaged' }
    | { kind: 'opened'; sessionId: number }
    /**
     * We are now IN the target's course, which has Iris switched off, so there
     * is no conversation and nothing was staged. Not a rejection: the move the
     * student asked for happened, and the persistent banner already explains
     * the rest. Callers must not add a retry prompt on top of it.
     */
    | { kind: 'course-disabled' }
    /** A newer navigation superseded this one; nothing was changed. */
    | { kind: 'stale' }
    | { kind: 'rejected'; reason: 'loading' | 'cross-course' | 'send-in-flight' | 'no-course' | 'failed' };

/** What a course switch did. `disabled` still moved us; see the kind above. */
export type CourseSwitchOutcome =
    | { kind: 'opened'; sessionId: number }
    | { kind: 'disabled' }
    | { kind: 'stale' }
    | { kind: 'rejected'; reason: 'send-in-flight' | 'failed' };

/**
 * What the cold start did. `disabled` still landed us in the course, same as
 * `CourseSwitchOutcome`'s kind above; it is a definitive answer, not a
 * failure, so `start` reports it instead of throwing. Every OTHER problem
 * (network, 5xx, ...) still throws: those are transient and the caller's
 * retry has to keep working.
 */
export type StartOutcome =
    | { kind: 'ok' }
    | { kind: 'disabled' }
    | { kind: 'stale' };

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

    /**
     * The latest-navigation token, for callers that have to survive an async gap
     * and then ask "did the student navigate away meanwhile?".
     *
     * Deliberately this counter and NOT `ConversationState.navigationGeneration`.
     * This one advances the moment a navigation is admitted, that one only when
     * a conversation is actually being installed. A navigation still waiting on
     * its detail request must already invalidate an older reveal, and only this
     * counter reports that.
     */
    public get navigationRequestToken(): number {
        return this._navRequestSeq;
    }
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
     * It takes the ENCLOSING navigation's token and checks it once, immediately
     * before committing. The subscribe call itself is synchronous by contract
     * (see `IrisConversationDeps.subscribeToSession`), so there is nothing to
     * re-check afterwards: it either records the intent or it doesn't, on the
     * spot.
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
        // AFTER the emit, never before it. The webview keys an incoming
        // transcript on the conversation the snapshot names, so a transcript
        // that overtakes its own snapshot is addressed to the conversation the
        // student has just left and is dropped: an empty chat under a correct
        // header.
        this._deps.deliverTranscript(detail, 'load');
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
    public async onSubscriptionActive(sessionId: number): Promise<void> {
        if (sessionId !== this.state.snapshot().currentSessionId) { return; }
        // Awaitable so the ONE caller can inspect the reconciled result: the
        // provider decides afterwards whether the recovered history proves an
        // in-flight run finished while the socket was down.
        await this.reconcileCurrent();
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
    public async start(workspace: { exerciseId: number; courseId: number } | undefined): Promise<StartOutcome> {
        if (!workspace) { return { kind: 'ok' }; }
        const target: ServerContext = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: workspace.exerciseId };
        return await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            let detail: SessionDetail;
            try {
                detail = await this._api.getCurrentChat('PROGRAMMING_EXERCISE_CHAT', workspace.exerciseId, workspace.courseId);
            } catch (error) {
                // A cold start into a course whose Iris is off is the same
                // destination as a switch into one (see `switchCourse`): land
                // there, so the banner has a course to label and the caller
                // does not treat a definitive refusal as a reachability
                // problem worth retrying forever.
                if (isIrisCourseDisabled(error)) {
                    logger.info(`Iris is switched off in course ${workspace.courseId}; entering it anyway`, LogCategory.IRIS_CHAT);
                    return this._enterCourseWithoutConversation(workspace.courseId, isCurrent)
                        ? { kind: 'disabled' } as const
                        : { kind: 'stale' } as const;
                }
                throw error;
            }
            if (!this._install(detail, captured, isCurrent)) { return { kind: 'ok' } as const; }
            // A course session came back: it is empty by construction
            // (findOrCreateEmptyCourseSession). The `empty` check still guards
            // it, because this staging is automatic rather than asked for, and
            // silently retopicking a conversation the student has written in is
            // not the same as them picking a topic.
            if (!sameContext(detail.context, target) && this.state.contentState() === 'empty') {
                this.state.stagePending(target);
            }
            void this.refreshOverview();
            this._emit();
            return { kind: 'ok' } as const;
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
            let fresh: SessionDetail;
            try {
                fresh = await this._api.createCourseSession(courseId);
            } catch (error) {
                // The dispatcher acts on an OUTCOME, not an exception: a 500 here
                // must become a notice, not an unhandled rejection on the promise
                // Task 14's `await newConversation()` awaits.
                logger.warn('Iris new-conversation create failed', LogCategory.IRIS_CHAT, error);
                return { kind: 'rejected', reason: 'failed' } as const;
            }
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
        if (currentSessionId === undefined || courseId === undefined) {
            this.state.resetCachesForReload();
            await this.start(this._deps.getWorkspaceExercise());
            return;
        }
        await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            // AFTER the read, never before. The escape hatch still drops
            // everything local, which is its whole point (`setOverview([])`
            // alone leaves knownInvisible in place, so a wedged client stays
            // wedged). But a reload that FAILS must cost nothing: this is also
            // the path a Retry takes on a transient outage, and clearing first
            // left the student with an empty history and no way to refill it,
            // the refill being the thing that had just failed.
            const detail = await this._api.getChatSessionById(courseId, currentSessionId);
            // BOTH guards before touching anything. Clearing on the way in cost
            // the student their history whenever the re-read failed; clearing
            // after the read but before the guards let a stale reload wipe the
            // caches of the navigation that had won. Nothing awaits between
            // here and the install, so a check that passes now still holds
            // there.
            if (!isCurrent() || !this.state.accepts(captured)) { return; }
            this.state.resetCachesForReload();
            if (!this._install(detail, captured, isCurrent)) { return; }
            void this.refreshOverview();
        });
    }

    /** See `ConversationState.resetForSessionChange`. Leaves the socket first. */
    public resetForSessionChange(): void {
        this._deps.leaveSession();
        this.state.resetForSessionChange();
        this.notifyChanged();
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
        // One pass. A topic change stays in the open conversation, so there is
        // no candidate to probe and nothing to revalidate: the earlier draft's
        // two-pass loop existed only to check a session the index had guessed at
        // before switching to it, and it no longer switches.
        const decision = resolveTopic(this._resolutionInput(target, courseHint));
        switch (decision.kind) {
            case 'noop': return { kind: 'noop' };
            case 'refuse': return { kind: 'rejected', reason: decision.reason };
            case 'clear-pending': this.state.clearPending(); this._emit(); return { kind: 'unstaged' };
            case 'stage': this.state.stagePending(decision.target); this._emit(); return { kind: 'staged' };
            case 'acquire': return await this._acquireForTarget(decision.target, courseHint, isCurrent);
        }
    }

    /**
     * Reads a conversation WITHOUT touching visible state, so a mismatch, a 404
     * or a network failure leaves the open conversation exactly as it was.
     * Takes the ENCLOSING navigation's token; it never opens one of its own.
     */
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
        let detail: SessionDetail;
        try {
            detail = await this._api.getCurrentChat(target.mode as IrisChatMode, target.entityId, courseId);
        } catch (error) {
            // A cold start into a course whose Iris is off is the same
            // destination as a switch into one: land there, so the banner has a
            // course to label and the student is not left with nothing selected.
            if (isIrisCourseDisabled(error)) {
                logger.info(`Iris is switched off in course ${courseId}; entering it anyway`, LogCategory.IRIS_CHAT);
                return this._enterCourseWithoutConversation(courseId, isCurrent)
                    ? { kind: 'course-disabled' }
                    : { kind: 'stale' };
            }
            // Same reasoning as `newConversation`: the dispatcher acts on an
            // outcome, so a 500 here must not reject the returned promise.
            logger.warn('Iris cold-start acquisition failed', LogCategory.IRIS_CHAT, error);
            return { kind: 'rejected', reason: 'failed' };
        }
        if (!this._install(detail, captured, isCurrent)) { return { kind: 'stale' }; }
        if (!sameContext(detail.context, target) && this.state.contentState() === 'empty') {
            this.state.stagePending(target);
        }
        void this.refreshOverview();
        this._emit();
        return { kind: 'opened', sessionId: detail.sessionId };
    }

    private _resolutionInput(target: ServerContext, targetCourseId?: number): TopicResolutionInput {
        const snapshot = this.state.snapshot();
        return {
            target,
            targetCourseId,
            courseId: snapshot.courseId,
            currentSessionId: snapshot.currentSessionId,
            committedContext: snapshot.committedContext,
            pendingContext: snapshot.pendingContext,
            contentState: this.state.contentState(),
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
     * Lands in `courseId` with NO conversation, INSIDE the caller's navigation.
     * A course whose Iris is switched off is a destination: `sessions/current`
     * answers 403 there, so there is nothing to acquire, but staying behind
     * would leave the student in the old course reading about a different one.
     * Artemis' own client cannot even reach that state, because its course
     * follows the page.
     *
     * Private, and takes `isCurrent`, deliberately. An earlier draft let the
     * caller catch the 403 and start a FRESH navigation, which made a slow 403
     * for course A outrank a switch to course B issued after it.
     */
    private _enterCourseWithoutConversation(courseId: number, isCurrent: () => boolean): boolean {
        if (!isCurrent()) { return false; }
        // Order matters: the navigation drops the session and the detail first,
        // so `setCourse` cannot clear the caches while a conversation from the
        // old course is still considered current.
        this.state.beginNavigation(undefined);
        this.state.setCourse(courseId);
        // The transport keeps an INTENT, not just a subscription, so dropping
        // the conversation locally is not enough: without this the next
        // reconnect resubscribes to the conversation we have just left.
        this._deps.leaveSession();
        this._emit();
        return true;
    }

    /**
     * Opens `courseId`'s conversation. A course with Iris switched off is
     * entered all the same, without one; see {@link CourseSwitchOutcome}.
     */
    public async switchCourse(courseId: number): Promise<CourseSwitchOutcome> {
        if (this.state.sendInFlight) { return { kind: 'rejected', reason: 'send-in-flight' }; }
        return await this._navigate(async (isCurrent) => {
            const captured = this.state.beginLoad();
            let detail: SessionDetail;
            try {
                detail = await this._api.getCurrentChat('COURSE_CHAT', courseId, courseId);
            } catch (error) {
                // Handled HERE, inside this navigation, so a slow refusal cannot
                // outrank a switch the student made after it.
                if (isIrisCourseDisabled(error)) {
                    logger.info(`Iris is switched off in course ${courseId}; entering it anyway`, LogCategory.IRIS_CHAT);
                    return this._enterCourseWithoutConversation(courseId, isCurrent)
                        ? { kind: 'disabled' } as const
                        : { kind: 'stale' } as const;
                }
                logger.warn('Iris course switch failed', LogCategory.IRIS_CHAT, error);
                if (!isCurrent()) { return { kind: 'stale' } as const; }
                throw error;
            }
            // setCourse clears knownInvisible; it runs inside installAcquired,
            // AFTER the request, so a failed switch does not throw away the
            // current course's cache and with it the only route to its hidden
            // conversations.
            if (!this._install(detail, captured, isCurrent)) { return { kind: 'stale' } as const; }
            void this.refreshOverview();
            this._emit();
            return { kind: 'opened', sessionId: detail.sessionId } as const;
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
        // overview at all and its history stays permanently empty.
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
     * NOT wrapped in `_navigate`: this fires from the transport via
     * `onDidResubscribe` and can land in the middle of a real, user-visible
     * navigation. Taking a token here would bump `_navRequestSeq` and make the
     * outer navigation's `isCurrent()` permanently false, silently turning the
     * user's own history open or topic switch into a no-op. `_navigate` never
     * nests, and a reconciliation is not itself a user-visible navigation, so
     * `installDetail`'s own guard tuple is what protects this call instead.
     *
     * Subscribes FIRST, then reads: a CTXSWAP that lands between the GET
     * completing and the subscription going live would otherwise be lost with
     * nothing left to repair it.
     *
     * A LOAD like any other (guard matrix: "reconnect detail"), so it goes
     * through `beginLoad` and `installDetail` directly and never merges:
     * something that moved while the GET was in flight means the response is
     * discarded, not combined with a possibly-stale local view. Best-effort,
     * like `refreshOverview`: the only caller fires it as
     * `void reconcileCurrent()`, so a network failure is logged, not thrown.
     */
    public async reconcileCurrent(): Promise<void> {
        const snapshot = this.state.snapshot();
        if (snapshot.currentSessionId === undefined || snapshot.courseId === undefined) { return; }
        // Subscribe FIRST: a CTXSWAP between the GET completing and the
        // subscription becoming active would otherwise be lost entirely.
        // Synchronous by contract (see IrisConversationDeps), so no await.
        this._deps.subscribeToSession(snapshot.currentSessionId);
        this.state.noteReconnect();

        // beginLoad, NOT guard: guard() carries loadTicket 0 and `accepts`
        // requires a ticket strictly greater than the last installed one, so a
        // guard()-based reconnect would be rejected every single time and
        // reconciliation would silently never happen.
        const captured = this.state.beginLoad();
        try {
            const detail = await this._api.getChatSessionById(snapshot.courseId, snapshot.currentSessionId);
            if (!this.state.installDetail(detail, captured)) {
                // Something moved while we were fetching. Discard, do not merge.
                return;
            }
            this._emit();
            // MERGE, not load: a reconnect must recover the answer whose
            // terminal frame was missed without wiping an optimistic bubble or
            // a live draft that survived the drop. After the emit, for the same
            // reason as `_install`.
            this._deps.deliverTranscript(detail, 'merge');
        } catch (error) {
            logger.warn('Iris reconcile-on-resubscribe failed', LogCategory.IRIS_CHAT, error);
        }
    }

    public dispose(): void {
        this._onDidChange.dispose();
        this._overviewInFlight = undefined;
    }
}
