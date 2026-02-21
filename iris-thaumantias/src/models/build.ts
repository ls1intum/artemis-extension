// --- Build Log Types ---

export class BuildLogEntry {
    constructor(
        public readonly id: number,
        public readonly time: string,
        public readonly log: string,
    ) {}

    static fromJSON(data: unknown): BuildLogEntry {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid BuildLogEntry data');
        }
        const d = data as Record<string, unknown>;
        return new BuildLogEntry(
            Number(d.id),
            String(d.time),
            String(d.log),
        );
    }
}

export class ParsedBuildError {
    constructor(
        public readonly filePath: string,
        public readonly line: number,
        public readonly message: string,
        public readonly column?: number,
    ) {}

    static fromJSON(data: unknown): ParsedBuildError {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ParsedBuildError data');
        }
        const d = data as Record<string, unknown>;
        return new ParsedBuildError(
            String(d.filePath),
            Number(d.line),
            String(d.message),
            typeof d.column === 'number' ? d.column : undefined,
        );
    }
}
