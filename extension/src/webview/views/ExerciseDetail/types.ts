import type { VsCodeApi } from '@shared/messageContracts';

export interface ExerciseDetailViewProps {
    vscodeApi: VsCodeApi;
}

export interface ProblemStatementProps {
    serverRenderedHtml?: string;
    onTaskClick?: (task: { taskName: string; testIds: number[] }) => void;
    vscodeApi: VsCodeApi;
}
