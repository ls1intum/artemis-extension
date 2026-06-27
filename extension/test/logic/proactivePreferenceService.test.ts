import { beforeEach, describe, expect, it } from 'vitest';

import { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';

function fakeMemento(): import('vscode').Memento {
    const store = new Map<string, unknown>();
    return {
        get: <T>(k: string, d?: T) => (store.has(k) ? (store.get(k) as T) : d),
        update: async (k: string, v: unknown) => { if (v === undefined) { store.delete(k); } else { store.set(k, v); } },
        keys: () => [...store.keys()],
    } as unknown as import('vscode').Memento;
}

describe('ProactivePreferenceService', () => {
    const scope = { serverUrl: 'https://artemis.example.com', principal: { id: 7, login: 'student1' } };
    let svc: ProactivePreferenceService;
    beforeEach(() => { svc = new ProactivePreferenceService(fakeMemento(), () => scope); });

    it('defaults to On for an unseen exercise', () => {
        expect(svc.isProactiveOn(42)).toBe(true);
    });

    it('persists an explicit Off and reads it back', () => {
        svc.setProactiveOn(42, false);
        expect(svc.isProactiveOn(42)).toBe(false);
        svc.setProactiveOn(42, true);
        expect(svc.isProactiveOn(42)).toBe(true);   // back to default-on
    });
});
