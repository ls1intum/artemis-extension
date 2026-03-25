// --- Iris Health Status ---

export interface IrisRateLimitInfo {
    readonly currentMessageCount: number;
    readonly rateLimit: number;
    readonly rateLimitTimeframeHours: number;
}

export function parseIrisRateLimitInfo(data: unknown): IrisRateLimitInfo {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid IrisRateLimitInfo data');
    }
    const d = data as Record<string, unknown>;
    return {
        currentMessageCount: Number(d.currentMessageCount),
        rateLimit: Number(d.rateLimit),
        rateLimitTimeframeHours: Number(d.rateLimitTimeframeHours),
    };
}

export interface IrisHealthStatus {
    readonly active: boolean;
    readonly rateLimitInfo?: IrisRateLimitInfo;
}

export function parseIrisHealthStatus(data: unknown): IrisHealthStatus {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid IrisHealthStatus data');
    }
    const d = data as Record<string, unknown>;
    return {
        active: Boolean(d.active),
        rateLimitInfo: d.rateLimitInfo && typeof d.rateLimitInfo === 'object' ? parseIrisRateLimitInfo(d.rateLimitInfo) : undefined,
    };
}
