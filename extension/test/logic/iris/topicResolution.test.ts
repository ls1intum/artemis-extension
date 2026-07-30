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
    findSessionFor: () => undefined as number | undefined,
    ...over,
});

// Cut 4: there is no `alreadyTried` set. `resolveTopic` takes one argument and
// the caller revalidates the single hit it returns.

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

    it('opens the target conversation when one is known and this one has content', () => {
        const decision = resolveTopic(input({ contentState: 'content', findSessionFor: () => 9 }));
        expect(decision).toEqual({ kind: 'open', sessionId: 9, target: EX5 });
    });

    it('creates a new conversation when the target is unknown and this one has content', () => {
        const decision = resolveTopic(input({ contentState: 'content' }));
        expect(decision).toEqual({ kind: 'create-and-stage', target: EX5 });
    });

    it('never rehomes a conversation with content, even for the course topic', () => {
        const decision = resolveTopic(input({ target: COURSE42, committedContext: EX5, contentState: 'content', findSessionFor: () => 3 }));
        expect(decision).toEqual({ kind: 'open', sessionId: 3, target: COURSE42 });
    });

    it('refuses a cross-course target', () => {
        const decision = resolveTopic(input({ target: { mode: 'COURSE_CHAT' as const, entityId: 99 } }));
        expect(decision).toEqual({ kind: 'refuse', reason: 'cross-course' });
    });
});
