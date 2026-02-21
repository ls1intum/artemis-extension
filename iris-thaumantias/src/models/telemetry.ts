// ============================================================================
// Phase 3: Telemetry Model Classes (only boundary types with fromJSON)
// ============================================================================

export class BuildResult {
    constructor(
        public readonly timestamp: number,
        public readonly success: boolean,
        public readonly errorCount: number,
        public readonly failedTests: string[],
        public readonly buildLog: string | undefined,
        public readonly submissionId: number | undefined,
        public readonly rawBuildFailed?: boolean,
    ) {}

    static fromJSON(data: unknown): BuildResult {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid BuildResult data');
        }
        const d = data as Record<string, unknown>;
        return new BuildResult(
            typeof d.timestamp === 'number' ? d.timestamp : Date.now(),
            Boolean(d.success),
            typeof d.errorCount === 'number' ? d.errorCount : 0,
            Array.isArray(d.failedTests) ? d.failedTests.map(String) : [],
            typeof d.buildLog === 'string' ? d.buildLog : undefined,
            typeof d.submissionId === 'number' ? d.submissionId : undefined,
            typeof d.rawBuildFailed === 'boolean' ? d.rawBuildFailed : undefined,
        );
    }
}
