// --- Build Log Types ---

export interface BuildLogEntry {
    readonly id: number;
    readonly time: string;
    readonly log: string;
}

export function parseBuildLogEntry(data: unknown): BuildLogEntry {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid BuildLogEntry data');
    }
    const d = data as Record<string, unknown>;
    return {
        id: Number(d.id),
        time: String(d.time),
        log: String(d.log),
    };
}

export interface ParsedBuildError {
    readonly filePath: string;
    readonly line: number;
    readonly message: string;
    readonly column?: number;
}

