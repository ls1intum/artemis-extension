import { describe, expect, it } from 'vitest';

import { methodAtLine, parseMethods, sanitizeJava } from '@extension/services/struggle/signals/javaMethods';

const CLS = `public class Planner {
    private int count; // a field

    public Planner(int count) {
        this.count = count;
    }

    public int getCount() {
        if (count > 0) {
            return count;
        }
        return 0;
    }

    public void setCount(int c) throws IllegalArgumentException {
        String s = "not a method() {";
        count = c;
    }
}`;

describe('sanitizeJava', () => {
    it('blanks comments and string literals, preserving length and newlines', () => {
        const s = sanitizeJava(CLS);
        expect(s.length).toBe(CLS.length);
        expect(s.split('\n').length).toBe(CLS.split('\n').length);
        expect(s).not.toContain('a field');
        expect(s).not.toContain('not a method');
    });
    it('handles escaped quotes inside strings', () => {
        const s = sanitizeJava('String x = "a\\"b{"; int y;');
        expect(s).not.toContain('{');           // brace was inside the literal
        expect(s).toContain('int y;');
    });
});

describe('parseMethods', () => {
    it('finds methods and constructors with their line spans', () => {
        const ms = parseMethods(CLS);
        expect(ms.map(m => m.name)).toEqual(['Planner', 'getCount', 'setCount']);
        const get = ms[1];
        expect(get.startLine).toBe(7);
        expect(get.endLine).toBe(12);
        expect(get.closed).toBe(true);
    });
    it('excludes control-flow keywords (the if is not a method)', () => {
        expect(parseMethods(CLS).some(m => m.name === 'if')).toBe(false);
    });
    it('only matches at class-body depth 1 (nested calls are not methods)', () => {
        const src = `class A {\n    void run() {\n        helper(1);\n    }\n}`;
        expect(parseMethods(src).map(m => m.name)).toEqual(['run']);
    });
    it('unbalanced body extends to EOF with closed=false (mid-typing)', () => {
        // Genuinely unbalanced: broken's body brace never closes before EOF.
        // (A trailing balanced sibling would CLOSE broken — verified against the
        // Python reference parse_methods, which is the source of truth.)
        const src = `class A {\n    void broken() {\n        int x = 1;`;
        const ms = parseMethods(src);
        const broken = ms.find(m => m.name === 'broken')!;
        expect(broken.closed).toBe(false);
        expect(broken.endLine).toBe(src.split('\n').length - 1);   // spans to the last line
    });
    it('throws clause is tolerated between params and body', () => {
        expect(parseMethods(CLS).find(m => m.name === 'setCount')).toBeDefined();
    });
});

describe('methodAtLine', () => {
    it('maps a line inside the body to its method', () => {
        const ms = parseMethods(CLS);
        expect(methodAtLine(ms, 9)?.name).toBe('getCount');
        expect(methodAtLine(ms, 1)).toBeNull();           // field line
    });
    it('on overlapping spans the LAST preceding signature wins (same-line tie)', () => {
        // Two depth-1 methods sharing one line: their spans overlap on that
        // line, and method_at_line must return the later one. (Verified against
        // the Python reference; a sibling nested under an unclosed brace would
        // sit at depth 2 and never be parsed as a method, so this same-line
        // construct is the faithful overlap case.)
        const src = `class A {\n    int a() { return 1; } int b() { return 2; }\n}`;
        const ms = parseMethods(src);
        expect(ms.map(m => m.name)).toEqual(['a', 'b']);
        expect(methodAtLine(ms, 1)?.name).toBe('b');
    });
});
