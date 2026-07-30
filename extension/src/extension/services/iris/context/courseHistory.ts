import type { IrisChatMode } from '@shared/types/apiResponses';
import type { SessionSummary } from '@shared/types/serverContext';

/** One prior conversation surfaced in the course-wide chat history. */
export interface CourseHistoryEntry {
    artemisSessionId: number;
    courseId: number;
    /** COURSE_CHAT | programming-exercise chat */
    mode: IrisChatMode;
    entityId: number;
    /** exercise name (for the context label) */
    entityName?: string;
    /** conversation title */
    title?: string;
    /** epoch ms: lastActivityDate ?? creationDate */
    lastActivity: number;
}

/** Modes surfaced in the course-wide history. Lecture and text-exercise chats are excluded. */
const INCLUDED_MODES: ReadonlySet<string> = new Set<IrisChatMode>(['COURSE_CHAT', 'PROGRAMMING_EXERCISE_CHAT']);

/**
 * Aggregates the course's chat-session overview into the course-wide history list:
 * course chats and programming-exercise chats only, newest-first, no message counts
 * (the overview summary does not carry any).
 */
export function buildCourseHistory(summaries: SessionSummary[], courseId: number): CourseHistoryEntry[] {
    return summaries
        .filter((summary) => INCLUDED_MODES.has(summary.context.mode))
        .map((summary) => ({
            artemisSessionId: summary.sessionId,
            courseId,
            // Safe: narrowed to a known IrisChatMode by the filter above.
            mode: summary.context.mode as IrisChatMode,
            entityId: summary.context.entityId,
            entityName: summary.context.name,
            title: summary.title,
            lastActivity: summary.lastActivity,
        }))
        .sort((a, b) => b.lastActivity - a.lastActivity);
}
