import type { StoredState } from './contextStateTypes';
import type { ChatContextType, ContextSnapshot, TrackedExercise } from '@extension/types';
import { compareExercisesForDisplay, compareCoursesForDisplay } from './contextSorting';

const SESSION_KEY_SEPARATOR = ':';

function getContextKey(type: ChatContextType, id: number): string {
    return `${type}${SESSION_KEY_SEPARATOR}${id}`;
}

function isPastDeadline(ex: TrackedExercise, nowMs: number): boolean {
    if (!ex.dueDate) { return false; }
    const due = new Date(ex.dueDate).getTime();
    return Number.isFinite(due) && due <= nowMs;
}

export function buildContextSnapshot(state: StoredState): ContextSnapshot {
    const active = state.activeContext;
    const activeKey = active ? getContextKey(active.type, active.id) : null;
    const sessions = activeKey
        ? [...(state.sessions[activeKey] ?? [])].sort((a, b) => b.lastActivity - a.lastActivity)
        : [];
    const activeSession =
        sessions.find(session => session.id === state.activeSessionId) ?? sessions[0] ?? null;

    const nowMs = Date.now();
    const visibleExercises = state.exercises.filter(ex =>
        ex.isWorkspace
        || (active?.type === 'exercise' && ex.id === active.id)
        || !isPastDeadline(ex, nowMs)
    );

    return {
        activeContext: active,
        activeSession,
        sessions,
        exercises: [...visibleExercises].sort(compareExercisesForDisplay),
        courses: [...state.courses].sort(compareCoursesForDisplay),
    };
}
