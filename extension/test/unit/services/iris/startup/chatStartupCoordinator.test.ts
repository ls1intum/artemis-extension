import * as assert from 'assert';
import * as sinon from 'sinon';

import { ChatStartupCoordinator } from '@extension/services/iris/startup/chatStartupCoordinator';

function makeCoordinator() {
    const start = sinon.stub().resolves();
    const publishDetectionState = sinon.spy();
    const retryDetection = sinon.spy();
    const coordinator = new ChatStartupCoordinator({ start, publishDetectionState, retryDetection });
    return { coordinator, start, publishDetectionState, retryDetection };
}

const MATCH = { kind: 'matched', exerciseId: 3, courseId: 9 } as const;

suite('ChatStartupCoordinator', () => {
    test('starts once when the view resolves first', () => {
        const { coordinator, start } = makeCoordinator();
        coordinator.onViewResolved();
        assert.strictEqual(start.called, false, 'nothing may start before detection settles');
        coordinator.onDetectionSettled(MATCH);
        assert.strictEqual(start.callCount, 1);
        assert.deepStrictEqual(start.firstCall.args[0], { exerciseId: 3, courseId: 9 });
    });

    test('starts once when detection settles first', () => {
        const { coordinator, start } = makeCoordinator();
        coordinator.onDetectionSettled(MATCH);
        assert.strictEqual(start.called, false, 'nothing may start before there is a view');
        coordinator.onViewResolved();
        assert.strictEqual(start.callCount, 1);
    });

    test('a view resolved twice does not start twice', () => {
        const { coordinator, start } = makeCoordinator();
        coordinator.onDetectionSettled(MATCH);
        coordinator.onViewResolved();
        coordinator.onViewResolved();
        assert.strictEqual(start.callCount, 1);
    });

    test('an admitted intent cancels the automatic start for good', () => {
        const { coordinator, start } = makeCoordinator();
        coordinator.onViewResolved();
        coordinator.admitExplicitIntent('switchCourse');
        coordinator.onDetectionSettled(MATCH);
        assert.strictEqual(start.called, false,
            'a late detection must not pull the student out of the course they chose');
    });

    test('no-match consumes the latch, so a later match cannot start', () => {
        const { coordinator, start, publishDetectionState } = makeCoordinator();
        coordinator.onViewResolved();
        coordinator.onDetectionSettled({ kind: 'no-match' });
        assert.strictEqual(publishDetectionState.lastCall.args[0], 'settled');

        // A folder change re-runs detection. The student has been looking at the
        // chooser since the first answer; the chat must not acquire under them.
        coordinator.onDetectionSettled(MATCH);
        assert.strictEqual(start.called, false, 'no-match must really consume, not merely decline');
    });

    test('unavailable keeps eligibility and a retry can still start', () => {
        const { coordinator, start, publishDetectionState, retryDetection } = makeCoordinator();
        coordinator.onViewResolved();
        coordinator.onDetectionSettled({ kind: 'unavailable' });
        assert.strictEqual(publishDetectionState.lastCall.args[0], 'unavailable');
        assert.strictEqual(start.called, false);

        coordinator.retry();
        assert.strictEqual(retryDetection.calledOnce, true);
        assert.strictEqual(publishDetectionState.lastCall.args[0], 'unsettled');

        coordinator.onDetectionSettled(MATCH);
        assert.strictEqual(start.callCount, 1, 'unavailable must not have burned the latch');
    });

    test('retry after the latch is gone does nothing', () => {
        const { coordinator, retryDetection } = makeCoordinator();
        coordinator.onViewResolved();
        coordinator.onDetectionSettled(MATCH);
        coordinator.retry();
        assert.strictEqual(retryDetection.called, false);
    });

    test('an outage after the latch was consumed does not offer a dead retry', () => {
        const { coordinator, publishDetectionState } = makeCoordinator();
        coordinator.onViewResolved();
        coordinator.onDetectionSettled({ kind: 'no-match' });
        // A folder change re-runs detection, and this time the server is down.
        coordinator.onDetectionSettled({ kind: 'unavailable' });
        assert.strictEqual(publishDetectionState.lastCall.args[0], 'settled',
            'retry() is a no-op once the latch is spent, so the button must not appear');
    });

    test('a rejecting start leaves the latch eligible, and a later settled match starts again', async () => {
        // Regression guard: a transient failure (e.g. a 500 from the acquire
        // call) must not permanently strand the student on the cold-start
        // chooser. The latch was consumed before the attempt was even made,
        // which is what stops a double start; on failure that permission has
        // to come back.
        const start = sinon.stub();
        start.onFirstCall().rejects(new Error('network down'));
        start.onSecondCall().resolves();
        const publishDetectionState = sinon.spy();
        const retryDetection = sinon.spy();
        const coordinator = new ChatStartupCoordinator({ start, publishDetectionState, retryDetection });

        coordinator.onViewResolved();
        coordinator.onDetectionSettled(MATCH);
        // Let the rejected promise's `.catch` run.
        await Promise.resolve();
        await Promise.resolve();

        assert.strictEqual(start.callCount, 1, 'the first, failing attempt was made');

        // A fresh detection settle (e.g. a folder change, or the view
        // resolving again after VS Code disposed and recreated it) is the
        // next trigger; with the latch re-armed it must start again.
        coordinator.onDetectionSettled(MATCH);

        assert.strictEqual(start.callCount, 2, 'a later settle must get another shot at the latch');
    });

    test('a rejecting start does not resurrect a latch an explicit intent later cancelled', async () => {
        // `cancel()` only ever acts on an `eligible` latch (by design: an
        // intent arriving while the automatic attempt is still in flight is
        // moot, since that attempt already has permission). So the
        // cancellation that matters here can only land AFTER the re-arm has
        // already put the latch back into play — which is exactly the window
        // this fix opens up, and exactly where "the explicit intent still
        // wins, permanently" has to keep holding.
        const start = sinon.stub();
        start.onFirstCall().rejects(new Error('network down'));
        const publishDetectionState = sinon.spy();
        const retryDetection = sinon.spy();
        const coordinator = new ChatStartupCoordinator({ start, publishDetectionState, retryDetection });

        coordinator.onViewResolved();
        coordinator.onDetectionSettled(MATCH);
        await Promise.resolve();
        await Promise.resolve();
        assert.strictEqual(start.callCount, 1, 'the first, failing attempt was made, and the latch is eligible again');

        // The student explicitly navigates away now that the latch is
        // eligible again.
        coordinator.admitExplicitIntent('switchCourse');

        // A later detection settle (e.g. a folder change) must not restart:
        // the explicit navigation wins, permanently, even though a prior
        // failed automatic attempt had reopened the latch.
        coordinator.onDetectionSettled(MATCH);

        assert.strictEqual(start.callCount, 1,
            'a cancelled latch must never restart, no matter how it got there');
    });

    test('an admitted intent clears a startup-unavailable banner', () => {
        const { coordinator, publishDetectionState } = makeCoordinator();
        coordinator.onViewResolved();
        coordinator.onDetectionSettled({ kind: 'unavailable' });
        assert.strictEqual(publishDetectionState.lastCall.args[0], 'unavailable');

        coordinator.admitExplicitIntent('switchCourse');
        assert.strictEqual(publishDetectionState.lastCall.args[0], 'settled',
            'the student navigated away; the dead Retry must not stay behind it');
    });
});
