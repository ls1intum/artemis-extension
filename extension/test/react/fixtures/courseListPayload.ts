import type { ExtMsg, CourseData, ArchivedCourse } from '../../../src/shared/messageContracts';

export function createCourseListPayload(
    overrides?: Partial<Omit<ExtMsg<'courseListInit'>, 'type'>>,
): ExtMsg<'courseListInit'> {
    return {
        type: 'courseListInit',
        courses: [] as CourseData[],
        archivedCourses: [] as ArchivedCourse[],
        ...overrides,
    };
}
