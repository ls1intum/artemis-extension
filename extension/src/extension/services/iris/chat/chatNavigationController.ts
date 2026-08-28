import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';
import type { ServerContext } from '@shared/types/serverContext';

import type { ArtemisApiService } from '@extension/api';
import { isIrisCourseDisabled } from '@extension/domain/errors';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';
import type {
    CourseSwitchOutcome,
    IrisConversationService,
    StartOutcome,
    TopicChangeOutcome,
} from '@extension/services/iris/conversation/conversationService';
import { LogCategory, logger } from '@extension/services/loggingService';

import type { ChatAvailabilityCoordinator } from './chatAvailabilityCoordinator';

/** The four navigations the webview can ask for. Each has its own refusal surface. */
type NavigationCommand = 'selectTopic' | 'openConversation' | 'switchCourse' | 'newConversation';

interface ChatNavigationDeps {
    /**
     * A GETTER, not a value. The conversation would work as a value in
     * production: it is assigned once, before this controller, and never
     * replaced. It is read at call time because the chat's white-box tests
     * install a conversation double after construction. See #440.
     */
    getConversation(): IrisConversationService | undefined;
    catalog: CourseCatalog | undefined;
    artemisApi: ArtemisApiService | undefined;
    availability: ChatAvailabilityCoordinator;
    postMessage: (message: ExtensionToWebviewMessage) => void;
    /**
     * Cancels the automatic cold start, because the student named a
     * destination themselves. See `ChatStartupCoordinator.admitExplicitIntent`.
     */
    admitExplicitIntent: (reason: string) => void;
}

/**
 * Wording for a navigation that could not be made. Opening a history row in a
 * disabled course reaches this, and a "please try again" would promise
 * something no retry can deliver.
 */
function navigationFailureMessage(error: unknown, fallback: string): string {
    return isIrisCourseDisabled(error) ? 'Iris chat is not enabled for that course.' : fallback;
}

/**
 * Every way the chat's conversation can be pointed somewhere else: the cold
 * start, the four webview navigations, and the Ask-Iris commands.
 *
 * They belong together because they share one hard-won set of rules. Each has
 * to gate on a send being in flight, has to answer a refusal on the surface
 * the student was looking at, and has to record the destination's name before
 * navigating away from the state that still holds it. Spread across a provider
 * those rules were four near-copies; the gap between any two of them was a bug
 * nobody could see.
 */
export class ChatNavigationController {
    constructor(private readonly _deps: ChatNavigationDeps) {}

    /**
     * The conversation-first acquisition. One call gives the id, the topic, the
     * title and the transcript. Called by the startup coordinator, once the
     * view has resolved and workspace detection has matched an exercise; a
     * rejection re-arms the coordinator's latch (see `ChatStartupDeps.start`),
     * so this can run again after a transient failure.
     *
     * The availability check afterwards is not a duplicate of the one the
     * provider's conversation-changed hook runs: re-opening the view
     * re-installs the SAME conversation, so that hook's id guard early-returns
     * and nothing would ever ask whether Iris is enabled here.
     */
    public async acquire(workspace: { exerciseId: number; courseId: number }): Promise<void> {
        const conversation = this._deps.getConversation();
        if (!conversation) { return; }
        // Captured BEFORE the navigation. See `_rememberCourseName`: reading
        // either after the await would risk crossing a session identity that
        // changed while this was in flight.
        const epoch = this._deps.catalog?.currentEpoch ?? 0;
        const knownTitle = this._deps.catalog?.courseTitle(workspace.courseId);
        let outcome: StartOutcome;
        try {
            outcome = await conversation.start(workspace);
        } catch (error: unknown) {
            // A failed acquisition leaves no session and therefore no
            // transcript, so the loader would spin forever. The banner's Retry
            // routes back through reloadIrisChat. Re-thrown, not swallowed, so
            // the coordinator can re-arm its latch.
            logger.error('Iris conversation start failed', LogCategory.IRIS_CHAT, error);
            this._deps.postMessage({
                type: ExtensionMsg.ShowUnavailableState,
                message: 'Iris could not be reached. Retry to reload the conversation.',
            });
            throw error;
        }
        // The captured epoch stops a write crossing an identity. This stops
        // one crossing a NAVIGATION inside the same identity: a superseding
        // switch can leave the chat in another course entirely, and naming
        // this one then records a course the student never entered.
        const landedHere = outcome.kind !== 'stale'
            && conversation.state.snapshot().courseId === workspace.courseId;
        if (landedHere) {
            this._rememberCourseName(workspace.courseId, knownTitle, epoch);
        }
        // A course whose instructor switched Iris off is a destination, not a
        // failure (see `IrisConversationService.start`): NOT re-thrown, or the
        // coordinator would re-arm its latch for an answer that will never
        // change, and Retry would repeat the same 403 forever. Same banner
        // `switchCourse` shows for the identical case reached by a course
        // switch instead of a cold start.
        if (outcome.kind === 'disabled') {
            this._deps.availability.announceCourseDisabled(workspace.courseId);
            return;
        }
        await this._deps.availability.refresh();
    }

    /**
     * The Ask-Iris commands' single entry point: point the open conversation at
     * `target`, acquiring one when none is open. The course id must travel WITH
     * the target, because on a fresh window `ConversationState.courseId` is
     * `undefined` and a resolution without it can only answer `no-course`.
     * A missing hint is resolved from the exercise before asking.
     */
    public async askIrisAbout(target: ServerContext, courseHint?: number): Promise<TopicChangeOutcome> {
        const conversation = this._deps.getConversation();
        if (!conversation) {
            return { kind: 'rejected', reason: 'failed' };
        }
        const courseId = target.mode === 'COURSE_CHAT'
            ? target.entityId
            : courseHint ?? (this._deps.catalog
                ? await resolveCourseIdForExercise(target.entityId, this._deps.catalog, this._deps.artemisApi)
                : undefined);
        // An exercise whose course we could not determine is refused rather than
        // staged. The cross-course check compares the target's course with the
        // open conversation's, so an unknown one is not "probably fine": it is
        // the exact input that makes the check say nothing. With no conversation
        // open the acquisition would have answered `no-course` anyway.
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }

        // The target may live in ANOTHER course. Refusing would leave the
        // student staring at the course they were already in, having clicked
        // something else entirely. Artemis' client never has to refuse: opening
        // an exercise navigates to its page and the chat's course follows the
        // URL. Nothing navigates here, so make the same move explicitly, in the
        // order a student would: the course first, the topic in it afterwards.
        const open = conversation.state.snapshot().courseId;
        if (open !== undefined && open !== courseId) {
            const switched = await this._switchCourseForAskIris(courseId);
            // Only an opened conversation can carry a topic. The other three
            // outcomes each already say everything the student needs, and none
            // of them may be dressed up as a failed topic change:
            // `disabled` shows the banner, `stale` means a newer navigation won,
            // and `rejected` is reported by the caller, once.
            if (switched.kind === 'disabled') { return this._answerCourseDisabled(courseId); }
            if (switched.kind === 'stale') { return { kind: 'stale' }; }
            if (switched.kind === 'rejected') { return { kind: 'rejected', reason: switched.reason }; }
        }
        const outcome = await conversation.resolveTopicChange(target, courseId);
        // The cold start reaches the same destination through the acquisition
        // rather than through a switch, and owes the student the same banner.
        return outcome.kind === 'course-disabled' ? this._answerCourseDisabled(courseId) : outcome;
    }

    public async selectTopic(target: ServerContext): Promise<void> {
        const conversation = this._conversationFor('selectTopic');
        if (!conversation) { return; }
        const outcome = await conversation.resolveTopicChange(target);
        // No notice on success: a topic change stays in the open conversation,
        // so there is no transcript replacement to explain, and an `opened`
        // means the cold start acquired the FIRST conversation, with nothing
        // on screen to replace either.
        //
        // A `rejected` outcome is the service saying it did NOT do what was
        // asked (the cold-start acquisition threw, the target is in another
        // course, the conversation is still loading). Dropping it leaves the
        // chip on the old topic with no explanation at all.
        if (outcome.kind === 'rejected') {
            logger.info(`selectTopic rejected: ${outcome.reason}`, LogCategory.IRIS_CHAT);
            this._answerFailedNavigation(
                'selectTopic',
                this._rejectionMessage(outcome.reason, 'Could not change the topic. Please try again.'),
            );
        }
    }

    public async openConversation(params: { courseId: number; sessionId: number }): Promise<void> {
        const conversation = this._conversationFor('openConversation');
        if (!conversation) { return; }
        // `navigateTo` may cross courses, and `setCourse` clears the summaries
        // the row came from, so the name has to leave conversation state
        // before the navigation starts. The `openConversation` command carries
        // only ids. Programming exercises only, deliberately: a `LECTURE_CHAT`
        // `entityId` would collide with an exercise id and hand back a wrong
        // title with full confidence.
        const snapshot = conversation.state.snapshot();
        const row = snapshot.courseSessions
            .concat(snapshot.knownInvisible)
            .find(s => s.sessionId === params.sessionId);
        if (row?.context.mode === 'PROGRAMMING_EXERCISE_CHAT' && row.context.name) {
            this._deps.catalog?.upsertSupplemental({
                kind: 'partial-exercise',
                id: row.context.entityId,
                courseId: row.courseId,
                title: row.context.name,
            }, this._deps.catalog?.currentEpoch ?? 0);
        }
        try {
            // No notice: this navigation is exactly what the student asked for,
            // so there is nothing to explain.
            await conversation.navigateTo(params);
        } catch (error: unknown) {
            logger.error('openConversation failed', LogCategory.IRIS_CHAT, error);
            this._deps.postMessage({
                type: ExtensionMsg.OpenSessionError,
                message: navigationFailureMessage(error, 'Could not open that conversation. Please try again.'),
            });
        }
    }

    public async switchCourse(courseId: number): Promise<void> {
        const conversation = this._conversationFor('switchCourse');
        if (!conversation) { return; }
        // Captured BEFORE the navigation; see `_rememberCourseName`.
        const epoch = this._deps.catalog?.currentEpoch ?? 0;
        const knownTitle = this._deps.catalog?.courseTitle(courseId);
        try {
            // A course whose Iris is switched off is a destination, not a
            // failure: the service lands there with no conversation, INSIDE the
            // navigation that asked for it, and reports `disabled`. All this
            // handler owes it is the banner. Anything else IS a failure and is
            // answered inline, in the picker that is still open to hold it.
            const outcome = await conversation.switchCourse(courseId);
            if (outcome.kind === 'disabled') { this._deps.availability.announceCourseDisabled(courseId); }
            // Only where we actually landed in the course. `stale` means a
            // newer navigation won and `rejected` means we never went.
            if (outcome.kind === 'opened' || outcome.kind === 'disabled') {
                this._rememberCourseName(courseId, knownTitle, epoch);
            }
        } catch (error: unknown) {
            logger.error('switchCourse failed', LogCategory.IRIS_CHAT, error);
            this._deps.postMessage({
                type: ExtensionMsg.OpenSessionError,
                message: navigationFailureMessage(error, 'Could not open that course. Please try again.'),
            });
        }
    }

    public async newConversation(): Promise<void> {
        const conversation = this._conversationFor('newConversation');
        if (!conversation) { return; }
        const outcome = await conversation.newConversation();
        if (outcome.kind === 'opened') {
            this._deps.postMessage({
                type: ExtensionMsg.ShowChatNotice,
                text: 'Started a new conversation.',
            });
            return;
        }
        // The create can simply fail (a 500 from `sessions?courseId`), and the
        // header's `+` has no popover to hold an error, so this line is the
        // only thing between the student and a button that does nothing.
        if (outcome.kind === 'rejected') {
            logger.info(`newConversation rejected: ${outcome.reason}`, LogCategory.IRIS_CHAT);
            this._answerFailedNavigation(
                'newConversation',
                this._rejectionMessage(outcome.reason, 'Could not start a new conversation. Please try again.'),
            );
        }
    }

    /**
     * The course move an Ask-Iris click implies. Returns whether a conversation
     * is now open in `courseId`, which is the only case where staging a topic
     * makes sense. Unlike the header's own switch this one announces itself:
     * the student clicked an exercise, not a course, so the transcript changing
     * under them is a side effect and has to be named.
     */
    private async _switchCourseForAskIris(courseId: number): Promise<CourseSwitchOutcome> {
        const conversation = this._deps.getConversation();
        if (!conversation) { return { kind: 'rejected', reason: 'failed' }; }
        try {
            const outcome = await conversation.switchCourse(courseId);
            if (outcome.kind === 'opened') {
                this._deps.postMessage({
                    type: ExtensionMsg.ShowChatNotice,
                    text: `Switched to ${this._deps.catalog?.courseTitle(courseId) ?? 'another course'}.`,
                });
            }
            return outcome;
        } catch (error: unknown) {
            // Reported by the caller, not here: `askIrisAbout` turns this into a
            // rejection and the command layer already answers every rejection
            // with a message. Two notifications for one click is worse than one
            // that names the topic rather than the course.
            logger.error('Ask-Iris course switch failed', LogCategory.IRIS_CHAT, error);
            return { kind: 'rejected', reason: 'failed' };
        }
    }

    /** Announces the course we just entered, and reports it as such. */
    private _answerCourseDisabled(courseId: number): TopicChangeOutcome {
        this._deps.availability.announceCourseDisabled(courseId);
        return { kind: 'course-disabled' };
    }

    /**
     * The course the chat is IN keeps its display name across a dashboard
     * refresh that no longer lists it. This is what the catalog's
     * `partial-course` record is for: it gives a course id a name and is
     * never offered as a pickable course. Without it the header falls back to
     * `Course 42` the moment the student's enrolment ends mid-conversation.
     */
    private _rememberCourseName(courseId: number, title: string | undefined, epoch: number): void {
        if (title === undefined) { return; }
        this._deps.catalog?.upsertSupplemental({ kind: 'partial-course', id: courseId, title }, epoch);
    }

    /**
     * Host-enforced navigation gate, returning the conversation a navigation
     * may proceed against. Not a disabled button: the webview's streaming
     * state resets on disconnect, so UI gating is not an invariant, and a
     * navigation admitted mid-send would move the conversation out from under
     * a POST that is still open.
     *
     * A refusal ANSWERS. The popovers stay open until their navigation lands,
     * so a refusal that posted nothing would leave the student's click with no
     * response at all: the row would simply not react.
     */
    private _conversationFor(command: NavigationCommand): IrisConversationService | undefined {
        const conversation = this._deps.getConversation();
        if (!conversation) {
            this._answerFailedNavigation(command, 'Iris is not available right now.');
            return undefined;
        }
        if (conversation.state.sendInFlight) {
            logger.info(`Refused ${command}: a send is in flight`, LogCategory.IRIS_CHAT);
            this._answerFailedNavigation(command, 'Wait for Iris to finish answering before switching.');
            return undefined;
        }
        // Admitted: the student named a destination. Whether the navigation then
        // succeeds is irrelevant to the cold start, which must not overrule them.
        // Placed after the refusals on purpose: a command that never reached the
        // conversation named nothing.
        this._deps.admitExplicitIntent(command);
        return conversation;
    }

    /**
     * Puts a refusal where the student was looking when they clicked.
     *
     * The history and the course picker stay open until their navigation
     * lands, so an inline `openSessionError` has a mounted host there. The
     * topic picker closes on the click itself, and the header's
     * new-conversation button never had a popover at all, so for those two
     * `openSessionError` is a write into a surface nothing renders: they
     * answer on the composer's notice line, which sits exactly where the
     * picker was.
     */
    private _answerFailedNavigation(command: NavigationCommand, message: string): void {
        if (command === 'openConversation' || command === 'switchCourse') {
            this._deps.postMessage({ type: ExtensionMsg.OpenSessionError, message });
            return;
        }
        this._deps.postMessage({ type: ExtensionMsg.ShowChatNotice, text: message, tone: 'error' });
    }

    /** What a `{ kind: 'rejected' }` outcome says to the student. */
    private _rejectionMessage(reason: Extract<TopicChangeOutcome, { kind: 'rejected' }>['reason'], failedMessage: string): string {
        switch (reason) {
            case 'send-in-flight': return 'Wait for Iris to finish answering before switching.';
            case 'loading': return 'Still loading this conversation. Try again in a moment.';
            case 'cross-course': return 'That topic belongs to a different course. Switch course first.';
            case 'no-course': return 'Choose a course first.';
            case 'failed': return failedMessage;
        }
    }
}
