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
        // A DIFFERENT window than the interleaving test below: here the
        // intent arrives AFTER the re-arm has already put the latch back
        // into play (not while the first attempt is still in flight), and
        // it still has to win permanently.
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

    test('an explicit intent admitted WHILE the attempt is still pending is not resurrected by a later re-arm', async () => {
        // The real interleaving: `start()` is a genuine HTTP round trip, so
        // it stays pending for hundreds of milliseconds — plenty of time for
        // the student to click "Ask Iris about" or switch a topic. Before
        // `cancel()` could record an intent on a `consumed` latch, this
        // window silently dropped it: `cancel()` no-opped (state was
        // `consumed`, not `eligible`), the attempt then failed and re-armed
        // the latch as if nothing had happened, and a later settle started
        // automatically anyway — exactly the automatic cold start the
        // student's own navigation was supposed to rule out for good.
        let rejectStart: (error: unknown) => void = () => undefined;
        const start = sinon.stub().returns(new Promise((_resolve, reject) => { rejectStart = reject; }));
        const publishDetectionState = sinon.spy();
        const retryDetection = sinon.spy();
        const coordinator = new ChatStartupCoordinator({ start, publishDetectionState, retryDetection });

        coordinator.onViewResolved();
        coordinator.onDetectionSettled(MATCH);
        assert.strictEqual(start.callCount, 1, 'the automatic attempt began, and its promise is still pending');

        // The student explicitly navigates away WHILE the attempt is
        // in flight — no response has arrived yet.
        coordinator.admitExplicitIntent('askIrisAbout');

        // The in-flight attempt now fails: the same transient error this
        // whole fix targets.
        rejectStart(new Error('network down'));
        await Promise.resolve();
        await Promise.resolve();

        // A later trigger (a folder change, or the view re-resolving after
        // VS Code disposed and recreated the webview) must not restart:
        // the intent from mid-flight still has to win, permanently.
        coordinator.onDetectionSettled(MATCH);

        assert.strictEqual(start.callCount, 1,
            'an intent admitted mid-flight must survive the in-flight attempt failing');
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
