import type { ExtMsg } from '@shared/messageContracts';

export function createIrisInitPayload(
    overrides?: Partial<ExtMsg<'updateIrisState'>['state']>,
): ExtMsg<'updateIrisState'> {
    return {
        type: 'updateIrisState',
        state: {
            context: {
                type: 'course',
                id: 1,
                title: 'Test Course',
                shortName: 'TC',
                locked: false,
                source: 'user-selected',
            },
            activeSessionId: 'session-1',
            sessions: [
                {
                    id: 'session-1',
                    artemisSessionId: 42,
                    preview: 'Hello, how can I help?',
                    messageCount: 2,
                    createdAt: 1700000000000,
                    lastActivity: 1700001000000,
                },
            ],
            exercises: [
                { id: 10, title: 'Recent Exercise', shortName: 'RE', courseId: 1, isWorkspace: false },
            ],
            courses: [
                { id: 1, title: 'Test Course', shortName: 'TC' },
            ],
            ...overrides,
        },
    };
}
