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

    test('cancelling after consumption records the intent, and a later re-arm cannot undo it', () => {
        // The old behaviour here was `cancel()` no-opping on a `consumed`
        // latch, on the premise that `consumed` was terminal. It stopped
        // being terminal the moment `reArmAfterFailedStart` existed: an
        // intent arriving while the automatic attempt is still in flight
        // (a real HTTP round trip, easily pending for hundreds of
        // milliseconds) must still be recorded, or a later failure of that
        // very attempt hands the automatic path a second chance the student
        // had already refused.
        const latch = new StartupLatch();
        latch.consume();

        latch.cancel('selectTopic');
        assert.strictEqual(latch.state, 'cancelled', 'an intent arriving mid-flight must still be recorded');

        latch.reArmAfterFailedStart();
        assert.strictEqual(latch.state, 'cancelled', 'a later re-arm must not revive it');
        assert.strictEqual(latch.consume(), false);
    });

    test('reArmAfterFailedStart returns a consumed latch to eligible', () => {
        const latch = new StartupLatch();
        latch.consume();

        latch.reArmAfterFailedStart();

        assert.strictEqual(latch.state, 'eligible');
        assert.strictEqual(latch.consume(), true, 'a re-armed latch can be consumed again');
    });

    test('reArmAfterFailedStart never resurrects a cancelled latch', () => {
        const latch = new StartupLatch();
        latch.cancel('switchCourse');

        latch.reArmAfterFailedStart();

        assert.strictEqual(latch.state, 'cancelled',
            'an explicit student intent must win permanently, even over a failed automatic attempt');
        assert.strictEqual(latch.consume(), false);
    });

    test('reArmAfterFailedStart on a still-eligible latch is a no-op', () => {
        const latch = new StartupLatch();

        latch.reArmAfterFailedStart();

        assert.strictEqual(latch.state, 'eligible');
    });
});
