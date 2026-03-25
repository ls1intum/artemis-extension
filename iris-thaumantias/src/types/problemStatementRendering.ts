/**
 * TypeScript DTOs for the Artemis problem statement rendering endpoint.
 * Maps to Java DTOs in de.tum.cit.aet.artemis.exercise.dto.
 */

/** Maps to Java TestFeedbackInput */
export interface TestFeedbackInput {
    testId: number;
    testName: string;
    passed: boolean;
    message?: string;
    credits?: number;
}

/** Maps to Java ResultSummaryInput */
export interface ResultSummaryInput {
    score?: number;
    maxPoints?: number;
    bonusPoints?: number;
    commitHash?: string;
    submissionDate?: string;
    assessmentType?: string;
}

/** Maps to Java ProblemStatementRenderRequest */
export interface ProblemStatementRenderRequest {
    markdown: string;
    testResults?: TestFeedbackInput[];
    resultSummary?: ResultSummaryInput;
    locale?: string;
    darkMode: boolean;
    interactive: boolean;
}

/** Maps to Java RenderedProblemStatementDTO */
export interface RenderedProblemStatementDTO {
    html: string;
    contentHash: string;
    rendererVersion: string;
    interactiveScript?: string;
}
