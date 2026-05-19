import type { CourseDashboardCourse } from '../types/apiResponses';
import type { CourseDetailData } from './domainTypes';

/**
 * Maps a raw CourseDashboardCourse to CourseDetailData.
 * Spreads the raw course to preserve all server-provided fields,
 * then overlays the required fields with safe defaults.
 */
export function toCourseDetailData(
    course: CourseDashboardCourse,
    opts?: { isArchived?: boolean }
): CourseDetailData {
    // Drop any server-provided exam data — exam mode is not supported.
    const { exams: _exams, ...rest } = course;
    return {
        course: {
            ...rest,
            id: course.id!,
            title: course.title || 'Untitled Course',
            isArchived: opts?.isArchived,
        } as CourseDetailData['course'],
    };
}
