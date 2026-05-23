import type { CourseDashboardCourse } from '@shared/types/apiResponses';

import type { CourseDetailData } from './domainTypes';

/**
 * Maps a raw `CourseDashboardCourse` (server response, all fields optional,
 * carries unknown extra keys) to the validated `CourseDetailData` shape used
 * by the webview state.
 *
 * Returns `null` when the input is missing the only field the webview cannot
 * tolerate (a numeric `id`). Callers are expected to log and either bail out
 * or drop the row. The mapper itself stays pure: no logging, no throwing,
 * no `[key: string]: unknown` leakage into the domain DTO. Fields are listed
 * explicitly so unknown server keys (e.g. `exams`) are dropped at the
 * boundary instead of being smuggled into webview state.
 *
 * Runtime check is `typeof course.id !== 'number'` rather than `=== undefined`
 * so a malformed server payload sending `null` or a string id also drops to
 * null instead of being smuggled past static optionality.
 */
export function toCourseDetailData(
    course: CourseDashboardCourse | undefined,
    opts?: { isArchived?: boolean }
): CourseDetailData | null {
    if (!course || typeof course.id !== 'number') {
        return null;
    }
    return {
        course: {
            id: course.id,
            title: course.title || 'Untitled Course',
            description: course.description,
            semester: course.semester,
            color: course.color,
            exercises: course.exercises,
            numberOfStudents: course.numberOfStudents,
            instructorGroupName: course.instructorGroupName,
            shortName: course.shortName,
            startDate: course.startDate,
            isArchived: opts?.isArchived,
        },
    };
}
