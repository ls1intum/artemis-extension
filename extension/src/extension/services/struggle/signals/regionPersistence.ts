// extension/src/extension/services/struggle/signals/regionPersistence.ts
/**
 * A8 region-persistence state (spec §1 f_a8): >= 80 % of the textChanges of
 * the last 5 minutes in the SAME canonicalized method AND >= 30 changes AND
 * >= 5 minutes of history. Port of the F1 definition (engine_v2.py f_a8 +
 * _canonical_method_map) with ONE declared causal deviation: the canonical
 * map is built from session-SO-FAR counts at each tick instead of
 * whole-session counts (PR 2b plan, Decision 4).
 *
 * Keys are `${uriKey}|${method}`; unmapped changes (method null) count toward
 * the window total but never toward dominance.
 */
import { SPEC } from '@extension/services/struggle/config';

function isSubsequence(short: string, long: string): boolean {
    let i = 0;
    for (const c of long) {
        if (i < short.length && short[i] === c) { i++; }
    }
    return i === short.length;
}

const keyOf = (file: string, method: string): string => `${file}|${method}`;
const splitKey = (key: string): [string, string] => {
    const idx = key.indexOf('|');
    return [key.slice(0, idx), key.slice(idx + 1)];
};

/**
 * F1 canonicalization over the given counts: a name with <= 3 changes maps to
 * the most frequent (> 3) name of the same file when it is a subsequence of
 * that name or contains it as a substring.
 */
export function canonicalMethodMap(counts: ReadonlyMap<string, number>): Map<string, string> {
    const mapping = new Map<string, string>();
    for (const [key, count] of counts) {
        if (count > 3) { continue; }
        const [file, method] = splitKey(key);
        const targets: Array<[string, number]> = [];
        for (const [otherKey, otherCount] of counts) {
            if (otherCount <= 3) { continue; }
            const [otherFile, otherMethod] = splitKey(otherKey);
            if (otherFile === file && otherMethod !== method) {
                targets.push([otherMethod, otherCount]);
            }
        }
        targets.sort((a, b) => b[1] - a[1]);
        for (const [target] of targets) {
            if (isSubsequence(method, target) || method.includes(target)) {
                mapping.set(key, target);
                break;
            }
        }
    }
    return mapping;
}

interface ChangeRow { tsS: number; key: string | null }

export class A8Tracker {
    private readonly _rows: ChangeRow[] = [];
    private readonly _counts = new Map<string, number>();

    /** One single change (change granularity, not event granularity). method
     *  null = change outside any parsed method (counted, never dominant). */
    recordChange(tsS: number, uriKey: string, method: string | null): void {
        const key = method === null ? null : keyOf(uriKey, method);
        this._rows.push({ tsS, key });
        if (key !== null) {
            this._counts.set(key, (this._counts.get(key) ?? 0) + 1);
        }
    }

    activeAt(tS: number): boolean {
        if (tS < SPEC.A8_WINDOW_S) {
            return false;
        }
        const w0 = tS - SPEC.A8_WINDOW_S;
        // Window (w0, t]: binary search both bounds.
        const lo = upperBound(this._rows, w0);
        const hi = upperBound(this._rows, tS);
        const total = hi - lo;
        if (total < SPEC.A8_MIN_CHANGES) {
            return false;
        }
        const canonical = canonicalMethodMap(this._counts);
        const windowCounts = new Map<string, number>();
        for (let i = lo; i < hi; i++) {
            const raw = this._rows[i].key;
            if (raw === null) { continue; }
            const [file, method] = splitKey(raw);
            const mapped = canonical.get(raw) ?? method;
            const key = keyOf(file, mapped);
            windowCounts.set(key, (windowCounts.get(key) ?? 0) + 1);
        }
        let dom = 0;
        for (const c of windowCounts.values()) {
            dom = Math.max(dom, c);
        }
        return dom / total >= SPEC.A8_SHARE;
    }

    reset(): void {
        this._rows.length = 0;
        this._counts.clear();
    }
}

function upperBound(rows: readonly ChangeRow[], x: number): number {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].tsS <= x) { lo = mid + 1; } else { hi = mid; }
    }
    return lo;
}
