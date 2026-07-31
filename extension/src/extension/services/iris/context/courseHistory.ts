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

/**
 * Aggregates the course's chat-session overview into the course-wide history
 * list, newest-first, no message counts (the overview summary does not carry
 * any). EVERY mode is surfaced: a lecture or text-exercise conversation can
 * never be a topic, but it can absolutely be opened by id, and hiding it here
 * made prior conversations unreachable rather than read-only.
 */
export function buildCourseHistory(summaries: SessionSummary[], courseId: number): CourseHistoryEntry[] {
    return summaries
        .map((summary) => ({
            artemisSessionId: summary.sessionId,
            courseId,
            // The transport represents every mode the server may report; this
            // list is display-only, so an unknown one is carried as it came.
            mode: summary.context.mode as IrisChatMode,
            entityId: summary.context.entityId,
            entityName: summary.context.name,
            title: summary.title,
            lastActivity: summary.lastActivity,
        }))
        .sort((a, b) => b.lastActivity - a.lastActivity);
}
