import * as assert from 'assert';

import { buildCourseHistory } from '@extension/services/iris/context/courseHistory';
import type { IrisChatMode, SessionSummary } from '@extension/types';

const summary = (overrides: {
    id?: number;
    mode?: IrisChatMode;
    entityId?: number;
    entityName?: string;
    title?: string;
    lastActivity?: number;
}): SessionSummary => ({
    sessionId: overrides.id ?? 1,
    courseId: 7,
    context: {
        mode: overrides.mode ?? 'COURSE_CHAT',
        entityId: overrides.entityId ?? 1,
        name: overrides.entityName,
    },
    title: overrides.title,
    lastActivity: overrides.lastActivity ?? Date.parse('2025-01-01T00:00:00Z'),
});

suite('buildCourseHistory', () => {
    test('surfaces every mode, including the ones that can never be a topic', () => {
        const out = buildCourseHistory(
            [
                summary({ id: 1, mode: 'COURSE_CHAT' }),
                summary({ id: 2, mode: 'LECTURE_CHAT' }),
                summary({ id: 3, mode: 'TEXT_EXERCISE_CHAT' }),
                summary({ id: 4, mode: 'PROGRAMMING_EXERCISE_CHAT' }),
            ],
            7,
        );

        // A lecture or text-exercise conversation is openable by id even
        // though the topic picker can never select one, so the history must
        // list it (spec 5.4).
        assert.deepStrictEqual(
            out.map((entry) => entry.artemisSessionId).sort((a, b) => a - b),
            [1, 2, 3, 4],
        );
    });

    test('sorts newest first by lastActivity', () => {
        const out = buildCourseHistory(
            [
                summary({ id: 1, lastActivity: Date.parse('2025-06-01T00:00:00Z') }),
                summary({ id: 2, lastActivity: Date.parse('2025-03-01T00:00:00Z') }),
            ],
            7,
        );

        assert.deepStrictEqual(out.map((entry) => entry.artemisSessionId), [1, 2]);
    });

    test('carries lastActivity 0 straight through (date parsing already happened server-side)', () => {
        const out = buildCourseHistory([summary({ id: 1, lastActivity: 0 })], 7);

        assert.strictEqual(out[0].lastActivity, 0);
    });

    test('carries courseId, entityId, entityName and title onto each entry, without a message count', () => {
        const out = buildCourseHistory(
            [summary({ id: 1, entityId: 42, entityName: 'Sorting Algorithms', title: 'My chat' })],
            9,
        );

        assert.deepStrictEqual(out[0], {
            artemisSessionId: 1,
            courseId: 9,
            mode: 'COURSE_CHAT',
            entityId: 42,
            entityName: 'Sorting Algorithms',
            title: 'My chat',
            lastActivity: Date.parse('2025-01-01T00:00:00Z'),
        });
    });
});
