import type { VsCodeApi } from '@shared/messageContracts';

export interface CourseDetailViewProps {
    vscodeApi: VsCodeApi;
}

/** CourseDetail state that survives tab cycles. */
export interface CourseDetailPersistedState {
    exerciseSearchTerm?: string;
    exerciseSortBy?: string;
}
