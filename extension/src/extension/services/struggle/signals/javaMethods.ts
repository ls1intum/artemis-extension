// extension/src/extension/services/struggle/signals/javaMethods.ts
/**
 * Java method boundaries via regex + brace counting (NOT a full parser),
 * declared Java-only. Port of sanitize_java / parse_methods / method_at_line
 * (lib/replay.py, frozen). Operates on the document text BEFORE a change;
 * candidates are `identifier ( ... ) [throws ...] {` at brace depth 1.
 */

export interface JavaMethod {
    readonly name: string;
    /** 0-based line of the method name. */
    readonly startLine: number;
    /** 0-based line of the closing brace (inclusive); EOF line if unbalanced. */
    readonly endLine: number;
    readonly startOffset: number;
    /** Offset AFTER the closing brace; text.length if unbalanced. */
    readonly endOffset: number;
    readonly closed: boolean;
}

const NON_METHOD_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'finally',
    'return', 'new', 'throw', 'assert', 'super', 'this', 'synchronized',
]);

/** Replace comments and string/char literals with spaces (length-preserving,
 *  newlines kept) so brace/paren counting cannot be fooled by literal content. */
export function sanitizeJava(text: string): string {
    const out = text.split('');
    const n = text.length;
    let i = 0;
    let state: 'code' | 'line' | 'block' | 'string' | 'char' = 'code';
    while (i < n) {
        const c = text[i];
        const next = i + 1 < n ? text[i + 1] : '';
        if (state === 'code') {
            if (c === '/' && next === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c === '/' && next === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c === '"') { state = 'string'; out[i] = ' '; }
            else if (c === "'") { state = 'char'; out[i] = ' '; }
            i++;
        } else if (state === 'line') {
            if (c === '\n') { state = 'code'; } else { out[i] = ' '; }
            i++;
        } else if (state === 'block') {
            if (c === '*' && next === '/') { state = 'code'; out[i] = out[i + 1] = ' '; i += 2; continue; }
            if (c !== '\n') { out[i] = ' '; }
            i++;
        } else {
            const quote = state === 'string' ? '"' : "'";
            if (c === '\\' && next !== '') {
                out[i] = ' ';
                if (next !== '\n') { out[i + 1] = ' '; }
                i += 2;
                continue;
            }
            if (c === quote) { state = 'code'; }
            if (c !== '\n') { out[i] = ' '; }
            i++;
        }
    }
    return out.join('');
}

function lineStarts(text: string): number[] {
    const starts = [0];
    let pos = text.indexOf('\n');
    while (pos !== -1) {
        starts.push(pos + 1);
        pos = text.indexOf('\n', pos + 1);
    }
    return starts;
}

function offsetToLine(starts: readonly number[], offset: number): number {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= offset) { lo = mid + 1; } else { hi = mid; }
    }
    return lo - 1;
}

function matchingDelim(s: string, openIdx: number, open: string, close: string): number | null {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
        if (s[i] === open) { depth++; }
        else if (s[i] === close) {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return null;
}

const IDENT_PAREN_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
const THROWS_RE = /^\s*(?:throws\s+[\w$.\s,]+?)?\s*\{/;

export function parseMethods(text: string): JavaMethod[] {
    const s = sanitizeJava(text);
    const starts = lineStarts(text);
    const openPositions: number[] = [];
    const closePositions: number[] = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '{') { openPositions.push(i); }
        else if (s[i] === '}') { closePositions.push(i); }
    }
    const countLE = (arr: readonly number[], x: number): number => {
        let lo = 0;
        let hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= x) { lo = mid + 1; } else { hi = mid; }
        }
        return lo;
    };
    const depthAt = (offset: number): number =>
        countLE(openPositions, offset - 1) - countLE(closePositions, offset - 1);

    const methods: JavaMethod[] = [];
    IDENT_PAREN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IDENT_PAREN_RE.exec(s)) !== null) {
        const name = m[1];
        const nameStart = m.index + m[0].indexOf(name);
        if (NON_METHOD_KEYWORDS.has(name)) { continue; }
        if (depthAt(nameStart) !== 1) { continue; }        // class-body level only
        const parenOpen = m.index + m[0].length - 1;
        const parenClose = matchingDelim(s, parenOpen, '(', ')');
        if (parenClose === null) { continue; }
        const tail = THROWS_RE.exec(s.slice(parenClose + 1));
        if (tail === null) { continue; }
        const bodyOpen = parenClose + 1 + tail[0].length - 1;
        const bodyClose = matchingDelim(s, bodyOpen, '{', '}');
        const [endOffset, closed] = bodyClose === null ? [text.length, false] : [bodyClose + 1, true];
        methods.push({
            name,
            startLine: offsetToLine(starts, nameStart),
            endLine: offsetToLine(starts, endOffset - 1),
            startOffset: nameStart,
            endOffset,
            closed,
        });
    }
    methods.sort((a, b) => a.startOffset - b.startOffset);
    return methods;
}

/** Method whose span contains the 0-based line; on overlapping (unbalanced)
 *  spans the LAST preceding signature wins (largest startLine <= line). */
export function methodAtLine(methods: readonly JavaMethod[], line: number): JavaMethod | null {
    let hit: JavaMethod | null = null;
    for (const m of methods) {
        if (m.startLine <= line && line <= m.endLine) { hit = m; }
        else if (m.startLine > line) { break; }
    }
    return hit;
}
