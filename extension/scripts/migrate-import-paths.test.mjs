import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAliasImport, rewriteSource } from './migrate-import-paths.mjs';

const REPO = '/repo';

test('extension upward → @extension', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/src/extension/activation/wiring.ts',
            spec: '../services/telemetry',
            repoRoot: REPO,
        }),
        '@extension/services/telemetry'
    );
});

test('webview upward → @webview', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/src/webview/components/EmptyState/EmptyState.tsx',
            spec: '../Button',
            repoRoot: REPO,
        }),
        '@webview/components/Button'
    );
});

test('shared upward → @shared', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/src/shared/messageContracts/domainTypes.ts',
            spec: '../types/apiResponses',
            repoRoot: REPO,
        }),
        '@shared/types/apiResponses'
    );
});

test('test upward two levels → @test', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/test/unit/services/auth/authManager.test.ts',
            spec: '../../mocks/vscodeMocks',
            repoRoot: REPO,
        }),
        '@test/unit/mocks/vscodeMocks'
    );
});

test('package.json deep upward → @root/package.json', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/src/extension/services/telemetry/recording/storageWriter.ts',
            spec: '../../../../../package.json',
            repoRoot: REPO,
        }),
        '@root/package.json'
    );
});

test('vi.mock pointing into src/webview from test/react → @webview', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/test/react/views/IrisChat/IrisChatView.test.tsx',
            spec: '../../../../src/webview/views/IrisChat/components/CodeBlock',
            repoRoot: REPO,
        }),
        '@webview/views/IrisChat/components/CodeBlock'
    );
});

test('sibling-only spec returns null', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/src/webview/components/Button/index.ts',
            spec: './styles',
            repoRoot: REPO,
        }),
        null
    );
});

test('unknown root throws', () => {
    assert.throws(() =>
        resolveAliasImport({
            importerAbs: '/repo/src/extension/foo.ts',
            spec: '../../weird/place',
            repoRoot: REPO,
        })
    );
});

test('rewriteSource rewrites static import', () => {
    const src = `import { x } from '../services/foo';\n`;
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, true);
    assert.equal(source, `import { x } from '@extension/services/foo';\n`);
});

test('rewriteSource rewrites type-only import', () => {
    const src = `import type { X } from '../services/foo';\n`;
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, true);
    assert.ok(source.includes("'@extension/services/foo'"));
});

test('rewriteSource rewrites export-from', () => {
    const src = `export { Y } from '../services/foo';\n`;
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, true);
    assert.ok(source.includes("'@extension/services/foo'"));
});

test('rewriteSource rewrites dynamic import', () => {
    const src = `const m = await import('../services/foo');\n`;
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, true);
    assert.ok(source.includes("'@extension/services/foo'"));
});

test('rewriteSource rewrites vi.mock', () => {
    const src = `vi.mock('../../../src/webview/foo', () => ({}));\n`;
    const { source, changed } = rewriteSource(src, '/repo/test/react/views/X.test.tsx', REPO);
    assert.equal(changed, true);
    assert.ok(source.includes("'@webview/foo'"));
});

test('rewriteSource preserves single quotes', () => {
    const src = `import { x } from '../foo';\n`;
    const { source } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.ok(source.includes("'@extension/foo'"));
    assert.ok(!source.includes('"@extension/foo"'));
});

test('rewriteSource preserves double quotes', () => {
    const src = `import { x } from "../foo";\n`;
    const { source } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.ok(source.includes('"@extension/foo"'));
});

test('rewriteSource leaves string literal in code untouched', () => {
    const src = `const msg = "this is just text containing '../foo' inside";\nimport { x } from '../foo';\n`;
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, true);
    assert.ok(source.includes(`"this is just text containing '../foo' inside"`));
    assert.ok(source.includes(`'@extension/foo'`));
});

test('rewriteSource leaves comment text untouched', () => {
    const src = `// example: import { x } from '../foo';\nimport { y } from '../bar';\n`;
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, true);
    assert.ok(source.includes(`// example: import { x } from '../foo';`));
    assert.ok(source.includes(`'@extension/bar'`));
});

test('rewriteSource leaves template literal untouched', () => {
    const src = "const t = `import { x } from '../foo';`;\nimport { y } from '../bar';\n";
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, true);
    assert.ok(source.includes("`import { x } from '../foo';`"));
    assert.ok(source.includes(`'@extension/bar'`));
});

test('rewriteSource skips sibling-only file', () => {
    const src = `import { x } from './sibling';\n`;
    const { source, changed } = rewriteSource(src, '/repo/src/extension/a/b.ts', REPO);
    assert.equal(changed, false);
    assert.equal(source, src);
});

test('bare parent import ("..") gets aliased', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/src/webview/components/AskIris/AskIris.tsx',
            spec: '..',
            repoRoot: REPO,
        }),
        '@webview/components'
    );
});

test('rewriteSource rewrites bare parent import', () => {
    const src = `import { Button } from '..';\n`;
    const { source, changed } = rewriteSource(
        src,
        '/repo/src/webview/components/AskIris/AskIris.tsx',
        REPO
    );
    assert.equal(changed, true);
    assert.ok(source.includes("'@webview/components'"));
});

test('upward to a layer subdirectory (no trailing slash) resolves', () => {
    assert.equal(
        resolveAliasImport({
            importerAbs: '/repo/src/extension/activation/x.ts',
            spec: '../services',
            repoRoot: REPO,
        }),
        '@extension/services'
    );
});

test('exact layer root throws (no alias for "@extension" alone)', () => {
    assert.throws(() =>
        resolveAliasImport({
            importerAbs: '/repo/src/extension/foo.ts',
            spec: '..',
            repoRoot: REPO,
        })
    );
});

test('dynamic import with bare parent', () => {
    const src = `const m = await import('..');\n`;
    const { source, changed } = rewriteSource(
        src,
        '/repo/src/webview/components/AskIris/x.ts',
        REPO
    );
    assert.equal(changed, true);
    assert.ok(source.includes("'@webview/components'"));
});

test('require with upward path', () => {
    const src = `const pkg = require('../../../../../package.json');\n`;
    const { source, changed } = rewriteSource(
        src,
        '/repo/src/extension/services/telemetry/recording/storageWriter.ts',
        REPO
    );
    assert.equal(changed, true);
    assert.ok(source.includes("'@root/package.json'"));
});
