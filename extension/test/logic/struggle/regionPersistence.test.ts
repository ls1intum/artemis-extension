import { describe, expect, it } from 'vitest';

import { DocumentShadowTracker } from '@extension/services/struggle/signals/documentShadow';
import { A8Tracker, canonicalMethodMap } from '@extension/services/struggle/signals/regionPersistence';

describe('DocumentShadowTracker', () => {
    it('returns the seeded text as before-state, then the synced after-state', () => {
        const d = new DocumentShadowTracker();
        d.seed('file:///a', 'v1');
        expect(d.beforeText('file:///a')).toBe('v1');
        d.sync('file:///a', 'v2');
        expect(d.beforeText('file:///a')).toBe('v2');
    });
    it('unknown uri has no before-state', () => {
        expect(new DocumentShadowTracker().beforeText('file:///x')).toBeUndefined();
    });
});

describe('canonicalMethodMap (session-so-far canonicalization)', () => {
    it('maps rare subsequence names onto the dominant same-file name', () => {
        const counts = new Map<string, number>([
            ['F.java|getName', 10],
            ['F.java|getNam', 2],        // subsequence of getName
            ['F.java|getNameXY', 1],     // contains getName as substring
            ['G.java|getNam', 2],        // different file: no target there
        ]);
        const map = canonicalMethodMap(counts);
        expect(map.get('F.java|getNam')).toBe('getName');
        expect(map.get('F.java|getNameXY')).toBe('getName');
        expect(map.has('G.java|getNam')).toBe(false);
    });
    it('frequent names (> 3) are never remapped', () => {
        const counts = new Map<string, number>([
            ['F.java|run', 10],
            ['F.java|runX', 4],
        ]);
        expect(canonicalMethodMap(counts).size).toBe(0);
    });
});

describe('A8Tracker (region persistence state)', () => {
    function fill(a8: A8Tracker, n: number, t0: number, method: string | null): void {
        for (let i = 0; i < n; i++) {
            a8.recordChange(t0 + i * 0.5, 'file:///F.java', method);
        }
    }
    it('inactive before 5 minutes of history', () => {
        const a8 = new A8Tracker();
        fill(a8, 40, 10, 'work');
        expect(a8.activeAt(290)).toBe(false);   // t < 300
        expect(a8.activeAt(300)).toBe(true);
    });
    it('needs >= 30 changes in the window', () => {
        const a8 = new A8Tracker();
        fill(a8, 29, 290, 'work');
        expect(a8.activeAt(310)).toBe(false);
        fill(a8, 1, 305, 'work');
        expect(a8.activeAt(310)).toBe(true);
    });
    it('unmapped changes dilute the dominance share', () => {
        const a8 = new A8Tracker();
        fill(a8, 30, 200, 'work');               // 30 mapped
        fill(a8, 10, 220, null);                  // 10 unmapped -> share 30/40 = 0.75 < 0.8
        expect(a8.activeAt(300)).toBe(false);
    });
    it('window is sliding: old changes drop out after 300 s', () => {
        const a8 = new A8Tracker();
        // 30 changes at ts 10..24.5 — all inside (20, 320]? No: ts <= 20 excluded.
        // Window for t=320 is (20, 320]: changes at 20.5..24.5 remain = 9 of them.
        fill(a8, 30, 10, 'work');                 // ts = 10, 10.5, ..., 24.5
        expect(a8.activeAt(300)).toBe(true);      // window (0, 300] holds all 30
        expect(a8.activeAt(320)).toBe(false);     // only 9 changes left in window (< 30)
    });
    it('transient names canonicalize into the dominant method (causal map)', () => {
        const a8 = new A8Tracker();
        fill(a8, 28, 200, 'getName');             // dominant: 28 > 3
        fill(a8, 3, 215, 'getNam');               // transient: 3 <= 3, subsequence
        // 31 changes total in (0, 300], all canonicalize to getName -> share 1.0
        expect(a8.activeAt(300)).toBe(true);
    });
});
