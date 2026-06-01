import * as assert from 'assert';

import { extractLatestFeedbacks, pickHighestId } from '@extension/utils/participationHelpers';

suite('participationHelpers', () => {
    suite('pickHighestId', () => {
        test('returns undefined for empty/missing input', () => {
            assert.strictEqual(pickHighestId(undefined), undefined);
            assert.strictEqual(pickHighestId([]), undefined);
        });

        test('picks the entry with the highest numeric id', () => {
            const items = [{ id: 1 }, { id: 5 }, { id: 3 }];
            assert.deepStrictEqual(pickHighestId(items), { id: 5 });
        });

        test('treats missing id as 0', () => {
            const items = [{ id: undefined }, { id: 2 }, {}];
            assert.deepStrictEqual(pickHighestId(items), { id: 2 });
        });

        test('does not mutate the input array', () => {
            const items = [{ id: 1 }, { id: 5 }, { id: 3 }];
            const snapshot = items.map(i => ({ ...i }));
            pickHighestId(items);
            assert.deepStrictEqual(items, snapshot);
        });

        test('returns the original object reference (for downstream mutation)', () => {
            const target = { id: 99, payload: 'keep' };
            const items = [{ id: 1 }, target, { id: 50 }];
            const picked = pickHighestId(items);
            assert.strictEqual(picked, target);
        });
    });

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
