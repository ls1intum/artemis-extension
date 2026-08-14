import type { ServerContext } from '@shared/types/serverContext';
import { sameContext } from '@shared/types/serverContext';

import type { ContentState } from './conversationState';

type TopicDecision =
    /** Already there. */
    | { kind: 'noop' }
    /** Drop the staging; no request. */
    | { kind: 'clear-pending' }
    /** Stage onto the open conversation; no request. */
    | { kind: 'stage'; target: ServerContext }
    /** No conversation open: POST sessions/current, then stage if a course session came back. */
    | { kind: 'acquire'; target: ServerContext }
    | { kind: 'refuse'; reason: 'loading' | 'cross-course' };

export interface TopicResolutionInput {
    target: ServerContext;
    /**
     * The course `target` belongs to, when the caller knows it (the Ask-Iris
     * commands do; the picker only offers this course's entries). An exercise
     * id carries no course, so this is the ONLY way a cross-course exercise can
     * be told apart from a local one.
     */
    targetCourseId?: number;
    courseId: number | undefined;
    currentSessionId: number | undefined;
    committedContext: ServerContext | undefined;
    pendingContext: { ctx: ServerContext } | undefined;
    contentState: ContentState;
}

/**
 * Decides what a topic change does to the open conversation. Pure: performs no
 * requests.
 *
 * It never leaves the conversation. Artemis's own client stages the new topic
 * unconditionally (`context-selection.component.ts` calls `stagePendingContext`
 * for both the picker and the chip's remove icon, with no check on the
 * transcript), and the server commits it on the next send by writing a CTXSWAP
 * marker, so the switch is recorded in the transcript rather than hidden.
 * Opening a second conversation instead would protect nothing the marker does
 * not already protect and would make the same gesture behave differently in the
 * two clients. Starting a fresh conversation is the header `+`, a separate
 * gesture in both clients.
 *
 * HOST-ONLY. The webview must not import this (`eslint.config.mjs` bans
 * `@extension/*` from `src/webview/**`), so the picker cannot label its rows
 * with what each pick would do. It does not need to: every pick does the same
 * thing.
 */
export function resolveTopic(input: TopicResolutionInput): TopicDecision {
    const { target, courseId, currentSessionId, committedContext, pendingContext, contentState } = input;

    // Nothing here may belong to another course. For a course target the id IS
    // the course; for anything else only the caller's hint can say. Both are
    // checked before spending a request, and only against an OPEN conversation:
    // with none open the acquisition establishes the course itself.
    const targetCourse = target.mode === 'COURSE_CHAT' ? target.entityId : input.targetCourseId;
    if (targetCourse !== undefined && courseId !== undefined && targetCourse !== courseId) {
        return { kind: 'refuse', reason: 'cross-course' };
    }

    const effective = pendingContext?.ctx ?? committedContext;
    if (sameContext(target, effective)) { return { kind: 'noop' }; }

    // Selecting the committed topic while something else is staged UNSTAGES.
    if (pendingContext && sameContext(target, committedContext)) { return { kind: 'clear-pending' }; }

    if (currentSessionId === undefined) { return { kind: 'acquire', target }; }
    // `unknown` is the only remaining refusal: without the detail we cannot tell
    // a no-op from a real change, and staging blind would show a topic the
    // conversation may already carry.
    if (contentState === 'unknown') { return { kind: 'refuse', reason: 'loading' }; }
    return { kind: 'stage', target };
}
