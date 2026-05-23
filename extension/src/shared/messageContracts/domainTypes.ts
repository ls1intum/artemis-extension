/**
 * Domain types shared between extension and webview messages.
 */

import type { ExerciseDetail } from '../types/apiResponses';

export interface RecentCourseNode {
    courseData: CourseDetailData;
    exercises: ExerciseDetail[];
}

export interface ArchivedCourse {
    id: number;
    title: string;
    semester?: string;
    color?: string;
}

export interface CourseDetailData {
    course: {
        id: number;
        title: string;
        description?: string;
        semester?: string;
        color?: string;
        exercises?: ExerciseDetail[];
        numberOfStudents?: number;
        instructorGroupName?: string;
        isArchived?: boolean;
        shortName?: string;
        startDate?: string;
    };
}
