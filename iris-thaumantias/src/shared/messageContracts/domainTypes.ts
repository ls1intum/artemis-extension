/**
 * Domain types shared between extension and webview messages.
 */

// Re-export ExerciseDetail for use in navigationCommands and other consumers
export type { ExerciseDetail } from '../types/apiResponses';

export interface CourseData {
    course: {
        id?: number;
        title: string;
        description?: string;
        semester?: string;
        color?: string;
        exercises?: Exercise[];
        numberOfStudents?: number;
        instructorGroupName?: string;
        startDate?: string;
    };
}

export interface RecentCourseNode {
    courseData: CourseData;
    exercises: Exercise[];
}

export interface Exercise {
    id?: number;
    title?: string;
    type?: string;
    releaseDate?: string;
    startDate?: string;
    dueDate?: string;
    maxPoints?: number;
}

export interface ArchivedCourse {
    id: number;
    title: string;
    semester?: string;
    color?: string;
}

export interface Exam {
    id: number;
    title?: string;
    startDate?: string;
    endDate?: string;
}

export interface CourseDetailData {
    course: {
        id: number;
        title: string;
        description?: string;
        semester?: string;
        color?: string;
        exercises?: Exercise[];
        exams?: Exam[];
        numberOfStudents?: number;
        instructorGroupName?: string;
        isArchived?: boolean;
        shortName?: string;
    };
}
