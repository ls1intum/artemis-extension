import * as assert from 'assert';

import { contextToIrisMode } from '@extension/services/iris/context/contextChatMode';

suite('contextToIrisMode', () => {
    test('maps course → COURSE_CHAT', () => {
        assert.strictEqual(contextToIrisMode('course'), 'COURSE_CHAT');
    });

    test('maps exercise → PROGRAMMING_EXERCISE_CHAT', () => {
        assert.strictEqual(contextToIrisMode('exercise'), 'PROGRAMMING_EXERCISE_CHAT');
    });
});
