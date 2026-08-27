import * as assert from 'assert';

import { extractLatestFeedbacks } from '@extension/utils/participationHelpers';

suite('participationHelpers', () => {
    suite('extractLatestFeedbacks', () => {
        test('returns undefined when participation is missing', () => {
            assert.strictEqual(extractLatestFeedbacks(undefined), undefined);
        });

        test('returns undefined when there are no submissions', () => {
            assert.strictEqual(extractLatestFeedbacks({ submissions: [] }), undefined);
        });

        test('returns undefined when latest result has no feedbacks', () => {
            assert.strictEqual(extractLatestFeedbacks({ submissions: [{ id: 1, results: [{ id: 10 }] }] }), undefined);
        });

        test('returns feedbacks from highest-id result on highest-id submission', () => {
            const feedbacks = [{ name: 'expected' }];
            const participation = {
                submissions: [
                    { id: 1, results: [{ id: 9, feedbacks: [{ name: 'old' }] }] },
                    { id: 2, results: [{ id: 10, feedbacks: [{ name: 'older' }] }, { id: 11, feedbacks }] },
                ],
            };
            assert.strictEqual(extractLatestFeedbacks(participation), feedbacks);
        });
    });
});
