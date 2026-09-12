import { describe, expect, it, vi } from 'vitest';

import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';

// The resolver reads the catalog's authoritative mapping, so that is all the fake supplies.
function fakeCatalog(courseId?: number) {
    return { authoritativeCourseIdFor: vi.fn(() => courseId) } as any;
}

describe('resolveCourseIdForExercise', () => {
    it('returns the tracked courseId without hitting the API', async () => {
        const api = { getExerciseDetails: vi.fn() } as any;
        const got = await resolveCourseIdForExercise(7, fakeCatalog(99), api);
        expect(got).toBe(99);
        expect(api.getExerciseDetails).not.toHaveBeenCalled();
    });
    it('falls back to getExerciseDetails when the catalog misses', async () => {
        const api = { getExerciseDetails: vi.fn(async () => ({ exercise: { course: { id: 55 } } })) } as any;
        expect(await resolveCourseIdForExercise(7, fakeCatalog(undefined), api)).toBe(55);
    });
    it('returns undefined when the catalog misses and the API throws', async () => {
        const api = { getExerciseDetails: vi.fn(async () => { throw new Error('boom'); }) } as any;
        expect(await resolveCourseIdForExercise(7, fakeCatalog(undefined), api)).toBeUndefined();
    });
    it('returns undefined when there is no API', async () => {
        expect(await resolveCourseIdForExercise(7, fakeCatalog(undefined), undefined)).toBeUndefined();
    });
});
