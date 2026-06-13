import { describe, expect, it } from 'vitest';

import { scriptedA8, scriptedN2 } from './scriptedTrackers';

describe('scriptedA8', () => {
    it('returns the mapped boolean at mapped ticks and false elsewhere', () => {
        const a8 = scriptedA8([[100, 1], [110, 0]]);
        expect(a8.activeAt(100)).toBe(true);
        expect(a8.activeAt(110)).toBe(false);
        // unmapped tick defaults to inactive
        expect(a8.activeAt(120)).toBe(false);
    });

    it('recordChange is a harmless no-op that does not change activeAt', () => {
        const a8 = scriptedA8([[100, 1]]);
        a8.recordChange(50, 'file:///x.java', 'foo');
        a8.recordChange(100, 'file:///x.java', null);
        expect(a8.activeAt(100)).toBe(true);
        expect(a8.activeAt(50)).toBe(false);
    });
});

describe('scriptedN2', () => {
    it('returns the mapped boolean at mapped ticks and false elsewhere', () => {
        const n2 = scriptedN2([[200, 1], [210, 0]]);
        expect(n2.activeAt(200)).toBe(true);
        expect(n2.activeAt(210)).toBe(false);
        expect(n2.activeAt(220)).toBe(false);
    });

    it('ingestSelection / ingestSnapshot are harmless no-ops', () => {
        const n2 = scriptedN2([[200, 1]]);
        n2.ingestSelection(150, 'file:///x.java', 7);
        n2.ingestSnapshot(150, 'file:///x.java', [{ line: 1, code: 'E', message: 'm' }]);
        expect(n2.activeAt(200)).toBe(true);
        expect(n2.activeAt(150)).toBe(false);
    });
});
