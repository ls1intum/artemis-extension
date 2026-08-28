import type { ChatState } from '@webview/stores/useChatStore';

/**
 * Which of the chat's five mutually-exclusive shells is on screen.
 *
 * These are pure derivations of the snapshot, kept out of the view because
 * they are the subtlest thing it does: each flag distinguishes "nothing is
 * open" from "not told yet" from "we could not ask", and getting any of them
 * wrong shows a student the wrong screen entirely. Here they can be tested
 * with an object literal instead of a rendered component.
 */
interface StartupState {
    /**
     * No workspace exercise detected and nothing opened: there is no course to
     * put in a header, so the transcript offers the course list instead.
     *
     * Both leading guards are load-bearing. Before the first snapshot,
     * "nothing is open" and "not told yet" are indistinguishable, and guessing
     * the former flashes the course chooser at every student who does have a
     * conversation. And workspace detection is asynchronous, so an unsettled
     * state can say "nothing is open" while the extension is still working out
     * which exercise the folder is.
     */
    isColdStart: boolean;
    /**
     * Detection could not reach the server. That is not "no exercise here",
     * and the student must not be asked to pick a course as if it were.
     *
     * `courseId === null` is load-bearing, not defensive: entering a course
     * whose Iris is disabled deliberately sets `courseId` and leaves
     * `currentSessionId` null. Without this clause, a failed background
     * detection would cover that course's own banner with a startup-outage
     * screen.
     */
    detectionUnavailable: boolean;
    /**
     * Nothing open and no answer yet. Must suppress the ordinary shell: the
     * header falls back to "Choose a course" and the composer to "Choose a
     * course to start chatting", so a spinner in the message area alone would
     * still tell the student to pick a course while detection is mid-flight.
     */
    startupPending: boolean;
    /**
     * The header, the topic row and the composer's own "choose a course"
     * wording all assume the ordinary "nothing open" shell. Both the waiting
     * and the outage states get their own message-area branch instead.
     */
    suppressOrdinaryShell: boolean;
    /**
     * The cold-start chooser, plus the ONE other path allowed to reach it: a
     * student who bypassed a startup outage that will not clear on its own.
     * Both render the identical inline picker.
     */
    showCourseChooser: boolean;
}

type StartupInput = Pick<
    ChatState,
    'hasReceivedInitialIrisState' | 'detectionState' | 'courseId' | 'currentSessionId' | 'workspaceExerciseId'
>;

/**
 * `outageChooserRequested` is the view's own state, not the host's: the
 * student asked to see the course list anyway, from the startup-outage screen.
 * It deliberately does NOT enter `suppressOrdinaryShell` - the header stays
 * suppressed even once the outage screen is bypassed, because there is still
 * no course to put in it.
 */
export function deriveStartupState(state: StartupInput, outageChooserRequested: boolean): StartupState {
    const nothingOpen = state.hasReceivedInitialIrisState
        && state.courseId === null
        && state.currentSessionId === null;

    const isColdStart = nothingOpen
        && state.detectionState === 'settled'
        && state.workspaceExerciseId === null;
    const detectionUnavailable = nothingOpen && state.detectionState === 'unavailable';
    const startupPending = nothingOpen && state.detectionState === 'unsettled';

    return {
        isColdStart,
        detectionUnavailable,
        startupPending,
        suppressOrdinaryShell: startupPending || detectionUnavailable,
        showCourseChooser: isColdStart || (detectionUnavailable && outageChooserRequested),
    };
}

/**
 * How the course picker reports itself.
 *
 * The same outage reads differently depending on what survived it. With no
 * rows the failure is all there is to show; with rows, they stay pickable but
 * unconfirmed, and saying so keeps the picker from presenting a stale course
 * list as current.
 */
type CoursePickerStatus = 'loading' | 'ready' | 'error' | 'stale';

export function deriveCoursePickerStatus(
    state: Pick<ChatState, 'coursesUnavailable' | 'courses'>,
    coursesLoading: boolean,
): CoursePickerStatus {
    if (coursesLoading) { return 'loading'; }
    if (!state.coursesUnavailable) { return 'ready'; }
    return state.courses.length === 0 ? 'error' : 'stale';
}

/**
 * The red banner: Iris is strictly off (instructor disabled, `.noai`). The
 * unavailable banner is transient and retry-able and is rendered separately.
 * When both states are non-null this one wins: it carries strictly more
 * information.
 */
export function deriveDisabledBannerText(
    state: Pick<ChatState, 'disabledMessage' | 'isNoAiDetected'>,
): string | null {
    if (state.disabledMessage) { return state.disabledMessage; }
    if (state.isNoAiDetected) {
        return 'AI assistance is disabled. A .noai file was detected in your workspace.';
    }
    return null;
}

type PlaceholderInput = Pick<
    ChatState,
    'disabledMessage' | 'isNoAiDetected' | 'unavailableMessage' | 'currentSessionId'
>;

/**
 * What the composer says when it cannot be typed into.
 *
 * Order matters: real unavailability (no context, `.noai`, explicit disabled,
 * transient unavailable) wins over the loading state. `undefined` means the
 * composer has no reason of its own and the caller may fall back to its
 * hydration wording.
 */
export function deriveComposerPlaceholder(
    state: PlaceholderInput,
    startup: Pick<StartupState, 'showCourseChooser' | 'startupPending' | 'detectionUnavailable'>,
): string | undefined {
    // Ahead of the no-conversation case on purpose. Entering a course whose
    // Iris is switched off leaves us with a course and no conversation, and
    // "Choose a course" would send the student back to the picker they just
    // used, past a banner that already gives the real reason.
    if (state.disabledMessage) { return 'Iris chat is not available here'; }
    // Ahead of `detectionUnavailable` on purpose: once the student has
    // bypassed the outage screen, the message area is showing the course
    // picker, not the outage explanation, and the composer must agree with
    // what is actually on screen.
    if (startup.showCourseChooser) { return 'Choose a course to start chatting'; }
    // Not "Choose a course": detection has not answered yet, so there may be
    // nothing to choose from at all.
    if (startup.startupPending) { return 'Looking for your Artemis exercise…'; }
    // Not "the server": this screen also covers a failure to read the stored
    // credential, which is local.
    if (startup.detectionUnavailable) { return 'Detecting your Artemis exercise failed. Retry above.'; }
    if (state.currentSessionId === null) { return 'Choose a course to start chatting'; }
    if (state.isNoAiDetected) { return 'AI assistance is disabled (.noai detected)'; }
    if (showsUnavailableBanner(state)) { return 'Iris is temporarily unavailable. Retry to reload.'; }
    return undefined;
}

/** The transient yellow banner, suppressed while the disabled one is up. */
export function showsUnavailableBanner(
    state: Pick<ChatState, 'unavailableMessage' | 'disabledMessage'>,
): boolean {
    return state.unavailableMessage !== null && state.disabledMessage === null;
}

/**
 * Whether the transcript on screen is the open conversation's.
 *
 * True when either nothing is open (the legitimate "Choose a course" steady
 * state) or the open conversation's transcript has arrived. The gap
 * "conversation open, transcript not yet delivered" is what the loader covers.
 */
export function isTranscriptHydrated(
    state: Pick<ChatState, 'hasReceivedInitialIrisState' | 'currentSessionId' | 'loadedSessionId'>,
): boolean {
    return state.hasReceivedInitialIrisState
        && (state.currentSessionId === null || state.loadedSessionId === state.currentSessionId);
}
