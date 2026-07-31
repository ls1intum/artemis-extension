import type { ServerContext } from '@shared/types/serverContext';
import { sameContext } from '@shared/types/serverContext';

import type { ContentState } from './conversationState';

type TopicDecision =
    /** Already there. */
    | { kind: 'noop' }
    /** Drop the staging; no request. */
    | { kind: 'clear-pending' }
    /** Stage onto the open, empty conversation; no request. */
    | { kind: 'stage'; target: ServerContext }
    /** No conversation open: POST sessions/current, then stage if a course session came back. */
    | { kind: 'acquire'; target: ServerContext }
    /** GET this conversation, revalidate, switch on a match. */
    | { kind: 'open'; sessionId: number; target: ServerContext }
    /** POST sessions?courseId and stage the topic in the fresh conversation. */
    | { kind: 'create-and-stage'; target: ServerContext }
    | { kind: 'refuse'; reason: 'loading' | 'cross-course' };

export interface TopicResolutionInput {
    target: ServerContext;
    courseId: number | undefined;
    currentSessionId: number | undefined;
    committedContext: ServerContext | undefined;
    pendingContext: { ctx: ServerContext } | undefined;
    contentState: ContentState;
    findSessionFor(target: ServerContext): number | undefined;
}

/**
 * Decides which conversation should carry `target`. Pure: performs no requests.
 *
 * HOST-ONLY. The webview must not import this (`eslint.config.mjs` bans
 * `@extension/*` from `src/webview/**`), which is why cut 1 replaced the
 * per-entry effect labels with one static picker hint.
 *
 * There is no retry set. Cut 4: the service revalidates the single hit this
 * returns, and on a mismatch it records what the GET actually said and creates
 * a fresh conversation rather than walking to the next candidate.
 */
export function resolveTopic(input: TopicResolutionInput): TopicDecision {
    const { target, courseId, currentSessionId, committedContext, pendingContext, contentState } = input;

    // A cross-course COURSE_CHAT staging is rejected by applyContextChange, so a
    // pick could never be a staging. Refuse before spending a request.
    if (target.mode === 'COURSE_CHAT' && courseId !== undefined && target.entityId !== courseId) {
        return { kind: 'refuse', reason: 'cross-course' };
    }

    const effective = pendingContext?.ctx ?? committedContext;
    if (sameContext(target, effective)) { return { kind: 'noop' }; }

    // Selecting the committed topic while something else is staged UNSTAGES.
    if (pendingContext && sameContext(target, committedContext)) { return { kind: 'clear-pending' }; }

    if (currentSessionId === undefined) { return { kind: 'acquire', target }; }
    if (contentState === 'unknown') { return { kind: 'refuse', reason: 'loading' }; }
    if (contentState === 'empty') { return { kind: 'stage', target }; }

    const existing = input.findSessionFor(target);
    if (existing !== undefined) { return { kind: 'open', sessionId: existing, target }; }
    return { kind: 'create-and-stage', target };
}
