import { describe, expect, it } from 'vitest';

import { buildErrorFamiliesFromFeedbacks } from '@extension/services/eq/buildErrorFamily';
import { collectBuildResult } from '@extension/services/recording/eventCollectors';
import { createSnapshotFromBuildEvent } from '@extension/services/recording/replay/snapshotReconstructor';
import type { ResultDTO } from '@extension/types';

/**
 * Regression guard for the live/recording/replay build-error-family divergence:
 * the recording collector and the replay reconstructor must yield exactly the
 * families produced by the single shared builder (which the live EQ path also uses).
 */
function failedBuild(feedbacks: { positive?: boolean; text?: string }[]): ResultDTO {
    return {
        successful: false,
        submission: { buildFailed: true },
        feedbacks,
    } as unknown as ResultDTO;
}

describe('build-error family consistency across recording and replay', () => {
    it('recording → replay reproduces exactly the shared builder families', () => {
        const result = failedBuild([
            { positive: false, text: 'Cannot find symbol foo' },
            { positive: false, text: 'Method bar not found' },
            { positive: true, text: 'passing test' },
        ]);

        const event = collectBuildResult(result);
        const snapshot = createSnapshotFromBuildEvent(event);

        const expected = new Set(buildErrorFamiliesFromFeedbacks(result.feedbacks));
        expect(snapshot.errorFamilies).toEqual(expected);
    });

    it('does not merge two failures that differ only after the first 50 characters', () => {
        const prefix = 'CompilationError: cannot find symbol in a very long line ';
        const result = failedBuild([
            { positive: false, text: `${prefix}variable fooooooooo` },
            { positive: false, text: `${prefix}variable barrrrrrrr` },
        ]);

        const snapshot = createSnapshotFromBuildEvent(collectBuildResult(result));
        expect(snapshot.errorFamilies.size).toBe(2);
    });
});
