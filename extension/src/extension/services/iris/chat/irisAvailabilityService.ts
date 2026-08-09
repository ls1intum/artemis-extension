import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import { MalformedResponseError } from '@extension/domain/errors';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ApiError, type IrisSettingsResponse } from '@extension/types';

/**
 * What the availability check runs against. Derived from where the chat IS (see
 * `ChatWebviewProvider._availabilityContext`), not from any stored selection:
 * Iris settings are a course-level question. Usually that is the open
 * conversation; a course whose Iris is switched off is entered without one, and
 * then the course itself is the context.
 */
export interface AvailabilityContext {
    type: 'course' | 'exercise';
    id: number;
    title: string;
    courseId?: number;
}

/**
 * Three-way availability classification for the Iris chat. The distinction
 * matters in the UI: `disabled` shows the persistent "instructor disabled
 * Iris" overlay, while `unavailable` shows a transient "temporarily
 * unavailable, retry" banner. Conflating the two misleads students into
 * thinking their course turned Iris off whenever the network blips.
 */
export type IrisAvailability =
    | { kind: 'enabled' }
    | { kind: 'disabled' }
    | { kind: 'unavailable'; reason: string };

/**
 * Tracked availability state with the context the classification belongs to,
 * so a stale classification for a conversation the student has left can be
 * told apart from the current one.
 */
type LastAvailability =
    | { kind: 'unknown'; contextKey?: undefined }
    | { kind: IrisAvailability['kind']; contextKey: string };

const UNAVAILABLE_USER_MESSAGE = 'Iris is temporarily unavailable. Retry to reload.';

function contextKeyOf(context: AvailabilityContext | null): string | undefined {
    return context ? `${context.type}:${context.id}` : undefined;
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    return String(error);
}

/**
 * Owns the "is Iris usable here" question and the two banners that answer it.
 * Everything else the old `IrisChatSessionService` did (acquiring, importing
 * and switching local sessions) is `IrisConversationService`'s now.
 */
export class IrisAvailabilityService {
    private _lastAvailability: LastAvailability = { kind: 'unknown' };

    constructor(
        private readonly _catalog: CourseCatalog | undefined,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
    ) { }

    /** Most recent availability classification, paired with its context. */
    public get lastAvailability(): LastAvailability {
        return this._lastAvailability;
    }

    /**
     * Clear the tracked availability state. Called on navigation so a stale
     * `unavailable` from a previous conversation cannot leak into the new
     * one. Does not emit any UI messages: the caller is responsible for
     * hiding banners for the outgoing conversation.
     */
    public resetAvailability(): void {
        this._lastAvailability = { kind: 'unknown' };
    }

    /**
     * Single emission point for availability state, which keeps the "always
     * clear the opposite banner" invariant in one place and records
     * `lastAvailability` alongside the UI signal.
     */
    public postAvailability(availability: IrisAvailability, context: AvailabilityContext | null): void {
        const key = contextKeyOf(context);
        this._lastAvailability = key
            ? { kind: availability.kind, contextKey: key }
            : { kind: 'unknown' };

        switch (availability.kind) {
            case 'enabled':
                this._postMessage({ type: ExtensionMsg.HideDisabledState });
                this._postMessage({ type: ExtensionMsg.HideUnavailableState });
                break;
            case 'disabled': {
                const label = context?.type === 'course' ? 'course' : 'exercise';
                this._postMessage({
                    type: ExtensionMsg.ShowDisabledState,
                    message: `Iris chat is not enabled for this ${label}. Please contact your instructor.`,
                });
                this._postMessage({ type: ExtensionMsg.HideUnavailableState });
                break;
            }
            case 'unavailable':
                this._postMessage({
                    type: ExtensionMsg.ShowUnavailableState,
                    message: UNAVAILABLE_USER_MESSAGE,
                });
                this._postMessage({ type: ExtensionMsg.HideDisabledState });
                break;
        }
    }

    /**
     * Delegates to the shared {@link classifyIrisCourseAvailability} helper and
     * drops the raw settings, which only the proactive-control path needs.
     */
    public async checkAndLoadIrisSettings(context: AvailabilityContext): Promise<IrisAvailability> {
        const { availability } = await classifyIrisCourseAvailability(this._artemisApiService, this._catalog, context);
        return availability;
    }
}

/**
 * Classifies Iris availability for a chat context, and hands back the raw settings
 * alongside it. Module-level rather than a method because two callers need it
 * outside the webview: the proactive-control commands read
 * `proactiveStruggleEnabled` off the settings, and the struggle engine's
 * IrisEnabledCache classifies without a provider at all. Keeping one
 * implementation is what stops those three from drifting apart.
 */
export async function classifyIrisCourseAvailability(
    api: ArtemisApiService | undefined,
    catalog: CourseCatalog | undefined,
    context: AvailabilityContext,
): Promise<{ availability: IrisAvailability; settings?: IrisSettingsResponse }> {
if (!api) {
        logger.warn('Artemis API service not available', LogCategory.IRIS_CHAT);
        return { availability: { kind: 'unavailable', reason: 'Artemis API service not initialized' } };
    }

    logger.info(`Checking Iris settings for ${context.type}: ${context.title}`, LogCategory.IRIS_CHAT);

    // Step 1: Profile probe. A 403 here is NOT a disable signal. That
    // would mean "user not allowed to read the server profile", which
    // is an infrastructure / auth issue. Profile-fetch failures
    // therefore funnel through the same `unavailable` path as any
    // other infra error.
    let profileInfo;
    try {
        profileInfo = await api.getProfileInfo();
    } catch (error: unknown) {
        logger.error('Profile info fetch failed for Iris check:', LogCategory.IRIS_CHAT, error);
        return { availability: { kind: 'unavailable', reason: `Profile probe failed: ${describeError(error)}` } };
    }
    if (!api.isIrisProfileActive(profileInfo)) {
        logger.info('Iris profile not active on server (global check failed)', LogCategory.IRIS_CHAT);
        return { availability: { kind: 'disabled' } };
    }

    // Step 2: Resolve courseId for an exercise context. Failures here
    // are transient (registry not populated yet, exercise-details
    // endpoint dropped), never a disable signal.
    let courseId: number;
    if (context.type === 'course') {
        courseId = context.id;
    } else if (context.type === 'exercise') {
        let resolvedCourseId: number | undefined;
        try {
            resolvedCourseId = context.courseId
                ?? (catalog
                    ? await resolveCourseIdForExercise(context.id, catalog, api)
                    : undefined);
        } catch (error: unknown) {
            logger.error('Course resolution failed for exercise context:', LogCategory.IRIS_CHAT, error);
            return { availability: { kind: 'unavailable', reason: `Could not resolve course: ${describeError(error)}` } };
        }
        if (!resolvedCourseId) {
            logger.warn('Unable to resolve course for exercise context; cannot check Iris settings', LogCategory.IRIS_CHAT);
            return { availability: { kind: 'unavailable', reason: 'Could not resolve course for this exercise' } };
        }
        courseId = resolvedCourseId;
    } else {
        logger.warn(`Unsupported context type for Iris: ${String(context.type)}`, LogCategory.IRIS_CHAT);
        return { availability: { kind: 'disabled' } };
    }

    // Step 3: Iris settings call. This is the ONLY endpoint where a
    // 403 has a "disabled" semantic (course-level forbidden = Iris
    // chat off for this user). All other status codes (incl. 401,
    // 4xx, 5xx) plus network/timeout/malformed map to unavailable
    // through the shared classifier.
    let settings: IrisSettingsResponse;
    try {
        settings = await api.getIrisCourseChatSettings(courseId);
    } catch (error: unknown) {
        logger.error('Iris settings fetch failed:', LogCategory.IRIS_CHAT, error);
        return { availability: classifyAvailabilityFromError(error) };
    }

    // Distinguish "enabled is explicitly false" from "enabled field is
    // missing / non-boolean". The latter signals a malformed response,
    // which is a transport-layer issue, not an intentional disable.
    const chatSettings = settings?.settings;
    if (!chatSettings || typeof chatSettings.enabled !== 'boolean') {
        logger.warn('Iris settings response is missing or malformed', LogCategory.IRIS_CHAT, { settings });
        return { availability: { kind: 'unavailable', reason: 'Malformed Iris settings response' } };
    }
    if (chatSettings.enabled === false) {
        logger.info('Iris chat is disabled in settings', LogCategory.IRIS_CHAT);
        return { availability: { kind: 'disabled' } };
    }

    logger.info('Iris chat is enabled, settings loaded:', LogCategory.IRIS_CHAT, {
        enabled: chatSettings.enabled,
        rateLimit: settings?.effectiveRateLimit?.requests,
        rateLimitTimeframeHours: settings?.effectiveRateLimit?.timeframeHours
    });

    return { availability: { kind: 'enabled' }, settings };
}

/**
 * Maps a raw error (from `fetch`, `ApiError`, schema validation, etc.) to an
 * {@link IrisAvailability}.
 *
 * Rules:
 *   - `ApiError(403)`   → disabled (course-level forbidden = disabled for this user)
 *   - any other `ApiError` (401/404/4xx/5xx)         → unavailable
 *   - `MalformedResponseError` (subclass of ApiError) → unavailable
 *   - any other Error / network / `TypeError`        → unavailable
 *
 * No string-matching on `error.message.includes('403')`: the historical
 * fallback was inherited code with no good reason to keep it and could
 * misclassify unrelated errors whose message happened to contain '403'.
 */
function classifyAvailabilityFromError(error: unknown): IrisAvailability {
    if (error instanceof MalformedResponseError) {
        return { kind: 'unavailable', reason: `Malformed response: ${error.message}` };
    }
    if (error instanceof ApiError) {
        if (error.status === 403) {
            return { kind: 'disabled' };
        }
        return { kind: 'unavailable', reason: `Server returned ${error.status}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'unavailable', reason: message || 'Unknown error' };
}
