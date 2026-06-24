import { describe, expect, it } from 'vitest';

import { FeatureWindowTracker } from '@extension/services/struggle/signals/featureWindow';
import { severityFrom } from '@extension/services/struggle/signals/severity';

describe('FeatureWindowTracker (Python compute_features core port)', () => {
    it('effective window: max(10, min(60, t))', () => {
        const w = new FeatureWindowTracker();
        expect(w.computeAt(10).effectiveWindowS).toBe(10);
        expect(w.computeAt(40).effectiveWindowS).toBe(40);
        expect(w.computeAt(120).effectiveWindowS).toBe(60);
    });

    it('typing rate normalizes 1-char inserts to per-minute over the effective window', () => {
        const w = new FeatureWindowTracker();
        for (let i = 0; i < 5; i++) { w.ingestTextChange(2 + i, 1); }   // 5 one-char inserts
        const f = w.computeAt(10);
        expect(f.nOneCharInserts).toBe(5);
        expect(f.typingRate).toBeCloseTo(60 * 5 / 10, 12);              // 30/min
        expect(f.tsState).toBe(false);
        expect(f.fTyping).toBe(0);                                      // clip(1-30/20)=0
    });

    it('window is (t-eff, t]: events at exactly w0 are excluded, at t included', () => {
        const w = new FeatureWindowTracker();
        w.ingestTextChange(60, 1);    // exactly w0 for t=120 (eff=60, w0=60) -> excluded
        w.ingestTextChange(60.001, 1);
        w.ingestTextChange(120, 1);   // exactly t -> included
        expect(w.computeAt(120).nOneCharInserts).toBe(2);
    });

    it('longest gap with edits: max diff over [w0, tc..., t]', () => {
        const w = new FeatureWindowTracker();
        w.ingestTextChange(12, 0);    // textChange event without 1-char insert still counts for gaps
        w.ingestTextChange(30, 1);
        const f = w.computeAt(40);    // eff=40, w0=0; pts = [0, 12, 30, 40] -> max gap 18
        expect(f.longestGapS).toBeCloseTo(18, 12);
        expect(f.fGap).toBeCloseTo(18 / 40, 12);
    });

    it('longest gap without edits in window: min(eff, t - last edit before w0)', () => {
        const w = new FeatureWindowTracker();
        w.ingestTextChange(5, 1);
        const f = w.computeAt(120);   // eff=60, w0=60; no tc in window; t-last=115 -> min(60,115)=60
        expect(f.longestGapS).toBe(60);
        expect(f.fGap).toBe(1);
    });

    it('longest gap with no edits ever: min(eff, t - 0)', () => {
        const w = new FeatureWindowTracker();
        expect(w.computeAt(30).longestGapS).toBe(30);     // min(30, 30-0)
        expect(w.computeAt(120).longestGapS).toBe(60);    // min(60, 120)
    });

    it('TS state at typing_rate < 5/min', () => {
        const w = new FeatureWindowTracker();
        expect(w.computeAt(60).tsState).toBe(true);       // 0/min
        for (let i = 0; i < 5; i++) { w.ingestTextChange(61 + i, 1); }
        expect(w.computeAt(70).tsState).toBe(false);      // 5 in 60s window = 5/min
    });
});

describe('severityFrom (spec §1 formula, v3 2-feature mean)', () => {
    it('combines the 2-feature core mean with capped bonuses', () => {
        const s = severityFrom({ fTyping: 0.6, fGap: 0.3 }, { fFb: 1, fA8: 1, fN2: 1 });
        expect(s.sBase).toBeCloseTo(0.45, 12);                          // (0.6 + 0.3) / 2
        expect(s.s).toBeCloseTo(Math.min(1, 0.45 + 0.25 + 0.15 + 0.10), 12);
    });
    it('caps S at 1', () => {
        const s = severityFrom({ fTyping: 1, fGap: 1 }, { fFb: 1, fA8: 0, fN2: 0 });
        expect(s.s).toBe(1);
    });
});
