import type { CourseDetailInitMessage } from '../../../src/shared/messageContracts';

export function createCourseDetailPayload(
    overrides?: Partial<CourseDetailInitMessage['payload']>,
): CourseDetailInitMessage {
    return {
        type: 'courseDetailInit',
        payload: {
            courseData: { course: { id: 1, title: 'Test Course' } },
            hideDeveloperTools: false,
            ...overrides,
        },
    };
}
