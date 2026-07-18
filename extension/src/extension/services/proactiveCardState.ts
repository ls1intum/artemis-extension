import type { ProactiveCardReason, ProactiveCardState } from '@shared/messageContracts';

/**
 * Inputs to the AskIris card-state decision (spec §12.2 / §14). All gathered host-side in
 * {@link ProactiveControlCommandModule}. There is no `enginePresent` input: the clean (no-engine)
 * build never reaches this function — its `_push` early-returns on an absent `proactiveControl`
 * capability, so a missing engine is "no card sent", not a state here.
 */
export interface ProactiveCardSignals {
    /** The chat's §14 classification: enabled / disabled (iris-off OR no LLM opt-in) / unavailable (transient). */
    irisAvailability: 'enabled' | 'disabled' | 'unavailable';
    /** A `.noai` marker is present in the workspace (§14 case 3: disables the whole feature, incl. manual chat). */
    noAi: boolean;
    /** Course-level `proactiveStruggleEnabled` (§13). `undefined` = unknown this tick (settings unread). */
    courseProactiveEnabled: boolean | undefined;
    /** No proactive-egress consent (§14 case 4, #342): student-fixable → its own card reason with a settings link. */
    consentMissing: boolean;
    /** 404-latched server (§14 case 5): not student-fixable → the limited card. */
    serverUnavailable: boolean;
}

/**
 * Map the gathered signals to exactly one AskIris card state (spec §12.2), one term per §14 row.
 * Order encodes precedence: a more total shut-off wins over a partial one.
 */
export function deriveProactiveCardState(s: ProactiveCardSignals): { state: ProactiveCardState; reason?: ProactiveCardReason } {
    // §14 case 3: a `.noai` marker turns the whole feature (incl. manual chat) off → Unavailable + banner.
    if (s.noAi) {
        return { state: 'unavailable', reason: 'noai' };
    }
    // §14 case 2: Iris off for this course/user (profile off, settings 403, enabled=false, or no LLM opt-in).
    if (s.irisAvailability === 'disabled') {
        return { state: 'unavailable', reason: 'iris-off' };
    }
    // §14 case 1: Iris on, but the course turned proactive off → its own "Off (course)" state (Ask works).
    if (s.courseProactiveEnabled === false) {
        return { state: 'off-course', reason: 'course-off' };
    }
    // §14 case 5: 404-latched server → proactive is off and nothing the student does changes that. Checked
    // BEFORE the consent case: a consent hint must not promise a feature the server does not have.
    if (s.serverUnavailable) {
        return { state: 'degraded', reason: 'limited' };
    }
    // §14 case 4 / #342: missing code-reading consent → forced-Off control with an enable path.
    if (s.consentMissing) {
        return { state: 'degraded', reason: 'consent-missing' };
    }
    // Happy path AND §14 case 6 (transient `unavailable` blip self-heals on the next refresh; never a false "off").
    return { state: 'available', reason: undefined };
}
