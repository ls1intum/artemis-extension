import type { IrisChatMode, IrisChatSessionSummary } from '@shared/types/apiResponses';

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
const INCLUDED_MODES: ReadonlySet<IrisChatMode> = new Set<IrisChatMode>(['COURSE_CHAT', 'PROGRAMMING_EXERCISE_CHAT']);

/**
 * Aggregates the course's chat-session overview into the course-wide history list:
 * course chats and programming-exercise chats only, newest-first, no message counts
 * (the overview summary does not carry any).
 */
export function buildCourseHistory(summaries: IrisChatSessionSummary[], courseId: number): CourseHistoryEntry[] {
    return summaries
        .filter((summary) => INCLUDED_MODES.has(summary.mode))
        .map((summary) => {
            const parsed = Date.parse(summary.lastActivityDate ?? summary.creationDate);
            return {
                artemisSessionId: summary.id,
                courseId,
                mode: summary.mode,
                entityId: summary.entityId,
                entityName: summary.entityName,
                title: summary.title,
                lastActivity: Number.isNaN(parsed) ? 0 : parsed,
            };
        })
        .sort((a, b) => b.lastActivity - a.lastActivity);
}
