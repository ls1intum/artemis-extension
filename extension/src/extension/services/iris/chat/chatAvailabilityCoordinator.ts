import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';

import type { AvailabilityContext, IrisAvailability } from './irisAvailabilityService';
import { IrisAvailabilityService } from './irisAvailabilityService';

/**
 * The single owner of "is Iris usable where the chat currently is".
 *
 * `IrisAvailabilityService` answers the question and draws the banners; it
 * knows nothing about conversations. This coordinator supplies the missing
 * half: it derives the context from the open conversation, and it guards every
 * answer against the navigation that may have happened while the check was in
 * flight. Both were previously spread across the chat provider, which is why a
 * stale banner was only ever one forgotten comparison away.
 */
export class ChatAvailabilityCoordinator {
    private readonly _service: IrisAvailabilityService;

    constructor(
        /**
         * A GETTER, not a value. `_conversation` would work as a value in
         * production: it is assigned once, before this collaborator, and never
         * replaced. It is read at call time because the chat's white-box tests
         * install a conversation double after construction. See #440.
         */
        private readonly _getConversation: () => IrisConversationService | undefined,
        private readonly _catalog: CourseCatalog | undefined,
        artemisApi: ArtemisApiService | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
    ) {
        this._service = new IrisAvailabilityService(_catalog, artemisApi, _postMessage);
    }

    /**
     * What the availability check runs against: where the chat IS, which is
     * usually the open conversation and otherwise the course alone (a course
     * with Iris switched off is entered without one). Never a stored selection:
     * that asks Artemis about the previous course's settings after a switch.
     */
    public context(): AvailabilityContext | null {
        const conversation = this._getConversation();
        if (!conversation) { return null; }
        const snapshot = conversation.state.snapshot();
        const courseId = snapshot.courseId;
        if (courseId === undefined) { return null; }
        const topic = conversation.state.effectiveContext();
        if (topic?.mode === 'PROGRAMMING_EXERCISE_CHAT') {
            return {
                type: 'exercise',
                id: topic.entityId,
                title: topic.name ?? this._catalog?.exerciseTitle(topic.entityId) ?? `Exercise ${topic.entityId}`,
                courseId,
            };
        }
        // Course chat, and every mode that can never be a topic (lecture, text
        // exercise): Iris availability is a course-level question there.
        return {
            type: 'course',
            id: courseId,
            title: this._catalog?.courseTitle(courseId) ?? `Course ${courseId}`,
            courseId,
        };
    }

    /**
     * Whether `captured` is still the context the chat is in.
     *
     * A check runs on every navigation, so two can be open at once (course 42,
     * then 43 before 42's settings answer). Publishing 42's answer against 43
     * is precisely the stale banner `clearBanners` exists to prevent, so an
     * answer that outlived its context must say nothing. The send path's
     * rejection banner is gated on exactly the same comparison.
     */
    public isStillLive(captured: AvailabilityContext | undefined): boolean {
        const live = this.context();
        if (!live || !captured) { return false; }
        return live.type === captured.type && live.id === captured.id;
    }

    /** Ask Artemis. The caller decides what to do with the answer. */
    public check(context: AvailabilityContext): Promise<IrisAvailability> {
        return this._service.checkAndLoadIrisSettings(context);
    }

    /** Publish a classification and record it as the one now on screen. */
    public post(availability: IrisAvailability, context: AvailabilityContext | null): void {
        this._service.postAvailability(availability, context);
    }

    /**
     * Take both banners down and forget the classification behind them.
     *
     * The two always move together: a tracked `unavailable` left behind after
     * the banner is gone would suppress the next identical banner, and a
     * banner left up after the state is forgotten has nothing left to clear
     * it. Called on navigation, on a session change, and whenever a check
     * comes back enabled.
     */
    public clearBanners(): void {
        this._service.resetAvailability();
        this._postMessage({ type: ExtensionMsg.HideDisabledState });
        this._postMessage({ type: ExtensionMsg.HideUnavailableState });
    }

    /**
     * Re-run the settings check for wherever the chat is now and publish the
     * result: both banners down when it comes back enabled, the matching
     * banner otherwise.
     */
    public async refresh(): Promise<void> {
        const context = this.context();
        if (!context) { return; }
        const availability = await this.check(context);
        if (!this.isStillLive(context)) { return; }
        if (availability.kind === 'enabled') {
            this.clearBanners();
            return;
        }
        this.post(availability, context);
    }

    /**
     * The persistent "Iris is off here" state for a course we just entered.
     * Goes through the service so its `lastAvailability` records it and the
     * next enabled course clears it, exactly as a settings probe would.
     */
    public announceCourseDisabled(courseId: number): void {
        this.post({ kind: 'disabled' }, {
            type: 'course',
            id: courseId,
            title: this._catalog?.courseTitle(courseId) ?? `Course ${courseId}`,
        });
    }
}
