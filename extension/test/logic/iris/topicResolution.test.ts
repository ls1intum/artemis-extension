import { describe, expect, it } from 'vitest';

import { resolveTopic } from '@extension/services/iris/conversation/topicResolution';

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 5 };
const COURSE42 = { mode: 'COURSE_CHAT' as const, entityId: 42 };

const input = (over = {}) => ({
    target: EX5,
    courseId: 42,
    currentSessionId: 1 as number | undefined,
    committedContext: COURSE42,
    pendingContext: undefined as { ctx: typeof EX5 } | undefined,
    contentState: 'empty' as 'unknown' | 'empty' | 'content',
    ...over,
});

describe('resolveTopic', () => {
    it('is a no-op when the target is already the effective topic', () => {
        expect(resolveTopic(input({ target: COURSE42 }))).toEqual({ kind: 'noop' });
    });

    it('is a no-op when the target equals the pending topic', () => {
        expect(resolveTopic(input({ pendingContext: { ctx: EX5 } }))).toEqual({ kind: 'noop' });
    });

    it('clears a divergent pending when the target is the committed topic', () => {
        // Selecting the committed context must UNSTAGE, not stage it.
        const decision = resolveTopic(input({ target: COURSE42, pendingContext: { ctx: EX5 } }));
        expect(decision).toEqual({ kind: 'clear-pending' });
    });

    it('acquires when no conversation is open', () => {
        // The cold-start row. Without it "Ask Iris about this exercise" from the
        // dashboard would refuse, because contentState is unknown with no session.
        const decision = resolveTopic(input({ currentSessionId: undefined, contentState: 'unknown', committedContext: undefined }));
        expect(decision).toEqual({ kind: 'acquire', target: EX5 });
    });

    it('refuses while content is unknown and a conversation IS open', () => {
        expect(resolveTopic(input({ contentState: 'unknown' }))).toEqual({ kind: 'refuse', reason: 'loading' });
    });

    it('stages onto an empty conversation', () => {
        expect(resolveTopic(input())).toEqual({ kind: 'stage', target: EX5 });
    });

    it('stages onto a conversation WITH content too, exactly as the web client does', () => {
        // Artemis' own client stages unconditionally
        // (`context-selection.component.ts` -> `stagePendingContext`), and the
        // server commits the change on the next send with a CTXSWAP marker. The
        // transcript therefore records the switch instead of hiding it, so there
        // is nothing left for a second conversation to protect.
        expect(resolveTopic(input({ contentState: 'content' }))).toEqual({ kind: 'stage', target: EX5 });
    });

    it('stages the course topic onto a conversation with content as well', () => {
        // The chip's remove icon takes this path. It must not navigate either.
        const decision = resolveTopic(input({ target: COURSE42, committedContext: EX5, contentState: 'content' }));
        expect(decision).toEqual({ kind: 'stage', target: COURSE42 });
    });

    it('refuses a cross-course target', () => {
        const decision = resolveTopic(input({ target: { mode: 'COURSE_CHAT' as const, entityId: 99 } }));
        expect(decision).toEqual({ kind: 'refuse', reason: 'cross-course' });
    });

    it('refuses an EXERCISE from another course, which its id alone cannot reveal', () => {
        // "Ask Iris about this exercise" from a dashboard row in course 43 while
        // a course-42 conversation is open. The entity id says nothing about the
        // course, so without the caller's hint this staged silently and the next
        // send carried a context the conversation cannot hold.
        const decision = resolveTopic(input({ targetCourseId: 43 }));
        expect(decision).toEqual({ kind: 'refuse', reason: 'cross-course' });
    });

    it('accepts an exercise whose course is the open one', () => {
        expect(resolveTopic(input({ targetCourseId: 42 }))).toEqual({ kind: 'stage', target: EX5 });
    });

    it('accepts a hint when no conversation is open, so the cold start still works', () => {
        const decision = resolveTopic(input({
            currentSessionId: undefined, courseId: undefined, contentState: 'unknown',
            committedContext: undefined, targetCourseId: 43,
        }));
        expect(decision).toEqual({ kind: 'acquire', target: EX5 });
    });
});
