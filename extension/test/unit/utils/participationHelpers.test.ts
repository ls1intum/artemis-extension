import * as assert from 'assert';

import { extractLatestFeedbacks } from '@extension/utils/participationHelpers';

suite('participationHelpers', () => {
    suite('extractLatestFeedbacks', () => {
        test('returns undefined when participation is missing', () => {
            assert.strictEqual(extractLatestFeedbacks(undefined, false), undefined);
        });

        test('returns undefined when there are no submissions', () => {
            assert.strictEqual(extractLatestFeedbacks({ submissions: [] }, false), undefined);
        });

        test('returns undefined when latest result has no feedbacks', () => {
            assert.strictEqual(extractLatestFeedbacks({ submissions: [{ id: 1, results: [{ id: 10 }] }] }, false), undefined);
        });

        test('returns feedbacks from highest-id result on highest-id submission', () => {
            const feedbacks = [{ name: 'expected' }];
            const participation = {
                submissions: [
                    { id: 1, results: [{ id: 9, feedbacks: [{ name: 'old' }] }] },
                    { id: 2, results: [{ id: 10, feedbacks: [{ name: 'older' }] }, { id: 11, feedbacks }] },
                ],
            };
            assert.strictEqual(extractLatestFeedbacks(participation, false), feedbacks);
        });

        test('keeps the previous result\'s feedbacks while a build is running', () => {
            // The state the whole change exists for: a pending submission is resultless, so the
            // strict rule returns nothing and the problem statement loses every task marker until
            // the build finishes. The exercise view above it keeps showing the previous ones.
            const feedbacks = [{ name: 'previous' }];
            const participation = {
                submissions: [
                    { id: 1, results: [{ id: 9, feedbacks }] },
                    { id: 2, results: [] },
                ],
            };

            assert.strictEqual(extractLatestFeedbacks(participation, true), feedbacks);
            assert.strictEqual(extractLatestFeedbacks(participation, false), undefined);
        });
    });
});
