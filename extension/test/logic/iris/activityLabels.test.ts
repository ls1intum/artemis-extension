import { describe, expect, it } from 'vitest';

import type { IrisActivityDTO } from '@shared/types/apiResponses';

import { activityTrailSummary } from '@webview/views/IrisChat/activityLabels';

const act = (durationMillis?: number): IrisActivityDTO =>
    ({ state: 'FINISHED', durationMillis } as IrisActivityDTO);

describe('activityTrailSummary', () => {
    it('reports only the count, never a duration', () => {
        expect(activityTrailSummary([act(2), act(1)])).toBe('Tools used: 2');
    });
    it('handles a single activity', () => {
        expect(activityTrailSummary([act(5000)])).toBe('Tools used: 1');
    });
});
