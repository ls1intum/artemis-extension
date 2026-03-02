import type { CourseListInitMessage, CourseData, ArchivedCourse } from '../../../src/shared/messageContracts';

export function createCourseListPayload(
    overrides?: Partial<Omit<CourseListInitMessage, 'type'>>,
): CourseListInitMessage {
    return {
        type: 'courseListInit',
        courses: [] as CourseData[],
        archivedCourses: [] as ArchivedCourse[],
        ...overrides,
    };
}
