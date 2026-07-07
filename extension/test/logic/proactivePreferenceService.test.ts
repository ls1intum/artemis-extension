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

    // ── Level API (Task A1) ─────────────────────────────────────────────────

    it('defaults to level "more" for an unseen exercise', () => {
        expect(svc.getLevel(42)).toBe('more');
    });

    it.each(['off', 'less', 'more'] as const)('round-trips level %s', level => {
        svc.setLevel(42, level);
        expect(svc.getLevel(42)).toBe(level);
    });

    it('defaults an unknown exercise id to "more"', () => {
        expect(svc.getLevel(999)).toBe('more');
    });

    it('reads a legacy persisted boolean `false` as "off"', () => {
        const memento = fakeMemento();
        const key = `proactive.preference::${normalizeScopeSegment(scope)}`;
        void memento.update(key, { 42: false });
        const legacySvc = new ProactivePreferenceService(memento, () => scope);
        expect(legacySvc.getLevel(42)).toBe('off');
    });

    it('normalizes an invalid persisted value back to "more"', () => {
        const memento = fakeMemento();
        const key = `proactive.preference::${normalizeScopeSegment(scope)}`;
        void memento.update(key, { 42: 'bogus' });
        const badSvc = new ProactivePreferenceService(memento, () => scope);
        expect(badSvc.getLevel(42)).toBe('more');
    });

    it('setLevel("more") deletes the stored deviation (falls back to default)', () => {
        svc.setLevel(42, 'less');
        expect(svc.getLevel(42)).toBe('less');
        svc.setLevel(42, 'more');
        expect(svc.getLevel(42)).toBe('more');
    });

    it('isProactiveOn stays derived from getLevel (off = false, less/more = true)', () => {
        svc.setLevel(42, 'less');
        expect(svc.isProactiveOn(42)).toBe(true);
        svc.setLevel(42, 'off');
        expect(svc.isProactiveOn(42)).toBe(false);
        svc.setLevel(42, 'more');
        expect(svc.isProactiveOn(42)).toBe(true);
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
