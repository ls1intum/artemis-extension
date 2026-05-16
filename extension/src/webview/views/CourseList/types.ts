import type { VsCodeApi, CourseData, ArchivedCourse } from '@shared/messageContracts';

export interface CourseListViewProps {
    vscodeApi: VsCodeApi;
}

export interface CourseListPersistedState {
    searchTerm?: string;
    typeFilter?: string;
    semesterFilter?: string;
    sortBy?: string;
}

// Re-export types from messageContracts
export type { CourseData, ArchivedCourse };
