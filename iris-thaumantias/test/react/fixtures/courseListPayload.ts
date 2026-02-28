import type { CourseListInitMessage, CourseData, ArchivedCourse } from '../../../src/shared/messageContracts';

export function createCourseListPayload(
    overrides?: Partial<CourseListInitMessage['payload']>,
): CourseListInitMessage {
    return {
        type: 'courseListInit',
        payload: {
            courses: [] as CourseData[],
            archivedCourses: [] as ArchivedCourse[],
            ...overrides,
        },
    };
}
