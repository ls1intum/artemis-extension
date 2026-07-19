import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

import { normalizeScopeSegment } from '@extension/services/courseAccessStorageService';
import { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';

function fakeMemento(): import('vscode').Memento {
    const store = new Map<string, unknown>();
    return {
        get: <T>(k: string, d?: T) => (store.has(k) ? (store.get(k) as T) : d),
        update: async (k: string, v: unknown) => { if (v === undefined) { store.delete(k); } else { store.set(k, v); } },
        keys: () => [...store.keys()],
    } as unknown as import('vscode').Memento;
}

/** Let the private serialized write chain settle before inspecting raw globalState / a fresh instance. */
const settle = () => new Promise<void>(r => setTimeout(r, 0));

describe('ProactivePreferenceService', () => {
    const scope = { serverUrl: 'https://artemis.example.com', principal: { id: 7, login: 'student1' } };
    const levelKey = `proactive.level::${normalizeScopeSegment(scope)}`;
    let svc: ProactivePreferenceService;
    beforeEach(() => { svc = new ProactivePreferenceService(fakeMemento(), () => scope); });

    it('defaults to level "more" (and On) when nothing is stored', () => {
        expect(svc.getLevel()).toBe('more');
        expect(svc.isProactiveOn()).toBe(true);
    });

    it.each(['off', 'less', 'more'] as const)('round-trips level %s (same-instance shadow)', level => {
        svc.setLevel(level);
        expect(svc.getLevel()).toBe(level);
    });

    it('is a SINGLE remembered level: a value set once is read back everywhere (no per-exercise keying)', () => {
        svc.setLevel('less');
        // There is no exercise dimension anymore — every read returns the one stored level.
        expect(svc.getLevel()).toBe('less');
        expect(svc.isProactiveOn()).toBe(true);
    });

    it('isProactiveOn derives from getLevel (off = false, less/more = true)', () => {
        svc.setLevel('off');
        expect(svc.isProactiveOn()).toBe(false);
        svc.setLevel('less');
        expect(svc.isProactiveOn()).toBe(true);
    });

    it('setLevel("more") reads back "more" synchronously (shadow) and deletes the persisted key', async () => {
        const memento = fakeMemento();
        const s = new ProactivePreferenceService(memento, () => scope);
        s.setLevel('off');
        await settle();
        expect(memento.get(levelKey)).toBe('off');      // 'off' actually reached persistence first

        s.setLevel('more');
        expect(s.getLevel()).toBe('more');              // shadow is authoritative, synchronously,
        //                                                 even though the async delete has not run yet
        await settle();
        expect(memento.keys()).not.toContain(levelKey); // persisted key deleted on `more`
    });

    it('persists across a fresh service instance over the same globalState', async () => {
        const memento = fakeMemento();
        new ProactivePreferenceService(memento, () => scope).setLevel('off');
        await settle();
        const reloaded = new ProactivePreferenceService(memento, () => scope);
        expect(reloaded.getLevel()).toBe('off');
    });

    it('validates a corrupt persisted scalar back to "more"', () => {
        for (const bogus of ['nonsense', false, 7, { level: 'off' }]) {
            const memento = fakeMemento();
            void memento.update(levelKey, bogus);
            expect(new ProactivePreferenceService(memento, () => scope).getLevel()).toBe('more');
        }
    });

    it('ignores the legacy per-exercise map key entirely (no migration)', () => {
        const memento = fakeMemento();
        void memento.update(`proactive.preference::${normalizeScopeSegment(scope)}`, { 42: 'off' });
        expect(new ProactivePreferenceService(memento, () => scope).getLevel()).toBe('more');
    });

    it('isolates levels by server::principal scope', async () => {
        const memento = fakeMemento();
        const scopeB = { serverUrl: 'https://artemis.example.com', principal: { id: 9, login: 'student2' } };
        new ProactivePreferenceService(memento, () => scope).setLevel('off');
        await settle();
        expect(new ProactivePreferenceService(memento, () => scopeB).getLevel()).toBe('more');
    });

    it('unresolved scope → getLevel "more" and setLevel is a no-op', () => {
        const s = new ProactivePreferenceService(fakeMemento(), () => null);
        s.setLevel('off');
        expect(s.getLevel()).toBe('more');
    });

    it('imports nothing from services/struggle or services/intervention (clean-bundle boundary)', () => {
        const src = readFileSync(
            join(__dirname, '../../src/extension/services/proactivePreferenceService.ts'),
            'utf8',
        );
        const importLines = src.split('\n').filter(l => /^\s*import\b/.test(l));
        expect(importLines.some(l => /services\/struggle|services\/intervention/.test(l))).toBe(false);
    });
});
