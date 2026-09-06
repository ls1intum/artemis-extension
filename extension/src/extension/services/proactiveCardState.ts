import type { ProactiveCardReason, ProactiveCardState } from '@shared/messageContracts';

/**
 * Inputs to the AskIris card-state decision. All gathered host-side in
 * {@link ProactiveControlCommandModule}. The clean (no-engine) build reaches this function too (its
 * chat-availability card renders there), but its `_push` masks the proactive-only inputs, so only
 * `noai`/`iris-off`/`available` can result. There is no `enginePresent` input here.
 */
export interface ProactiveCardSignals {
 /** The chat's classification: enabled / disabled (iris-off OR no LLM opt-in) / unavailable (transient). */
    irisAvailability: 'enabled' | 'disabled' | 'unavailable';
    /** A `.noai` marker is present in the workspace. */
    noAi: boolean;
    /** Course-level `proactiveStruggleEnabled`. `undefined` = unknown this tick (settings unread). */
    courseProactiveEnabled: boolean | undefined;
    /** No proactive-egress consent: student-fixable → its own card reason with a settings link. */
    consentMissing: boolean;
    /** 404-latched server: not student-fixable → the limited card. */
    serverUnavailable: boolean;
}

/**
 * Map the gathered signals to exactly one AskIris card state, one term per row.
 * Order encodes precedence: a more total shut-off wins over a partial one.
 */
export function deriveProactiveCardState(s: ProactiveCardSignals): { state: ProactiveCardState; reason?: ProactiveCardReason } {
 // Case 3: a `.noai` marker turns the whole feature (incl. manual chat) off → Unavailable (in-card notice).
    if (s.noAi) {
        return { state: 'unavailable', reason: 'noai' };
    }
 // Case 2: Iris off for this course/user (profile off, settings 403, enabled=false, or no LLM opt-in).
    if (s.irisAvailability === 'disabled') {
        return { state: 'unavailable', reason: 'iris-off' };
    }
 // Case 1: Iris on, but the course turned proactive off → its own "Off (course)" state (Ask works).
    if (s.courseProactiveEnabled === false) {
        return { state: 'off-course', reason: 'course-off' };
    }
 // Case 5: 404-latched server → proactive is off and nothing the student does changes that. Checked
    // BEFORE the consent case: a consent hint must not promise a feature the server does not have.
    if (s.serverUnavailable) {
        return { state: 'degraded', reason: 'limited' };
    }
 // Case 4 / #342: missing code-reading consent → forced-Off control with an enable path.
    if (s.consentMissing) {
        return { state: 'degraded', reason: 'consent-missing' };
    }
 // Happy path AND case 6 (transient `unavailable` blip self-heals on the next refresh; never a false "off").
    return { state: 'available', reason: undefined };
}
