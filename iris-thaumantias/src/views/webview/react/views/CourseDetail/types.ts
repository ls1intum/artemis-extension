import type { VsCodeApi } from '../../../../../shared/messageContracts';

export interface CourseDetailViewProps {
    vscodeApi: VsCodeApi;
}

/**
 * Persisted state for CourseDetail view.
 * This state is preserved across tab cycles.
 */
export interface CourseDetailPersistedState {
    exerciseSearchTerm?: string;
    exerciseSortBy?: string;
}
