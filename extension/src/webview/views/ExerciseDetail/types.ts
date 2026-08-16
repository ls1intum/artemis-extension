import type { VsCodeApi } from '@shared/messageContracts';

export interface ExerciseDetailViewProps {
    vscodeApi: VsCodeApi;
}

export interface ProblemStatementProps {
    serverRenderedHtml?: string;
    onTaskClick?: (task: { taskName: string; testIds: number[] }) => void;
    vscodeApi: VsCodeApi;
}

export interface ScoreInfoProps {
    score: number | null;
    maxScore: number;
    bonusPoints?: number;
    assessmentType?: string;
    completionDate?: string;
}
