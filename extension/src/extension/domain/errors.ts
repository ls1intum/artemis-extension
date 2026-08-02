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
