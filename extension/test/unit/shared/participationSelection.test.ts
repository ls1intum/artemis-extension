import * as assert from 'assert';

import { selectParticipation } from '@shared/utils/participationSelection';

suite('selectParticipation', () => {
    const graded = { id: 1, testRun: false };
    const practice = { id: 2, testRun: true };

    test('picks the practice participation in a practice workspace', () => {
        assert.deepStrictEqual(selectParticipation([graded, practice], true), practice);
    });

    test('picks the graded participation otherwise', () => {
        assert.deepStrictEqual(selectParticipation([graded, practice], false), graded);
    });

    test('reads an absent testRun as graded', () => {
        // The flag is optional on the wire, and the entry deliberately sits AFTER the practice one:
        // with a strict `===` comparison the search misses and the first-entry fallback would hand
        // back the practice participation while the student is in the graded repository.
        const unmarked: { id: number; testRun?: boolean } = { id: 3 };
        assert.deepStrictEqual(selectParticipation([practice, unmarked], false), unmarked);
    });

    test('falls back to the first participation when none matches', () => {
        // An exercise with one participation must resolve to it whatever its testRun says, which is
        // also what the Artemis client does.
        assert.deepStrictEqual(selectParticipation([practice], false), practice);
    });

    test('returns undefined when there is nothing to pick', () => {
        assert.strictEqual(selectParticipation([], false), undefined);
        assert.strictEqual(selectParticipation(undefined, true), undefined);
    });
});
