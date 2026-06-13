// extension/src/extension/services/struggle/signals/errorDistance.ts
/**
 * N2 (spec §1 f_n2): an error diagnostic that has been continuously active
 * for > 60 s, more than 3 lines from the last cursor position in the same
 * file. Instance tracking ports error_lifetimes_for (02_event_tables.py):
 * identity (uri, code, message), order-preserving min-distance line alignment
 * across snapshots; matched instances keep t_first (the distance check uses
 * line_first, NOT the current line). Causal deviation, Decision 4: activity
 * ends at the removing snapshot.
 */
import { SPEC } from '@extension/services/struggle/constants';

const SKIP_COST = 1e7;

/** Order-preserving min-total-distance alignment of two ascending line lists.
 *  Returns index pairs [iOpen, iNew]; always min(m, n) pairs. Port of _align. */
export function alignLines(openLines: readonly number[], newLines: readonly number[]): Array<[number, number]> {
    const m = openLines.length;
    const n = newLines.length;
    if (m === 0 || n === 0) {
        return [];
    }
    const memo = new Map<number, { cost: number; choice: 'match' | 'skip_open' | 'skip_new' }>();
    const idx = (i: number, j: number): number => i * (n + 1) + j;
    const f = (i: number, j: number): number => {
        if (i === m) { return (n - j) * SKIP_COST; }
        if (j === n) { return (m - i) * SKIP_COST; }
        const cached = memo.get(idx(i, j));
        if (cached !== undefined) { return cached.cost; }
        const cMatch = Math.abs(openLines[i] - newLines[j]) + f(i + 1, j + 1);
        const cSkipOpen = SKIP_COST + f(i + 1, j);
        const cSkipNew = SKIP_COST + f(i, j + 1);
        const best = Math.min(cMatch, cSkipOpen, cSkipNew);
        const choice = best === cMatch ? 'match' : best === cSkipOpen ? 'skip_open' : 'skip_new';
        memo.set(idx(i, j), { cost: best, choice });
        return best;
    };
    f(0, 0);
    const pairs: Array<[number, number]> = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        const choice = memo.get(idx(i, j))!.choice;
        if (choice === 'match') {
            pairs.push([i, j]);
            i++; j++;
        } else if (choice === 'skip_open') {
            i++;
        } else {
            j++;
        }
    }
    return pairs;
}

export interface ErrorDiagnostic {
    /** 0-based start line of the diagnostic range. */
    readonly line: number;
    readonly code: string;
    readonly message: string;
}

/**
 * THE one normalization of vscode.Diagnostic.code into the N2 identity key,
 * shared by live intake (struggleEngine) and replay (PR 3). Matches the
 * offline reference, which keyed with Python str(d.get("code")): a missing
 * code becomes the literal "None" (NOT "undefined"), numbers their decimal
 * string, object codes their value. Live/replay/golden identity equality
 * depends on every consumer using exactly this function.
 */
export function normalizeDiagnosticCode(code: string | number | { value: string | number } | undefined | null): string {
    if (code === undefined || code === null) {
        return 'None';
    }
    if (typeof code === 'object') {
        return String(code.value);
    }
    return String(code);
}

interface Instance {
    line: number;
    readonly lineFirst: number;
    readonly tFirstS: number;
}

export class N2Tracker {
    /** open[`${uri} ${code} ${message}`] -> instances sorted by line. */
    private readonly _open = new Map<string, Instance[]>();
    private readonly _uriOfKey = new Map<string, string>();
    private _cursor: { uriKey: string; line: number } | null = null;

    /** Full current ERROR-severity diagnostics for one uri (empty = resolved). */
    ingestSnapshot(tsS: number, uriKey: string, errors: readonly ErrorDiagnostic[]): void {
        const newByKey = new Map<string, number[]>();
        for (const e of errors) {
            const key = `${uriKey} ${e.code} ${e.message}`;
            const lines = newByKey.get(key);
            if (lines) { lines.push(e.line); } else { newByKey.set(key, [e.line]); }
        }
        const keys = new Set<string>(newByKey.keys());
        for (const [key, uri] of this._uriOfKey) {
            if (uri === uriKey) { keys.add(key); }
        }
        for (const key of keys) {
            const cur = (this._open.get(key) ?? []).sort((a, b) => a.line - b.line);
            const newLines = (newByKey.get(key) ?? []).sort((a, b) => a - b);
            const pairs = alignLines(cur.map(c => c.line), newLines);
            const matchedOpen = new Set(pairs.map(p => p[0]));
            const matchedNew = new Set(pairs.map(p => p[1]));
            const survivors: Instance[] = [];
            for (const [i, j] of pairs) {
                cur[i].line = newLines[j];
                survivors.push(cur[i]);
            }
            void matchedOpen; // unmatched open instances are resolved (dropped)
            newLines.forEach((line, j) => {
                if (!matchedNew.has(j)) {
                    survivors.push({ line, lineFirst: line, tFirstS: tsS });
                }
            });
            if (survivors.length > 0) {
                this._open.set(key, survivors);
                this._uriOfKey.set(key, uriKey);
            } else {
                this._open.delete(key);
                this._uriOfKey.delete(key);
            }
        }
    }

    /** Last cursor position (uri + endLine of the FIRST selection of the event). */
    ingestSelection(_tsS: number, uriKey: string, endLine: number): void {
        this._cursor = { uriKey, line: endLine };
    }

    activeAt(tS: number): boolean {
        if (this._cursor === null) {
            return false;                              // no cursor -> 0 (spec §0)
        }
        for (const [key, instances] of this._open) {
            if (this._uriOfKey.get(key) !== this._cursor.uriKey) { continue; }
            for (const inst of instances) {
                if (tS - inst.tFirstS > SPEC.N2_MIN_ACTIVE_S
                    && Math.abs(inst.lineFirst - this._cursor.line) > SPEC.N2_DIST_LINES) {
                    return true;
                }
            }
        }
        return false;
    }

    reset(): void {
        this._open.clear();
        this._uriOfKey.clear();
        this._cursor = null;
    }
}
