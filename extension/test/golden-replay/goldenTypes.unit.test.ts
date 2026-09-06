import { describe, expect, it } from 'vitest';

import type { RecordedEvent } from '@extension/services/recording/types';
import { SPEC } from '@extension/services/struggle/config';

import { parseGoldenSession } from './goldenTypes';
import { assertEveryChangeHasSnapshot, assertSpecConstants } from './invariants';

const MINIMAL_TICK = {
    t: 10,
    effectiveWindowS: 10,
    nOneCharInserts: 0,
    typingRate: 5,
    longestGapS: 0,
    fTyping: 0.75,
    fGap: 0,
    fFb: 0 as 0 | 1,
    fA8: 0 as 0 | 1,
    fN2: 0 as 0 | 1,
    tsState: false,
    sBase: 0.1,
    s: 0.1,
    v: 0.05,
    fastDecay: false,
    boundaries: [],
};

const MINIMAL_ALERT = {
    t: 10,
    urgency: 0.65,
    typesPreGate: ['FM'] as const,
    types: ['FM'] as const,
    primary: 'FM' as const,
    path: 'armed' as const,
    inWarmup: false,
    inGrace: false,
};

const MINIMAL_SESSION = {
    pid: 'P1',
    durationS: 600,
    theta: 0.7,
    graceS: 32.94,
    ticks: [MINIMAL_TICK],
    alerts: [MINIMAL_ALERT],
    inject: {
        fA8: [[10, 0]] as [number, 0 | 1][],
        fN2: [] as [number, 0 | 1][],
        pasteEventTimes: [],
    },
};

describe('parseGoldenSession', () => {
    it('accepts a minimal well-formed GoldenSession and returns pid intact', () => {
        const result = parseGoldenSession(MINIMAL_SESSION);
        expect(result.pid).toBe('P1');
        expect(result.ticks).toHaveLength(1);
        expect(result.alerts).toHaveLength(1);
    });

    it('rejects an object missing required fields', () => {
        expect(() => parseGoldenSession({})).toThrow();
    });

    it('rejects when pid is missing', () => {
        const bad = { ...MINIMAL_SESSION, pid: undefined };
        expect(() => parseGoldenSession(bad)).toThrow(/pid/);
    });

    it('rejects a boundaries entry that is not a valid BoundaryType', () => {
        const bad = {
            ...MINIMAL_SESSION,
            ticks: [{ ...MINIMAL_TICK, boundaries: ['INVALID_TYPE'] }],
        };
        expect(() => parseGoldenSession(bad)).toThrow();
    });

    it('rejects fFb value that is not 0 or 1', () => {
        const bad = {
            ...MINIMAL_SESSION,
            ticks: [{ ...MINIMAL_TICK, fFb: 2 }],
        };
        expect(() => parseGoldenSession(bad)).toThrow(/fFb/);
    });

    it('rejects alert path that is not armed or e6', () => {
        const bad = {
            ...MINIMAL_SESSION,
            alerts: [{ ...MINIMAL_ALERT, path: 'unknown' }],
        };
        expect(() => parseGoldenSession(bad)).toThrow(/path/);
    });

    it('rejects alert primary that is not a valid BoundaryType', () => {
        const bad = {
            ...MINIMAL_SESSION,
            alerts: [{ ...MINIMAL_ALERT, primary: 'BOGUS' }],
        };
        expect(() => parseGoldenSession(bad)).toThrow();
    });

    it('rejects inject.fA8 tuple with wrong value', () => {
        const bad = {
            ...MINIMAL_SESSION,
            inject: { ...MINIMAL_SESSION.inject, fA8: [[10, 5]] },
        };
        expect(() => parseGoldenSession(bad)).toThrow();
    });
});

describe('assertSpecConstants', () => {
    it('passes for theta=0.7 and graceS=32.94', () => {
        const session = parseGoldenSession(MINIMAL_SESSION);
        expect(() => assertSpecConstants(session)).not.toThrow();
    });

    it('throws when theta differs from SPEC.THETA_FULL', () => {
        const session = parseGoldenSession({ ...MINIMAL_SESSION, theta: 0.5 });
        expect(() => assertSpecConstants(session)).toThrow(/theta/);
    });

    it('throws when graceS differs from SPEC.GRACE_S', () => {
        const session = parseGoldenSession({ ...MINIMAL_SESSION, graceS: 30 });
        expect(() => assertSpecConstants(session)).toThrow(/graceS/);
    });

    it('confirms SPEC.THETA_FULL === 0.7', () => {
        expect(SPEC.THETA_FULL).toBe(0.7);
    });

    it('confirms SPEC.GRACE_S === 32.94', () => {
        expect(SPEC.GRACE_S).toBe(32.94);
    });
});

describe('assertEveryChangeHasSnapshot', () => {
    it('passes for an empty event stream', () => {
        expect(() => assertEveryChangeHasSnapshot([])).not.toThrow();
    });

    it('passes when a changed URI has a fileSnapshot for the same URI', () => {
        const events: RecordedEvent[] = [
            { type: 'fileSnapshot', timestamp: 500, uri: 'file:///a.java', snapshotPath: '/tmp/snap' },
            { type: 'textChange', timestamp: 1000, uri: 'file:///a.java', changes: [] },
        ];
        expect(() => assertEveryChangeHasSnapshot(events)).not.toThrow();
    });

    it('passes by membership when the fileSnapshot lands AFTER the textChange (async I/O)', () => {
        const events: RecordedEvent[] = [
            { type: 'textChange', timestamp: 1000, uri: 'file:///a.java', changes: [] },
            { type: 'fileSnapshot', timestamp: 1100, uri: 'file:///a.java', snapshotPath: '/tmp/snap' },
        ];
        expect(() => assertEveryChangeHasSnapshot(events)).not.toThrow();
    });

    it('throws when a changed URI has only a textDocumentOpen and no fileSnapshot', () => {
        // A textDocumentOpen carries no text, so the replay would reconstruct
        // against an empty document, so a fileSnapshot is required.
        const events: RecordedEvent[] = [
            { type: 'textDocumentOpen', timestamp: 500, uri: 'file:///a.java' },
            { type: 'textChange', timestamp: 1000, uri: 'file:///a.java', changes: [] },
        ];
        expect(() => assertEveryChangeHasSnapshot(events)).toThrow(/file:\/\/\/a\.java/);
    });

    it('throws on a changed URI with no fileSnapshot anywhere', () => {
        const events: RecordedEvent[] = [
            { type: 'textChange', timestamp: 1000, uri: 'file:///a.java', changes: [] },
        ];
        expect(() => assertEveryChangeHasSnapshot(events)).toThrow(/file:\/\/\/a\.java/);
    });

    it('throws when the only snapshot is for a different URI', () => {
        const events: RecordedEvent[] = [
            { type: 'fileSnapshot', timestamp: 500, uri: 'file:///b.java', snapshotPath: '/tmp/snap' },
            { type: 'textChange', timestamp: 1000, uri: 'file:///a.java', changes: [] },
        ];
        expect(() => assertEveryChangeHasSnapshot(events)).toThrow(/file:\/\/\/a\.java/);
    });
});
