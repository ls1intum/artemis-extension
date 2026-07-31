import type { IrisChatMessage, IrisChatMode } from './apiResponses';

/**
 * A session's topic as the SERVER reports it. `mode` is deliberately the full
 * IrisChatMode union plus unknown strings: the overview returns lecture and
 * text-exercise sessions, another client can repoint a session into one, and
 * reconnect can load one. The picker restricts what may be SELECTED; the
 * transport must represent everything the server may SAY.
 */
export interface ServerContext {
    mode: IrisChatMode | (string & {});
    /** The course id for COURSE_CHAT, the exercise/lecture id otherwise. */
    entityId: number;
    /** Display name when the server supplied one (overview `entityName`). */
    name?: string;
}

/** One row of `/api/iris/chat/{courseId}/sessions/overview`, plus the course it came from. */
export interface SessionSummary {
    sessionId: number;
    courseId: number;
    context: ServerContext;
    title?: string;
    /** epoch ms of `lastActivityDate ?? creationDate`; 0 when neither parses. */
    lastActivity: number;
}

/** A fully loaded conversation: what `sessions/current` and the detail GET return. */
export interface SessionDetail {
    sessionId: number;
    courseId: number;
    context: ServerContext;
    title?: string;
    /**
     * epoch ms of `lastActivityDate ?? creationDate`; 0 when neither parses.
     * Carried so a detail can be cached as a summary with the SAME ordering key
     * the overview uses. Without it, a conversation entered into the invisible
     * cache from a detail load would sort as if it had no activity at all.
     */
    lastActivity: number;
    /** Every persisted sender, including CTXSWAP. Never filtered here. */
    messages: IrisChatMessage[];
}

export type ContextSwapTransition = 'added' | 'removed' | 'changed';

/** True when two topics are the same. `name` is display-only and ignored. */
export function sameContext(a: ServerContext | undefined, b: ServerContext | undefined): boolean {
    if (!a || !b) { return a === b; }
    return a.mode === b.mode && a.entityId === b.entityId;
}

/** Caches a loaded conversation as an overview-shaped summary. */
export function summaryOfDetail(detail: SessionDetail): SessionSummary {
    return {
        sessionId: detail.sessionId,
        courseId: detail.courseId,
        context: detail.context,
        title: detail.title,
        lastActivity: detail.lastActivity,
    };
}

/**
 * Bridge key for the wire fields that still REQUIRE a `localSessionId` while
 * the old session model is being removed. Under `conversationFirst` there is no
 * local session id any more, so host and webview derive the same synthetic one
 * from the conversation id. Both sides import this, because two independent
 * template literals that must match is exactly how a transcript goes silently
 * blank. Deleted in Task 15 together with `localSessionId`.
 */
export function localSessionKeyFor(sessionId: number): string {
    return `conversation-${sessionId}`;
}
