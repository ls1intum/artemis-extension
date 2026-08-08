import { describe, expect, it } from 'vitest';

import { compareCoursesForPicker, compareExercisesForPicker } from '@webview/views/IrisChat/pickerSort';
import type { ContextItem } from '@webview/views/IrisChat/types';

const ex = (over: Partial<ContextItem> = {}): ContextItem =>
    ({ id: 1, title: 'A', ...over }) as ContextItem;

const soon = ex({ id: 1, title: 'Soon', dueDate: '2026-08-01T10:00:00Z' });
const late = ex({ id: 2, title: 'Late', dueDate: '2026-09-01T10:00:00Z' });
const none = ex({ id: 3, title: 'None' });

describe('compareExercisesForPicker', () => {
    it('sorts by due date ascending, soonest first', () => {
        expect([late, soon, none].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it('keeps the workspace exercise pinned regardless of due date', () => {
        const workspace = ex({ id: 4, title: 'Workspace', dueDate: '2027-01-01T10:00:00Z', isWorkspace: true });
        expect([late, soon, workspace].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([4, 1, 2]);
    });

    it('treats an invalid due date as absent and sorts it last', () => {
        const broken = ex({ id: 5, title: 'Broken', dueDate: 'not-a-date' });
        expect([broken, soon].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([1, 5]);
    });

    it('breaks a due-date tie alphabetically, case-insensitively', () => {
        const b = ex({ id: 6, title: 'beta', dueDate: '2026-08-01T10:00:00Z' });
        const a = ex({ id: 7, title: 'Alpha', dueDate: '2026-08-01T10:00:00Z' });
        expect([b, a].sort(compareExercisesForPicker).map((e) => e.id)).toEqual([7, 6]);
    });
});

describe('compareCoursesForPicker', () => {
    it('orders courses by lastViewed desc then title', () => {
        const c = (over: Partial<ContextItem>): ContextItem => ({ id: 1, title: 'X', ...over } as ContextItem);
        const out = [c({ id: 1, title: 'B', lastViewed: 100 }), c({ id: 2, title: 'A', lastViewed: 200 }), c({ id: 3, title: 'C' })]
            .sort(compareCoursesForPicker).map(x => x.title);
        expect(out).toEqual(['A', 'B', 'C']);
    });
});
