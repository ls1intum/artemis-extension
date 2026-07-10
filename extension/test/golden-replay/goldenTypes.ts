import type { BoundaryType } from '@extension/services/struggle/config';
import { BOUNDARY_PRIORITY } from '@extension/services/struggle/config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoldenTick {
    readonly t: number;
    readonly effectiveWindowS: number;
    readonly nOneCharInserts: number;
    readonly typingRate: number;
    readonly longestGapS: number;
    readonly fTyping: number;
    readonly fGap: number;
    /** Study-era bonus-severity telemetry; still present in the frozen
     *  fixtures, no longer recomputed or compared/injected. */
    readonly fFb: 0 | 1;
    readonly fA8: 0 | 1;
    readonly fN2: 0 | 1;
    readonly tsState: boolean;
    readonly sBase: number;
    /** Study-era bonus-severity telemetry; still present in the frozen
     *  fixtures, no longer recomputed or compared/injected. sBase is the
     *  decision surface and stays pinned. */
    readonly s: number;
    /** Study-era V(t) telemetry. Still present in the frozen fixtures, but no
     *  longer recomputed or compared since the live engine dropped the curve. */
    readonly v: number;
    readonly fastDecay: boolean;
    /** Boundary types pre-gate, in audit priority order. */
    readonly boundaries: BoundaryType[];
}

export interface GoldenAlert {
    readonly t: number;
    /** The urgency (S_base) that fired the alert — the v3 decision signal
     *  (alerts_full_u). */
    readonly urgency: number;
    readonly typesPreGate: BoundaryType[];
    readonly types: BoundaryType[];
    readonly primary: BoundaryType;
    readonly path: 'armed' | 'e6';
    readonly inWarmup: boolean;
    readonly inGrace: boolean;
}

export interface GoldenInject {
    /** Study-era bonus-severity telemetry; still present in the frozen
     *  fixtures, no longer recomputed or compared/injected. */
    readonly fA8: [number, 0 | 1][];
    /** Study-era bonus-severity telemetry; still present in the frozen
     *  fixtures, no longer recomputed or compared/injected. */
    readonly fN2: [number, 0 | 1][];
    /** Session-relative seconds where the reference fired an N1 paste. */
    readonly pasteEventTimes: number[];
}

export interface GoldenSession {
    readonly pid: string;
    readonly durationS: number;
    readonly theta: number;
    readonly graceS: number;
    readonly ticks: GoldenTick[];
    readonly alerts: GoldenAlert[];
    readonly inject: GoldenInject;
}

// ── Validator helpers ─────────────────────────────────────────────────────────

const VALID_BOUNDARY_TYPES = new Set<string>(BOUNDARY_PRIORITY);
const VALID_PATHS = new Set<string>(['armed', 'e6']);

function isBoundaryType(v: unknown): v is BoundaryType {
    return typeof v === 'string' && VALID_BOUNDARY_TYPES.has(v);
}

function assertNumber(v: unknown, field: string): number {
    if (typeof v !== 'number' || !isFinite(v)) {
        throw new Error(`parseGoldenSession: field "${field}" must be a finite number, got ${JSON.stringify(v)}`);
    }
    return v;
}

function assertBoolean(v: unknown, field: string): boolean {
    if (typeof v !== 'boolean') {
        throw new Error(`parseGoldenSession: field "${field}" must be a boolean, got ${JSON.stringify(v)}`);
    }
    return v;
}

function assertString(v: unknown, field: string): string {
    if (typeof v !== 'string') {
        throw new Error(`parseGoldenSession: field "${field}" must be a string, got ${JSON.stringify(v)}`);
    }
    return v;
}

function assertBit(v: unknown, field: string): 0 | 1 {
    if (v !== 0 && v !== 1) {
        throw new Error(`parseGoldenSession: field "${field}" must be 0 or 1, got ${JSON.stringify(v)}`);
    }
    return v;
}

function assertArray(v: unknown, field: string): unknown[] {
    if (!Array.isArray(v)) {
        throw new Error(`parseGoldenSession: field "${field}" must be an array, got ${JSON.stringify(v)}`);
    }
    return v;
}

function assertObject(v: unknown, context: string): Record<string, unknown> {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        throw new Error(`parseGoldenSession: ${context} must be a plain object, got ${JSON.stringify(v)}`);
    }
    return v as Record<string, unknown>;
}

function parseTick(raw: unknown, idx: number): GoldenTick {
    const r = assertObject(raw, `ticks[${idx}]`);
    const prefix = `ticks[${idx}]`;
    const boundaries = assertArray(r['boundaries'], `${prefix}.boundaries`).map((b, bi) => {
        if (!isBoundaryType(b)) {
            throw new Error(`parseGoldenSession: ${prefix}.boundaries[${bi}] is not a valid BoundaryType: ${JSON.stringify(b)}`);
        }
        return b;
    });
    return {
        t: assertNumber(r['t'], `${prefix}.t`),
        effectiveWindowS: assertNumber(r['effectiveWindowS'], `${prefix}.effectiveWindowS`),
        nOneCharInserts: assertNumber(r['nOneCharInserts'], `${prefix}.nOneCharInserts`),
        typingRate: assertNumber(r['typingRate'], `${prefix}.typingRate`),
        longestGapS: assertNumber(r['longestGapS'], `${prefix}.longestGapS`),
        fTyping: assertNumber(r['fTyping'], `${prefix}.fTyping`),
        fGap: assertNumber(r['fGap'], `${prefix}.fGap`),
        fFb: assertBit(r['fFb'], `${prefix}.fFb`),
        fA8: assertBit(r['fA8'], `${prefix}.fA8`),
        fN2: assertBit(r['fN2'], `${prefix}.fN2`),
        tsState: assertBoolean(r['tsState'], `${prefix}.tsState`),
        sBase: assertNumber(r['sBase'], `${prefix}.sBase`),
        s: assertNumber(r['s'], `${prefix}.s`),
        v: assertNumber(r['v'], `${prefix}.v`),
        fastDecay: assertBoolean(r['fastDecay'], `${prefix}.fastDecay`),
        boundaries,
    };
}

function parseBoundaryArray(raw: unknown, field: string): BoundaryType[] {
    return assertArray(raw, field).map((b, bi) => {
        if (!isBoundaryType(b)) {
            throw new Error(`parseGoldenSession: ${field}[${bi}] is not a valid BoundaryType: ${JSON.stringify(b)}`);
        }
        return b;
    });
}

function parseAlert(raw: unknown, idx: number): GoldenAlert {
    const r = assertObject(raw, `alerts[${idx}]`);
    const prefix = `alerts[${idx}]`;
    const path = assertString(r['path'], `${prefix}.path`);
    if (!VALID_PATHS.has(path)) {
        throw new Error(`parseGoldenSession: ${prefix}.path must be 'armed' or 'e6', got ${JSON.stringify(path)}`);
    }
    const primary = r['primary'];
    if (!isBoundaryType(primary)) {
        throw new Error(`parseGoldenSession: ${prefix}.primary is not a valid BoundaryType: ${JSON.stringify(primary)}`);
    }
    return {
        t: assertNumber(r['t'], `${prefix}.t`),
        urgency: assertNumber(r['urgency'], `${prefix}.urgency`),
        typesPreGate: parseBoundaryArray(r['typesPreGate'], `${prefix}.typesPreGate`),
        types: parseBoundaryArray(r['types'], `${prefix}.types`),
        primary,
        path: path as 'armed' | 'e6',
        inWarmup: assertBoolean(r['inWarmup'], `${prefix}.inWarmup`),
        inGrace: assertBoolean(r['inGrace'], `${prefix}.inGrace`),
    };
}

function parseBitTupleArray(raw: unknown, field: string): [number, 0 | 1][] {
    return assertArray(raw, field).map((item, i) => {
        if (!Array.isArray(item) || item.length !== 2) {
            throw new Error(`parseGoldenSession: ${field}[${i}] must be a [number, 0|1] tuple, got ${JSON.stringify(item)}`);
        }
        const t = item[0];
        const v = item[1];
        if (typeof t !== 'number' || !isFinite(t)) {
            throw new Error(`parseGoldenSession: ${field}[${i}][0] must be a finite number, got ${JSON.stringify(t)}`);
        }
        if (v !== 0 && v !== 1) {
            throw new Error(`parseGoldenSession: ${field}[${i}][1] must be 0 or 1, got ${JSON.stringify(v)}`);
        }
        return [t, v] as [number, 0 | 1];
    });
}

function parseInject(raw: unknown): GoldenInject {
    const r = assertObject(raw, 'inject');
    return {
        fA8: parseBitTupleArray(r['fA8'], 'inject.fA8'),
        fN2: parseBitTupleArray(r['fN2'], 'inject.fN2'),
        pasteEventTimes: assertArray(r['pasteEventTimes'], 'inject.pasteEventTimes').map((v, i) =>
            assertNumber(v, `inject.pasteEventTimes[${i}]`)
        ),
    };
}

// ── Public parser ─────────────────────────────────────────────────────────────

/**
 * Strict runtime validator for golden session JSON. Throws a descriptive Error
 * on any schema mismatch. Never uses unchecked `as` casts of the input.
 */
export function parseGoldenSession(raw: unknown): GoldenSession {
    const r = assertObject(raw, 'GoldenSession');
    const pid = r['pid'];
    if (typeof pid !== 'string') {
        throw new Error(`parseGoldenSession: field "pid" must be a string, got ${JSON.stringify(pid)}`);
    }
    return {
        pid,
        durationS: assertNumber(r['durationS'], 'durationS'),
        theta: assertNumber(r['theta'], 'theta'),
        graceS: assertNumber(r['graceS'], 'graceS'),
        ticks: assertArray(r['ticks'], 'ticks').map((t, i) => parseTick(t, i)),
        alerts: assertArray(r['alerts'], 'alerts').map((a, i) => parseAlert(a, i)),
        inject: parseInject(r['inject']),
    };
}
