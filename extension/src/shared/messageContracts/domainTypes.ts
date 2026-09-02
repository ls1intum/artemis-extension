/**
 * Domain types shared between extension and webview messages.
 */

import type { ExerciseDetail } from '@shared/types/apiResponses';

/**
 * Correlates an answer with the request that asked for it.
 *
 * Unique per view MOUNT, not merely per attempt. `render()` replaces the whole
 * webview document, so a counter that restarted at 1 in the new one would let a
 * message still in flight for the previous view match a question the new view
 * happens to have numbered the same. A string, because the uniqueness comes
 * from a per-mount prefix and nothing may treat this as arithmetic.
 */
export type AttemptId = string;

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
