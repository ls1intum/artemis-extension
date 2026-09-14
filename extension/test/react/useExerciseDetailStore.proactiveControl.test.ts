import { describe, expect, it } from 'vitest';

import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';

describe('useExerciseDetailStore proactiveControl', () => {
    it("setExerciseData clears a previous exercise's proactiveControl (no stale badge)", () => {
        const store = useExerciseDetailStore.getState();
        store.setProactiveControl({ exerciseId: 7, level: 'off', cardState: 'available', proactiveControlAvailable: true });
        expect(useExerciseDetailStore.getState().proactiveControl?.exerciseId).toBe(7);
        // Loading a different exercise must reset it (the partial set() otherwise preserves it).
        store.setExerciseData({ exercise: { id: 8 } } as never, false);
        expect(useExerciseDetailStore.getState().proactiveControl).toBeNull();
    });
});
