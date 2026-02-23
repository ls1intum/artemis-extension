import type { VsCodeApi } from '../../../../../shared/messageContracts';

/**
 * Props for ExerciseDetailView component.
 */
export interface ExerciseDetailViewProps {
    vscodeApi: VsCodeApi;
}

/**
 * Test case structure for test results.
 */
export interface TestCase {
    name: string;
    passed: boolean;
    message?: string;
}

/**
 * Props for ProblemStatement extracted component.
 */
export interface ProblemStatementProps {
    markdown: string;
    downloadLinks?: Array<{ name: string; url: string }>;
    onDownload?: (url: string, name: string) => void;
}

/**
 * Props for ScoreInfo extracted component.
 */
export interface ScoreInfoProps {
    score: number | null;
    maxScore: number;
    bonusPoints?: number;
    assessmentType?: string;
    completionDate?: string;
}

/**
 * Props for TestResults extracted component.
 */
export interface TestResultsProps {
    testCases: TestCase[];
}
