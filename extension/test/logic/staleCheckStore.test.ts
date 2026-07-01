import { describe, expect, it } from 'vitest';

import { STALE_CHECK_STORAGE_LIMIT, StaleCheckStore } from '@extension/services/struggleIntervention/staleCheckStore';

function fakeMemento() {
    const backing = new Map<string, unknown>();
    return {
        get: <T>(k: string, d?: T) => (backing.has(k) ? (backing.get(k) as T) : (d as T)),
        update: (k: string, v: unknown) => { backing.set(k, v); return Promise.resolve(); },
        keys: () => Array.from(backing.keys()),
    } as unknown as import('vscode').Memento;
}

const scope = () => ({ serverUrl: 'https://artemis.example.com', principal: { id: 1 } });

describe('StaleCheckStore', () => {
    it('records a kind and looks it up', () => {
        const s = new StaleCheckStore(fakeMemento(), scope);
        s.recordKind(10);
        expect(s.lookup(10)).toEqual({ isStaleCheck: true });
        expect(s.lookup(11)).toBeUndefined();
    });

    it('records an answer on an existing (or new) entry', () => {
        const s = new StaleCheckStore(fakeMemento(), scope);
        s.recordKind(10);
        s.recordAnswer(10, 'solved');
        expect(s.lookup(10)).toEqual({ isStaleCheck: true, answer: 'solved' });
    });

    it('returns undefined when scope is unresolved', () => {
        const s = new StaleCheckStore(fakeMemento(), () => null);
        s.recordKind(10);
        expect(s.lookup(10)).toBeUndefined();
    });

    it('evicts the oldest entry beyond the limit', () => {
        const s = new StaleCheckStore(fakeMemento(), scope);
        for (let i = 1; i <= STALE_CHECK_STORAGE_LIMIT + 1; i++) { s.recordKind(i); }
        expect(s.lookup(1)).toBeUndefined();            // oldest evicted
        expect(s.lookup(STALE_CHECK_STORAGE_LIMIT + 1)).toEqual({ isStaleCheck: true });
    });
});
