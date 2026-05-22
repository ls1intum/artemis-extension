import type { ArchivedCourse, CourseDetailData, ExtMsg } from '@shared/messageContracts';

export function createCourseListPayload(
    overrides?: Partial<Omit<ExtMsg<'courseListInit'>, 'type'>>,
): ExtMsg<'courseListInit'> {
    return {
        type: 'courseListInit',
        courses: [] as CourseDetailData[],
        archivedCourses: [] as ArchivedCourse[],
        ...overrides,
    };
}
