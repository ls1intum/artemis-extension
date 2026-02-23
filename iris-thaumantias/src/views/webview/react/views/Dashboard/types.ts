import type { VsCodeApi } from '../../../../../shared/messageContracts';

export interface DashboardViewProps {
    vscodeApi: VsCodeApi;
}

export interface DashboardPersistedState {
    // Dashboard data is always re-fetched, so no persisted state needed
}

export interface Exercise {
    id?: number;
    title?: string;
    type?: string;
    releaseDate?: string;
    startDate?: string;
    dueDate?: string;
}

export interface CourseData {
    course: {
        id?: number;
        title: string;
        exercises?: Exercise[];
        startDate?: string;
        creationDate?: string;
    };
}

export interface RecentCourseNode {
    courseData: CourseData;
    exercises: Exercise[];
}
