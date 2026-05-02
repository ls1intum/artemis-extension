import type { StoredState } from './contextStateTypes';
import type { ChatContextType, ContextSnapshot } from '../../types';
import { byPriorityThenRecency } from './contextPriorityScorer';

const SESSION_KEY_SEPARATOR = ':';

export function getContextKey(type: ChatContextType, id: number): string {
    return `${type}${SESSION_KEY_SEPARATOR}${id}`;
}

export interface BuildSnapshotOptions {
    maxRecentExercises: number;
    maxRecentCourses: number;
}

export function buildContextSnapshot(
    state: StoredState,
    options: BuildSnapshotOptions,
): ContextSnapshot {
    const active = state.activeContext;
    const activeKey = active ? getContextKey(active.type, active.id) : null;
    const sessions = activeKey ? [...(state.sessions[activeKey] ?? [])] : [];
    const activeSession =
        sessions.find(session => session.id === state.activeSessionId) ?? sessions[0] ?? null;

    const recentExercises = [...state.recentExercises]
        .sort(byPriorityThenRecency)
        .slice(0, options.maxRecentExercises);
    const recentCourses = [...state.recentCourses]
        .sort(byPriorityThenRecency)
        .slice(0, options.maxRecentCourses);

    const allExercises = [...state.allExercises].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    );
    const allCourses = [...state.allCourses].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    );

    return {
        activeContext: active,
        activeSession,
        sessions,
        recentExercises,
        recentCourses,
        allExercises,
        allCourses,
    };
}
