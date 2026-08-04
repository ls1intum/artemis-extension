import * as assert from 'assert';

import { StartupLatch } from '@extension/services/iris/startup/startupLatch';

suite('StartupLatch', () => {
    test('consumes exactly once', () => {
        const latch = new StartupLatch();
        assert.strictEqual(latch.consume(), true);
        assert.strictEqual(latch.consume(), false, 'a second automatic start must never happen');
        assert.strictEqual(latch.state, 'consumed');
    });

    test('a cancelled latch can never be consumed', () => {
        const latch = new StartupLatch();
        latch.cancel('switchCourse');
        assert.strictEqual(latch.consume(), false);
        assert.strictEqual(latch.state, 'cancelled');
    });

    test('cancelling after consumption does not resurrect anything', () => {
        const latch = new StartupLatch();
        latch.consume();
        latch.cancel('selectTopic');
        assert.strictEqual(latch.state, 'consumed');
        assert.strictEqual(latch.consume(), false);
    });
});
