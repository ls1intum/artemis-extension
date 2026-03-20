import { useDashboardStore } from '../../../src/views/webview/stores/useDashboardStore';
import { useChatStore } from '../../../src/views/webview/stores/useChatStore';
import { useCourseListStore } from '../../../src/views/webview/stores/useCourseListStore';
import { useCourseDetailStore } from '../../../src/views/webview/stores/useCourseDetailStore';
import { useExerciseDetailStore } from '../../../src/views/webview/stores/useExerciseDetailStore';
import { useExamStartStore } from '../../../src/views/webview/stores/useExamStartStore';
import { useExamConductionStore } from '../../../src/views/webview/stores/useExamConductionStore';
import { useExamExerciseDetailStore } from '../../../src/views/webview/stores/useExamExerciseDetailStore';
import { createMockVsCodeApi } from './vscodeApi';

// Capture initial state of each store at module import time — before any test runs
// and before any mutations occur. Direct reference is safe because Zustand uses
// immutable updates (new object on every setState call).
const storeEntries = [
    { store: useDashboardStore, state: useDashboardStore.getState() },
    { store: useChatStore, state: useChatStore.getState() },
    { store: useCourseListStore, state: useCourseListStore.getState() },
    { store: useCourseDetailStore, state: useCourseDetailStore.getState() },
    { store: useExerciseDetailStore, state: useExerciseDetailStore.getState() },
    { store: useExamStartStore, state: useExamStartStore.getState() },
    { store: useExamConductionStore, state: useExamConductionStore.getState() },
    { store: useExamExerciseDetailStore, state: useExamExerciseDetailStore.getState() },
] as const;

/**
 * Resets all 8 Zustand stores to their import-time initial state and
 * re-initialises window.acquireVsCodeApi with a fresh mock.
 *
 * Call this in a global beforeEach to prevent store state leaking between tests.
 */
export function resetTestState(): void {
    for (const { store, state } of storeEntries) {
        // The `true` replace flag overwrites the entire state object instead of merging,
        // ensuring actions captured in the initial snapshot are restored correctly.
        (store.setState as (state: unknown, replace: boolean) => void)(state, true);
    }

    // Re-initialise the VS Code API mock so each test starts with a clean spy history
    Object.defineProperty(global.window, 'acquireVsCodeApi', {
        writable: true,
        configurable: true,
        value: () => createMockVsCodeApi(),
    });
}
