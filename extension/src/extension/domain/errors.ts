// --- API Error ---

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly detail?: string,
        /**
         * Artemis' stable discriminator (its response's `errorKey`), e.g.
         * `iris.course_disabled`. `detail` is whichever human-facing field won
         * the parse and may be reworded at will, so branch on this instead.
         */
        public readonly errorKey?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Thrown when an API response cannot be parsed or violates its declared schema.
 * Subclass of `ApiError` so existing `instanceof ApiError` checks keep working;
 * callers that want to distinguish contract/schema failures from transport
 * failures use `instanceof MalformedResponseError` directly.
 */
export class MalformedResponseError extends ApiError {
    constructor(message: string, status: number, detail?: string) {
        super(message, status, detail);
        this.name = 'MalformedResponseError';
    }
}

/** Artemis' `errorKey` for "this course has Iris switched off". */
const IRIS_COURSE_DISABLED = 'iris.course_disabled';

/**
 * Tells a settings-level refusal apart from a transient failure. Only an
 * instructor can lift the former, so inviting an immediate retry is misleading,
 * and the client treats such a course as a place it can still go rather than as
 * a failed request.
 *
 * Matched on the stable `errorKey`, never on `detail`: that one is a fallback
 * chain over human-facing fields and degrades to prose without notice.
 */
export function isIrisCourseDisabled(error: unknown): boolean {
    return error instanceof ApiError
        && error.status === 403
        && error.errorKey === IRIS_COURSE_DISABLED;
}
