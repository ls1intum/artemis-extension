import * as assert from 'assert';

import { displayedResult, latestById, latestResultAcrossSubmissions } from '@shared/utils/latestById';

suite('latestById', () => {
    suite('latestById', () => {
        test('returns undefined for empty/missing input', () => {
            assert.strictEqual(latestById(undefined), undefined);
            assert.strictEqual(latestById([]), undefined);
        });

        test('picks the entry with the highest numeric id', () => {
            const items = [{ id: 1 }, { id: 5 }, { id: 3 }];
            assert.deepStrictEqual(latestById(items), { id: 5 });
        });

        test('treats missing id as 0', () => {
            const items = [{ id: undefined }, { id: 2 }, {}];
            assert.deepStrictEqual(latestById(items), { id: 2 });
        });

        test('does not mutate the input array', () => {
            const items = [{ id: 1 }, { id: 5 }, { id: 3 }];
            const snapshot = items.map(i => ({ ...i }));
            latestById(items);
            assert.deepStrictEqual(items, snapshot);
        });

        test('returns the original object reference (for downstream mutation)', () => {
            const target = { id: 99, payload: 'keep' };
            const items = [{ id: 1 }, target, { id: 50 }];
            const picked = latestById(items);
            assert.strictEqual(picked, target);
        });
    });

    suite('latestResultAcrossSubmissions', () => {
        test('returns undefined for no submissions', () => {
            assert.strictEqual(latestResultAcrossSubmissions(undefined), undefined);
            assert.strictEqual(latestResultAcrossSubmissions([]), undefined);
        });

        test('returns undefined when no submission has a result', () => {
            assert.strictEqual(
                latestResultAcrossSubmissions([{ id: 1, results: [] }, { id: 2 }]),
                undefined,
            );
        });

        test('returns the latest result (highest id) within a submission', () => {
            const r = latestResultAcrossSubmissions([{ id: 1, results: [{ id: 10 }, { id: 11 }] }]);
            assert.strictEqual(r?.id, 11);
        });

        test('is submission-first: the newest submission with a result wins, even if an older submission has a higher result id', () => {
            // Older submission (id 1) was re-evaluated → its result id (99) is higher
            // than the newest submission's result (30). Submission-first must still
            // return the newest submission's result, NOT the globally-highest id.
            const r = latestResultAcrossSubmissions([
                { id: 1, results: [{ id: 99 }] },
                { id: 2, results: [{ id: 30 }] },
            ]);
            assert.strictEqual(r?.id, 30);
        });

        test('keeps the previous result when the newest submission has no result yet', () => {
            // Submission id 2 is newer but resultless (build running); id 1 holds the
            // previous result. The helper must surface that previous result.
            const r = latestResultAcrossSubmissions([
                { id: 1, results: [{ id: 10 }] },
                { id: 2, results: [] },
            ]);
            assert.strictEqual(r?.id, 10);
        });
    });
});

suite('displayedResult', () => {
    const withPrevious = [
        { id: 1, results: [{ id: 10 }] },
        { id: 2, results: [] },
    ];

    test('keeps the previous result while a build is running', () => {
        // A pending submission is by definition resultless, so reading the newest submission alone
        // would blank the markers a student was looking at a moment ago.
        assert.deepStrictEqual(displayedResult(withPrevious, true), { id: 10 });
    });

    test('shows nothing for a resultless newest submission when no build is running', () => {
        // e.g. a finished build-failed submission. Resurfacing an older result here would attribute
        // the previous run's outcome to a submission that produced none.
        assert.strictEqual(displayedResult(withPrevious, false), undefined);
    });

    test('has nothing to fall back to when no submission carries a result', () => {
        assert.strictEqual(displayedResult([{ id: 1, results: [] }], true), undefined);
    });

    test('a re-evaluated older submission does not override the newest one', () => {
        // Artemis' own helper reduces over every result by max id and has this hole; ours walks
        // submissions newest-first instead.
        const reEvaluated = [
            { id: 1, results: [{ id: 99 }] },
            { id: 2, results: [{ id: 20 }] },
        ];
        assert.deepStrictEqual(displayedResult(reEvaluated, false), { id: 20 });
        assert.deepStrictEqual(displayedResult(reEvaluated, true), { id: 20 });
    });
});
