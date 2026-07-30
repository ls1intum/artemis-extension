import { describe, expect, it } from 'vitest';

import { describeContextSwap, isContextSwap, parseContextSwap } from '@extension/services/iris/context/contextMarkers';

/** The real wire shape: attributes live INSIDE a json content item, as an object. */
const marker = (attributes: unknown) => ({
    id: 3, sender: 'CTXSWAP', sentAt: '2026-07-29T10:00:00Z',
    content: [{ id: 456, type: 'json', attributes }],
});

describe('parseContextSwap', () => {
    it('reads an added transition from the json content item', () => {
        const swap = parseContextSwap(marker({
            transition: 'added', entityMode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS',
        }));
        expect(swap).toEqual({
            transition: 'added',
            context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
        });
    });

    it('reads a changed transition', () => {
        const swap = parseContextSwap(marker({
            transition: 'changed', entityMode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, name: 'DFS',
        }));
        expect(swap?.transition).toBe('changed');
        expect(swap?.context?.entityId).toBe(7);
    });

    it('accepts attributes serialised as a string', () => {
        // Defensive only: @JsonRawValue makes the object form the real one.
        const swap = parseContextSwap(marker('{"transition":"added","entityMode":"COURSE_CHAT","entityId":42}'));
        expect(swap?.context?.entityId).toBe(42);
    });

    it('returns a removed transition with no context', () => {
        // NON_EMPTY drops entityMode, entityId and name for removed; the course
        // context is derived by the caller from the conversation's courseId.
        expect(parseContextSwap(marker({ transition: 'removed' }))).toEqual({ transition: 'removed', context: undefined });
    });

    it('accepts an added marker whose name could not be resolved', () => {
        // NON_EMPTY drops name when it is "", which happens on any transition.
        const swap = parseContextSwap(marker({ transition: 'added', entityMode: 'LECTURE_CHAT', entityId: 8 }));
        expect(swap?.context).toEqual({ mode: 'LECTURE_CHAT', entityId: 8, name: undefined });
    });

    it('ignores a text content item and finds the json one', () => {
        const swap = parseContextSwap({
            id: 3, sender: 'CTXSWAP',
            content: [{ type: 'text', textContent: 'ignored' }, { type: 'json', attributes: { transition: 'removed' } }],
        });
        expect(swap?.transition).toBe('removed');
    });

    it('is undefined for a non-marker message', () => {
        expect(parseContextSwap({ id: 1, sender: 'USER', content: [{ type: 'text', textContent: 'hi' }] })).toBeUndefined();
    });

    it('is undefined for a marker with no json content item', () => {
        expect(parseContextSwap({ id: 1, sender: 'CTXSWAP', content: [] })).toBeUndefined();
    });

    it('is undefined for a marker with an unknown transition', () => {
        expect(parseContextSwap(marker({ transition: 'teleported' }))).toBeUndefined();
    });

    it('preserves an unknown entityMode', () => {
        const swap = parseContextSwap(marker({ transition: 'added', entityMode: 'FUTURE_CHAT', entityId: 1 }));
        expect(swap?.context?.mode).toBe('FUTURE_CHAT');
    });
});

describe('isContextSwap', () => {
    it('is true for a CTXSWAP sender even when the payload is undecodable', () => {
        // hasContent must count a marker row whether or not we can decode it.
        expect(isContextSwap({ id: 1, sender: 'CTXSWAP', content: [] })).toBe(true);
    });
});

describe('describeContextSwap', () => {
    it('labels the three transitions', () => {
        const ctx = { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' };
        expect(describeContextSwap({ transition: 'added', context: ctx })).toBe('Thema gesetzt auf BFS');
        expect(describeContextSwap({ transition: 'changed', context: ctx })).toBe('Thema gewechselt zu BFS');
        expect(describeContextSwap({ transition: 'removed', context: undefined })).toBe('Thema entfernt');
    });

    it('falls back to a neutral label when the name is missing', () => {
        expect(describeContextSwap({ transition: 'added', context: { mode: 'LECTURE_CHAT', entityId: 8 } }))
            .toBe('Thema gesetzt auf Vorlesung 8');
    });

    it('falls back to the id for an unknown mode', () => {
        expect(describeContextSwap({ transition: 'added', context: { mode: 'FUTURE_CHAT', entityId: 8 } }))
            .toBe('Thema gesetzt auf Kontext 8');
    });
});
