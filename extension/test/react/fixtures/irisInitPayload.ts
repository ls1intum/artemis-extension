import type { ExtMsg } from '@shared/messageContracts';

export function createIrisInitPayload(
    overrides?: Partial<ExtMsg<'updateIrisState'>['state']>,
): ExtMsg<'updateIrisState'> {
    return {
        type: 'updateIrisState',
        state: {
            exercises: [
                { id: 10, title: 'Recent Exercise', shortName: 'RE', courseId: 1 },
            ],
            courses: [
                { id: 1, title: 'Test Course', shortName: 'TC' },
            ],
            courseId: 1,
            courseTitle: 'Test Course',
            currentSessionId: 42,
            conversationTitle: 'Hello, how can I help?',
            displayMessageCount: 2,
            committedContext: undefined,
            pendingContext: undefined,
            contentState: 'content',
            sendInFlight: false,
            navigationInFlight: false,
            conversations: [],
            workspaceExerciseId: undefined,
            // This fixture's default shape already has a course and an open
            // session, i.e. not a cold start: 'settled' is simply the value
            // that state would carry once detection has long since resolved.
            detectionState: 'settled',
            coursesUnavailable: false,
            ...overrides,
        },
    };
}
