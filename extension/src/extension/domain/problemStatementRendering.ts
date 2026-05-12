/** Maps to Java TestFeedbackInput */
export interface TestFeedbackInput {
    readonly testId: number;
    readonly testName: string;
    readonly passed: boolean;
    readonly message?: string;
    readonly credits?: number;
}

/** Maps to Java ProblemStatementRenderRequest */
export interface ProblemStatementRenderRequest {
    readonly markdown: string;
    readonly testResults?: TestFeedbackInput[];
    readonly locale?: string;
    readonly darkMode: boolean;
    readonly includeJs: boolean;
    readonly includeCss?: boolean;
    readonly inlineImages?: boolean;
}

/** Maps to Java RenderedProblemStatementDTO */
export interface RenderedProblemStatementDTO {
    readonly html: string;
    readonly contentHash: string;
    readonly rendererVersion: string;
}
