// --- Iris Health Status ---

export class IrisRateLimitInfo {
    constructor(
        public readonly currentMessageCount: number,
        public readonly rateLimit: number,
        public readonly rateLimitTimeframeHours: number,
    ) {}

    static fromJSON(data: unknown): IrisRateLimitInfo {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid IrisRateLimitInfo data');
        }
        const d = data as Record<string, unknown>;
        return new IrisRateLimitInfo(
            Number(d.currentMessageCount),
            Number(d.rateLimit),
            Number(d.rateLimitTimeframeHours),
        );
    }
}

export class IrisHealthStatus {
    constructor(
        public readonly active: boolean,
        public readonly rateLimitInfo?: IrisRateLimitInfo,
    ) {}

    static fromJSON(data: unknown): IrisHealthStatus {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid IrisHealthStatus data');
        }
        const d = data as Record<string, unknown>;
        return new IrisHealthStatus(
            Boolean(d.active),
            d.rateLimitInfo && typeof d.rateLimitInfo === 'object' ? IrisRateLimitInfo.fromJSON(d.rateLimitInfo) : undefined,
        );
    }
}
