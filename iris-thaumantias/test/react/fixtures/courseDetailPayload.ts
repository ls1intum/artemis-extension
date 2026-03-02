import type { CourseDetailInitMessage } from '../../../src/shared/messageContracts';

export function createCourseDetailPayload(
    overrides?: Partial<Omit<CourseDetailInitMessage, 'type'>>,
): CourseDetailInitMessage {
    return {
        type: 'courseDetailInit',
        courseData: { course: { id: 1, title: 'Test Course' } },
        hideDeveloperTools: false,
        ...overrides,
    };
}
