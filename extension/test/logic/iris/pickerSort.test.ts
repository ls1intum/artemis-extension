import { describe, expect, it } from 'vitest';

import { compareCoursesForPicker, compareExercisesForPicker } from '@webview/views/IrisChat/pickerSort';
import type { ContextItem } from '@webview/views/IrisChat/types';

const ex = (over: Partial<ContextItem>): ContextItem =>
    ({ id: 1, title: 'X', ...over } as ContextItem);

const sorted = (items: ContextItem[]) =>
    [...items].sort(compareExercisesForPicker).map(e => e.title);

describe('compareExercisesForPicker', () => {
    it('pins the workspace exercise first regardless of due date', () => {
        const items = [
            ex({ id: 1, title: 'later', dueDate: '2030-01-01T00:00:00Z' }),
            ex({ id: 2, title: 'ws', isWorkspace: true, dueDate: '2020-01-01T00:00:00Z' }),
        ];
        expect(sorted(items)[0]).toBe('ws');
    });
    it('orders by due date descending (latest first)', () => {
        const items = [
            ex({ id: 1, title: 'early', dueDate: '2025-01-01T00:00:00Z' }),
            ex({ id: 2, title: 'late', dueDate: '2026-01-01T00:00:00Z' }),
        ];
        expect(sorted(items)).toEqual(['late', 'early']);
    });
    it('pushes no-date and invalid-date exercises to the bottom, title-sorted', () => {
        const items = [
            ex({ id: 1, title: 'Beta' }),
            ex({ id: 2, title: 'dated', dueDate: '2025-01-01T00:00:00Z' }),
            ex({ id: 3, title: 'Alpha', dueDate: 'not-a-date' }),
        ];
        expect(sorted(items)).toEqual(['dated', 'Alpha', 'Beta']);
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
