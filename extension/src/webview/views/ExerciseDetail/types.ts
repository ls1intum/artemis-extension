import type { VsCodeApi } from '@shared/messageContracts';

/**
 * Props for ExerciseDetailView component.
 */
export interface ExerciseDetailViewProps {
    vscodeApi: VsCodeApi;
}

/**
 * Props for ProblemStatement extracted component.
 */
export interface ProblemStatementProps {
    serverRenderedHtml?: string;
    onTaskClick?: (task: { taskName: string; testIds: number[] }) => void;
    vscodeApi: VsCodeApi;
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
