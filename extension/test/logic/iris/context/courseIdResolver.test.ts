import { describe, expect, it, vi } from 'vitest';

import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';

function fakeStore(tracked?: { courseId?: number }) {
    return { getExerciseById: vi.fn(() => tracked), registerExercise: vi.fn() } as any;
}

describe('resolveCourseIdForExercise', () => {
    it('returns the tracked courseId without hitting the API', async () => {
        const api = { getExerciseDetails: vi.fn() } as any;
        const got = await resolveCourseIdForExercise(7, fakeStore({ courseId: 99 }), api);
        expect(got).toBe(99);
        expect(api.getExerciseDetails).not.toHaveBeenCalled();
    });
    it('falls back to getExerciseDetails when the store misses', async () => {
        const api = { getExerciseDetails: vi.fn(async () => ({ exercise: { course: { id: 55 } } })) } as any;
        expect(await resolveCourseIdForExercise(7, fakeStore(undefined), api)).toBe(55);
    });
    it('returns undefined when the store misses and the API throws', async () => {
        const api = { getExerciseDetails: vi.fn(async () => { throw new Error('boom'); }) } as any;
        expect(await resolveCourseIdForExercise(7, fakeStore(undefined), api)).toBeUndefined();
    });
    it('returns undefined when there is no API', async () => {
        expect(await resolveCourseIdForExercise(7, fakeStore(undefined), undefined)).toBeUndefined();
    });
});
