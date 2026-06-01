import type { ExtMsg } from '@shared/messageContracts';

export function createCourseDetailPayload(
    overrides?: Partial<Omit<ExtMsg<'courseDetailInit'>, 'type'>>,
): ExtMsg<'courseDetailInit'> {
    return {
        type: 'courseDetailInit',
        courseData: { course: { id: 1, title: 'Test Course' } },
        hideDeveloperTools: false,
        ...overrides,
    };
}
