import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const LAYER_MAP = [
    { prefix: 'src/extension/', alias: '@extension/' },
    { prefix: 'src/webview/', alias: '@webview/' },
    { prefix: 'src/shared/', alias: '@shared/' },
    { prefix: 'test/', alias: '@test/' },
];

export function isUpwardSpec(spec) {
    return spec === '..' || spec.startsWith('../');
}

export function resolveAliasImport({ importerAbs, spec, repoRoot }) {
    if (!isUpwardSpec(spec)) {
        return null;
    }
    const importerDir = path.dirname(importerAbs);
    const targetAbs = path.resolve(importerDir, spec);
    const targetRel = path.relative(repoRoot, targetAbs).split(path.sep).join('/');

    if (targetRel === 'package.json') {
        return '@root/package.json';
    }
    for (const { prefix, alias } of LAYER_MAP) {
        // Exact layer root (e.g. resolves to "src/extension") has no tsconfig
        // alias entry — only "@extension/*" is defined. Fail loudly instead of
        // emitting "@extension" which would not resolve at runtime.
        if (targetRel === prefix.slice(0, -1)) {
            throw new Error(
                `Cannot map "${spec}" from "${importerAbs}" — it resolves to the exact layer root "${targetRel}" which has no alias.`
            );
        }
        if (targetRel.startsWith(prefix)) {
            return alias + targetRel.slice(prefix.length);
        }
    }
    throw new Error(
        `Cannot map upward import "${spec}" from "${importerAbs}" — resolved to "${targetRel}" which is not under a known alias root.`
    );
}

function collectSpansToRewrite(sourceFile) {
    const spans = [];

    function visit(node) {
        // Static import / export with module specifier.
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            spans.push(node.moduleSpecifier);
        }
        // import x = require('...');
        if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression)
        ) {
            spans.push(node.moduleReference.expression);
        }
        // CallExpression: dynamic import(), require(), vi.mock().
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            let isTargetCall = false;
            if (callee.kind === ts.SyntaxKind.ImportKeyword) {
                isTargetCall = true; // dynamic import()
            } else if (ts.isIdentifier(callee) && callee.text === 'require') {
                isTargetCall = true;
            } else if (
                ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.expression) &&
                callee.expression.text === 'vi' &&
                callee.name.text === 'mock'
            ) {
                isTargetCall = true;
            }
            if (isTargetCall && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                spans.push(node.arguments[0]);
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return spans;
}

export function rewriteSource(source, importerAbs, repoRoot) {
    const sourceFile = ts.createSourceFile(
        importerAbs,
        source,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        importerAbs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const literals = collectSpansToRewrite(sourceFile);

    // Build edits in source order, then apply in reverse so offsets stay valid.
    const edits = [];
    for (const lit of literals) {
        const spec = lit.text;
        if (!isUpwardSpec(spec)) continue;
        const replacement = resolveAliasImport({ importerAbs, spec, repoRoot });
        if (replacement === null) continue;

        // Preserve original quote char by editing only the inside of the literal.
        // `lit.getStart()` points at the opening quote; the actual text is at +1.
        const start = lit.getStart(sourceFile) + 1;
        const end = lit.getEnd() - 1;
        edits.push({ start, end, replacement });
    }

    if (edits.length === 0) {
        return { source, changed: false };
    }

    edits.sort((a, b) => b.start - a.start);
    let out = source;
    for (const { start, end, replacement } of edits) {
        out = out.slice(0, start) + replacement + out.slice(end);
    }
    return { source: out, changed: true };
}

function walk(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === 'out' || ent.name === 'dist') continue;
            walk(full, out);
        } else if (/\.(ts|tsx|mts|cts)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

function main() {
    const repoRoot = process.cwd();
    const targets = [
        ...walk(path.join(repoRoot, 'src')),
        ...walk(path.join(repoRoot, 'test')),
    ];
    let touched = 0;
    for (const file of targets) {
        const src = fs.readFileSync(file, 'utf8');
        const { source, changed } = rewriteSource(src, file, repoRoot);
        if (changed) {
            fs.writeFileSync(file, source);
            touched++;
        }
    }
    console.log(`Rewrote imports in ${touched} files.`);
}

// Only auto-execute when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
