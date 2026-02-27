# Phase 11: Bundle Optimization - Research

**Researched:** 2026-02-25
**Domain:** esbuild bundle analysis and optimization
**Confidence:** HIGH

## Summary

Bundle optimization for VS Code webviews requires a targeted approach focused on tree-shaking verification and bundle analysis rather than code splitting (which is incompatible with the IIFE format required by VS Code). The current 3.5MB webview bundle can be optimized by ensuring proper tree-shaking for Lucide icons, expanding Shiki language support while verifying proper bundling, and using esbuild's metafile feature with visualization tools to identify optimization opportunities.

esbuild's built-in tree-shaking works automatically with ESM imports when `bundle: true` is set. The key is ensuring libraries export ESM-compatible modules and that imports use named imports rather than barrel imports. For Lucide icons, the project already uses named imports which enables tree-shaking. For Shiki, the current implementation uses lazy dynamic imports which bundle all imported languages as separate chunks that load only when needed.

**Primary recommendation:** Use esbuild's metafile generation with esbuild-visualizer for HTML treemap reports, enforce Lucide named imports via ESLint no-restricted-imports rule, expand Shiki to all 27 required languages (20 Artemis + 7 common) using the fine-grained import pattern, and add bundle size reporting to all builds.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Size targets & tradeoffs:**
- Best-effort target of ~3MB (not a hard ceiling)
- Tree-shaking only — no dependency replacements or library swaps
- Build speed is not a concern — optimize freely
- Bundle size is report-only (no build failures on threshold)
- Minification enabled for production/package builds only, unminified for dev builds

**Shiki language bundling:**
- Bundle ALL 20 Artemis-enabled programming languages: Assembler, Bash, C, C++, C#, Dart, Go, Haskell, Java, JavaScript, Kotlin, MATLAB, OCaml, Python, R, Ruby, Rust, Swift, TypeScript, VHDL
- Plus SQL (for database queries)
- Plus 6 common markup/config languages: JSON, YAML, HTML, CSS, Markdown, XML
- Eager loading — all languages loaded at highlighter initialization
- Keep both Shiki themes (github-dark + github-light) for VS Code theme switching
- Acceptable if total bundle grows slightly due to added languages

**Lucide icon imports:**
- Add ESLint rule to prevent barrel imports from lucide-react
- Enforce named imports only (e.g., `import { Play } from 'lucide-react'`)
- Verify tree-shaking is working correctly for Lucide during analysis

**Dependency cleanup:**
- Verify @vscode/webview-ui-toolkit is fully removed (imports + package.json); clean up if remnants found
- Claude profiles all dependencies by size — no specific deps pre-targeted
- Standard esbuild tree-shaking only — no custom plugins or complex optimizations

**Bundle analysis tooling:**
- HTML treemap report via esbuild-visualizer (or equivalent)
- Separate `npm run analyze` command (not part of normal builds)
- Report files gitignored (generated artifacts, regenerate when needed)
- Normal builds always print total bundle size (KB/MB) to console

**Splitting & externals:**
- Accept IIFE constraint for webview bundle — no code splitting possible, document in PROJECT.md
- Analyze both extension host and webview bundles
- Mark `vscode` API and Node.js builtins as external in extension host bundle
- Document IIFE constraint as architectural decision in PROJECT.md with rationale

### Claude's Discretion

- Exact esbuild-visualizer integration approach
- Which Shiki language IDs map to which `.mjs` imports
- Metafile generation strategy
- Console size reporting format
- How to structure the `npm run analyze` script

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BUNDLE-01 | Bundle analyzer (esbuild-visualizer) integrated and top dependencies by size profiled | esbuild metafile generation (built-in), esbuild-visualizer for HTML treemap reports, esbuild.github.io/analyze as web-based alternative |
| BUNDLE-02 | Tree-shaking verified — only used Lucide icons and Shiki languages bundled | esbuild tree-shaking is automatic with bundle: true and ESM imports; verification via metafile analysis and ESLint rules for Lucide barrel import prevention |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| esbuild | 0.27.2 (current) | Bundler with built-in tree-shaking | 10-100x faster than webpack, automatic tree-shaking with ESM, metafile generation for analysis |
| esbuild-visualizer | 0.7.0+ | Bundle analysis visualization | Official recommendation for esbuild metafile visualization, generates interactive HTML treemap/sunburst/flame charts |
| shiki | 3.22.0 (current) | Syntax highlighting | Already in use, supports fine-grained language imports via @shikijs/langs/* pattern for optimal tree-shaking |
| lucide-react | 0.575.0 (current) | Icon library | Already migrated in Phase 9, supports tree-shaking via named imports |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ESLint no-restricted-imports | Built-in | Prevent barrel imports | Enforce named imports from lucide-react to ensure tree-shaking works |
| @shikijs/langs | 3.12.2+ | Individual language grammars | Fine-grained language imports (e.g., `import('shiki/langs/java.mjs')`) for optimal bundle control |
| @shikijs/themes | 3.12.2+ | Individual themes | Fine-grained theme imports (e.g., `import('shiki/themes/github-dark.mjs')`) for optimal bundle control |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| esbuild-visualizer | esbuild.github.io/analyze (official web tool) | Web-based requires manual upload, no CLI automation; visualizer integrates into npm scripts |
| esbuild-visualizer | @rnx-kit/esbuild-bundle-analyzer | More features (diff, stats export) but heavier; visualizer sufficient for basic analysis |
| Named Lucide imports | Direct path imports (`lucide-react/dist/esm/icons/check`) | 2KB vs 1MB load, but non-standard import path; named imports work with tree-shaking in esbuild |

**Installation:**

```bash
npm install --save-dev esbuild-visualizer
# No additional installs needed — @shikijs/langs and @shikijs/themes are part of shiki package
```

## Architecture Patterns

### Bundle Analysis Workflow

**Standard pattern for esbuild + visualizer integration:**

1. **Generate metafile during production builds:**
   ```javascript
   // esbuild.js
   const webviewResult = await webviewReactCtx.rebuild();
   if (production && webviewResult.metafile) {
     await fs.promises.writeFile(
       path.join(__dirname, 'dist/meta.json'),
       JSON.stringify(webviewResult.metafile)
     );
   }
   ```

2. **Create separate analyze script:**
   ```json
   // package.json
   "scripts": {
     "analyze": "esbuild-visualizer --metadata=dist/meta.json --open",
     "build:analyze": "npm run package && npm run analyze"
   }
   ```

3. **Add bundle size reporting to all builds:**
   ```javascript
   // After build completes
   const stats = fs.statSync(outfile);
   const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
   console.log(`[build] ${path.basename(outfile)}: ${sizeMB} MB`);
   ```

### Shiki Fine-Grained Language Loading

**Recommended pattern from official docs (HIGH confidence):**

```typescript
// Current implementation in CodeBlock.tsx uses this pattern correctly:
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const highlighterPromise = createHighlighterCore({
  themes: [
    import('shiki/themes/github-dark.mjs'),
    import('shiki/themes/github-light.mjs'),
  ],
  langs: [
    // Artemis programming languages (20)
    import('shiki/langs/asm.mjs'),           // Assembler
    import('shiki/langs/shellscript.mjs'),   // Bash (alias)
    import('shiki/langs/c.mjs'),             // C
    import('shiki/langs/cpp.mjs'),           // C++
    import('shiki/langs/csharp.mjs'),        // C#
    import('shiki/langs/dart.mjs'),          // Dart
    import('shiki/langs/go.mjs'),            // Go
    import('shiki/langs/haskell.mjs'),       // Haskell
    import('shiki/langs/java.mjs'),          // Java (already present)
    import('shiki/langs/javascript.mjs'),    // JavaScript (already present)
    import('shiki/langs/kotlin.mjs'),        // Kotlin
    import('shiki/langs/matlab.mjs'),        // MATLAB
    import('shiki/langs/ocaml.mjs'),         // OCaml
    import('shiki/langs/python.mjs'),        // Python (already present)
    import('shiki/langs/r.mjs'),             // R
    import('shiki/langs/ruby.mjs'),          // Ruby
    import('shiki/langs/rust.mjs'),          // Rust
    import('shiki/langs/swift.mjs'),         // Swift
    import('shiki/langs/typescript.mjs'),    // TypeScript (already present)
    import('shiki/langs/vhdl.mjs'),          // VHDL
    // Plus SQL and common markup/config (7)
    import('shiki/langs/sql.mjs'),           // SQL (already present)
    import('shiki/langs/json.mjs'),          // JSON
    import('shiki/langs/yaml.mjs'),          // YAML
    import('shiki/langs/html.mjs'),          // HTML
    import('shiki/langs/css.mjs'),           // CSS
    import('shiki/langs/markdown.mjs'),      // Markdown
    import('shiki/langs/xml.mjs'),           // XML
  ],
  engine: createJavaScriptRegexEngine(),
});
```

**Key points:**
- Use dynamic imports (`import()`) for async chunk loading
- Languages load eagerly at highlighter initialization (user requirement)
- Only imported languages are bundled (tree-shaking verified via metafile)
- JavaScript regex engine is CSP-safe (no WASM), smaller bundle, faster startup

### Lucide Icon Tree-Shaking Enforcement

**Pattern: ESLint rule to prevent barrel imports**

```javascript
// eslint.config.mjs or .eslintrc.js
{
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['lucide-react'],
            importNames: ['*'],
            message: 'Import specific icons from lucide-react using named imports: import { IconName } from "lucide-react"',
          },
        ],
      },
    ],
  },
}
```

**Current usage verification (MEDIUM confidence — need to verify):**
- Project uses centralized `iconMap.ts` with 46 named imports: ✓ Good for tree-shaking
- 4 total import statements found in codebase
- IconButton.tsx has 7 direct named imports: ✓ Good
- No barrel imports detected (e.g., `import * as Lucide from 'lucide-react'`)

### esbuild External Configuration

**Pattern: Mark platform-provided modules as external**

```javascript
// esbuild.js - extension host bundle
{
  platform: 'node',
  external: ['vscode'],  // VS Code provides this
  // Node.js builtins automatically marked external with platform: 'node'
}

// esbuild.js - webview bundle
{
  platform: 'browser',
  external: [],  // No externals — everything must be bundled for browser
}
```

**Why this matters:**
- Extension host runs in Node.js context with access to `vscode` API
- Webview runs in browser context (no Node.js, no `vscode` API direct access)
- Marking `vscode` external prevents bundling 0-byte stub, reduces bundle size
- Node.js builtins (fs, path, etc.) automatically external with `platform: 'node'`

### Bundle Size Reporting

**Pattern: Console output during builds**

```javascript
// esbuild.js - add after build completes
const formatSize = (bytes) => {
  const kb = bytes / 1024;
  const mb = kb / 1024;
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${kb.toFixed(2)} KB`;
};

// After extension build
const extStats = fs.statSync('dist/extension.js');
console.log(`[build] extension.js: ${formatSize(extStats.size)}`);

// After webview build
const webviewStats = fs.statSync('dist/webview-react.js');
console.log(`[build] webview-react.js: ${formatSize(webviewStats.size)}`);
console.log(`[build] Total bundle size: ${formatSize(extStats.size + webviewStats.size)}`);
```

### Anti-Patterns to Avoid

- **Barrel imports from Lucide:** `import * as Icons from 'lucide-react'` bundles all 1000+ icons
- **Full Shiki bundle imports:** `import { getHighlighter } from 'shiki'` bundles all languages/themes
- **Code splitting with IIFE:** VS Code webviews don't support ESM code splitting (Issue #93041)
- **Manual minification passes:** esbuild `minify: true` is sufficient, don't add uglify/terser
- **Build failures on size thresholds:** Report-only approach per user requirement

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bundle analysis visualization | Custom metafile parser + D3 charts | esbuild-visualizer or esbuild.github.io/analyze | Mature treemap/sunburst/flame chart implementations, handles metafile format changes |
| Tree-shaking verification | Manual bundle content inspection | esbuild metafile analysis + analyzer tools | Metafile contains precise import graph and bundle composition |
| Icon import linting | Custom ESLint plugin | Built-in `no-restricted-imports` rule | Standard ESLint rule with pattern matching sufficient for preventing barrel imports |
| Bundle size tracking | Custom build size scripts | esbuild metafile + fs.statSync | esbuild already tracks sizes, just extract and format |

**Key insight:** esbuild's metafile is the source of truth for bundle analysis. All optimization decisions should be based on metafile data, not manual inspection or assumptions about what's bundled.

## Common Pitfalls

### Pitfall 1: Assuming IIFE Prevents Tree-Shaking

**What goes wrong:** Developers assume IIFE bundle format prevents tree-shaking and attempt to switch to ESM.

**Why it happens:** Confusion between code splitting (requires ESM) and tree-shaking (works with IIFE).

**How to avoid:** Understand that esbuild tree-shaking works with IIFE format when `bundle: true` and ESM-compatible imports are used. Only code splitting requires ESM output format.

**Warning signs:** Attempting to use `format: 'esm'` for webview bundle, which won't load in VS Code webviews without additional module loading setup.

### Pitfall 2: Lucide Barrel Imports After Migration

**What goes wrong:** After migrating to Lucide, developers accidentally use barrel imports (`import { Icon1, Icon2, Icon3 } from 'lucide-react'`) which bundles all 1000+ icons despite appearing to be named imports.

**Why it happens:** Lucide-react uses barrel file exports from index. Even named imports from the main package load the entire barrel file during module resolution before tree-shaking.

**How to avoid:**
1. Add ESLint `no-restricted-imports` rule to catch barrel imports at lint time
2. Verify with metafile analysis that only used icons are in bundle
3. Current codebase already uses named imports via centralized iconMap.ts (46 icons) — just need to verify no regressions

**Warning signs:** Bundle size increases significantly when adding a single new icon, metafile shows all lucide-react icons in bundle graph.

### Pitfall 3: Shiki Full Bundle Import

**What goes wrong:** Using `import { getHighlighter } from 'shiki'` or `import { getHighlighter } from 'shiki/bundle/full'` bundles all 200+ languages and themes (6.4MB minified).

**Why it happens:** Convenience of full bundle, lack of awareness about fine-grained import pattern.

**How to avoid:** Always use `shiki/core` with explicit theme/language imports:
```typescript
import { createHighlighterCore } from 'shiki/core';
langs: [
  import('shiki/langs/java.mjs'),
  import('shiki/langs/python.mjs'),
  // ... explicit list
]
```

**Warning signs:** Bundle size >5MB, metafile shows hundreds of language grammar files, slow highlighter initialization.

### Pitfall 4: Not Generating Metafile in Production Builds

**What goes wrong:** Metafile only generated during analyze script, not during normal production builds. Can't compare size changes across builds.

**Why it happens:** Assumption that metafile is only needed for analysis, not ongoing monitoring.

**How to avoid:** Always generate metafile when `production: true`, write to `dist/meta.json`, gitignore the file. Enables comparing metafiles across builds to detect regressions.

**Warning signs:** No metafile in dist/ after production build, can't identify what caused bundle size increase between commits.

### Pitfall 5: Forgetting to Mark vscode External

**What goes wrong:** Extension host bundle tries to include `vscode` module, fails with "module not found" or bundles empty stub.

**Why it happens:** Confusion about VS Code API availability, not reading bundling docs.

**How to avoid:** Always mark `vscode` as external in extension host bundle: `external: ['vscode']`. Current project already does this correctly in esbuild.js.

**Warning signs:** Build warnings about missing vscode module, unnecessary stub code in extension.js bundle.

## Code Examples

### Example 1: Complete esbuild.js with Metafile and Size Reporting

```javascript
// Source: Adapted from current project esbuild.js + official esbuild docs
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');

// Helper: Format bytes to KB/MB
const formatSize = (bytes) => {
  const kb = bytes / 1024;
  const mb = kb / 1024;
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${kb.toFixed(2)} KB`;
};

async function main() {
  const { default: inlineWorkerPlugin } = await import('esbuild-plugin-inline-worker');

  // Extension host bundle (Node.js)
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: true,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],  // VS Code API is external
    // Node.js builtins automatically marked external with platform: 'node'
  });

  // Webview bundle (Browser + IIFE)
  const webviewReactCtx = await esbuild.context({
    entryPoints: ['src/views/webview/react/index.tsx'],
    bundle: true,
    format: 'iife',  // Required for VS Code webviews (no code splitting)
    minify: production,
    sourcemap: true,
    platform: 'browser',
    outfile: 'dist/webview-react.js',
    metafile: true,  // ALWAYS generate metafile for analysis
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"'
    },
    plugins: [inlineWorkerPlugin(), cssModulesPlugin()],
  });

  // Build
  await extensionCtx.rebuild();
  const webviewResult = await webviewReactCtx.rebuild();

  // Write metafile for analysis (even in dev builds for debugging)
  if (webviewResult.metafile) {
    await fs.promises.writeFile(
      path.join(__dirname, 'dist/meta.json'),
      JSON.stringify(webviewResult.metafile)
    );
    if (production) {
      console.log('[build] Generated bundle analysis metadata at dist/meta.json');
    }
  }

  // Report bundle sizes
  const extStats = fs.statSync('dist/extension.js');
  const webviewStats = fs.statSync('dist/webview-react.js');
  console.log(`[build] extension.js: ${formatSize(extStats.size)}`);
  console.log(`[build] webview-react.js: ${formatSize(webviewStats.size)}`);
  console.log(`[build] Total: ${formatSize(extStats.size + webviewStats.size)}`);

  await extensionCtx.dispose();
  await webviewReactCtx.dispose();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

### Example 2: ESLint Rule for Lucide Import Enforcement

```javascript
// Source: ESLint no-restricted-imports documentation + Lucide best practices
// eslint.config.mjs (Flat config format - ESLint 9+)
export default [
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['lucide-react'],
              message: 'Import icons using named imports only: import { IconName } from "lucide-react". Do not use wildcard imports or default imports.',
            },
          ],
        },
      ],
    },
  },
];

// Alternative: .eslintrc.js (Legacy config format - ESLint <9)
module.exports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['lucide-react'],
            message: 'Import icons using named imports only: import { IconName } from "lucide-react"',
          },
        ],
      },
    ],
  },
};
```

### Example 3: Complete Shiki Highlighter with All 27 Languages

```typescript
// Source: Shiki official docs + current CodeBlock.tsx implementation
import { useState, useEffect } from 'react';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Singleton highlighter with all Artemis languages
let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null;

const getHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('shiki/themes/github-dark.mjs'),
        import('shiki/themes/github-light.mjs'),
      ],
      langs: [
        // Artemis programming languages (20)
        import('shiki/langs/asm.mjs'),           // Assembler
        import('shiki/langs/shellscript.mjs'),   // Bash
        import('shiki/langs/c.mjs'),             // C
        import('shiki/langs/cpp.mjs'),           // C++
        import('shiki/langs/csharp.mjs'),        // C#
        import('shiki/langs/dart.mjs'),          // Dart
        import('shiki/langs/go.mjs'),            // Go
        import('shiki/langs/haskell.mjs'),       // Haskell
        import('shiki/langs/java.mjs'),          // Java
        import('shiki/langs/javascript.mjs'),    // JavaScript
        import('shiki/langs/kotlin.mjs'),        // Kotlin
        import('shiki/langs/matlab.mjs'),        // MATLAB
        import('shiki/langs/ocaml.mjs'),         // OCaml
        import('shiki/langs/python.mjs'),        // Python
        import('shiki/langs/r.mjs'),             // R
        import('shiki/langs/ruby.mjs'),          // Ruby
        import('shiki/langs/rust.mjs'),          // Rust
        import('shiki/langs/swift.mjs'),         // Swift
        import('shiki/langs/typescript.mjs'),    // TypeScript
        import('shiki/langs/vhdl.mjs'),          // VHDL
        // Plus SQL and common markup/config (7)
        import('shiki/langs/sql.mjs'),           // SQL
        import('shiki/langs/json.mjs'),          // JSON
        import('shiki/langs/yaml.mjs'),          // YAML
        import('shiki/langs/html.mjs'),          // HTML
        import('shiki/langs/css.mjs'),           // CSS
        import('shiki/langs/markdown.mjs'),      // Markdown
        import('shiki/langs/xml.mjs'),           // XML
      ],
      engine: createJavaScriptRegexEngine(),  // CSP-safe, smaller bundle
    });
  }
  return highlighterPromise;
};

export function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    const highlight = async () => {
      try {
        const highlighter = await getHighlighter();
        const lang = language || 'text';

        // Fallback to 'text' if language not loaded
        const loadedLangs = highlighter.getLoadedLanguages();
        const supportedLang = loadedLangs.includes(lang) ? lang : 'text';

        const result = highlighter.codeToHtml(code, {
          lang: supportedLang,
          theme: 'github-dark',
        });
        setHtml(result);
      } catch (error) {
        console.error('Shiki highlighting error:', error);
        setHtml(`<pre><code>${escapeHtml(code)}</code></pre>`);
      }
    };

    highlight();
  }, [code, language]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

### Example 4: npm Scripts for Bundle Analysis

```json
{
  "scripts": {
    "compile": "npm run check-types && npm run lint && node esbuild.js",
    "package": "npm run check-types && npm run lint && node esbuild.js --production",
    "package:vsix": "npm run package && vsce package",

    "analyze": "esbuild-visualizer --metadata=dist/meta.json --open",
    "build:analyze": "npm run package && npm run analyze"
  }
}
```

**Usage:**
- `npm run compile` — Dev build with size reporting
- `npm run package` — Production build with metafile + size reporting
- `npm run analyze` — Open HTML treemap of last build
- `npm run build:analyze` — Production build + immediate analysis

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Webpack + webpack-bundle-analyzer | esbuild + esbuild-visualizer | 2021-2023 | 10-100x faster builds, simpler config, same visualization quality |
| Full Shiki bundle imports | Fine-grained shiki/core + lang imports | Shiki v1.0 (2024) | 6.4MB → <1MB for typical use cases, explicit language control |
| Direct path imports for Lucide | Named imports from main package | Current best practice | Tree-shaking works with bundlers, cleaner import syntax |
| Manual size tracking scripts | esbuild metafile JSON format | esbuild 0.8+ (2021) | Standardized bundle analysis format, ecosystem tooling support |
| Oniguruma WASM engine | JavaScript regex engine option | Shiki v1.0 (2024) | Smaller bundle, CSP-safe, faster startup for web targets |

**Deprecated/outdated:**
- `shiki/bundle/full` and `shiki/bundle/web`: Still work but discouraged for web apps — use fine-grained imports
- Lucide direct path imports (`lucide-react/dist/esm/icons/check`): Non-standard, unnecessary with proper bundler tree-shaking
- webpack-bundle-analyzer with esbuild: Works but adds webpack as transitive dependency — use esbuild-visualizer
- IIFE code splitting workarounds: VS Code Issue #93041 still open, no official support for ESM webviews as of 2026

## Open Questions

1. **Shiki language aliases and Artemis mapping**
   - What we know: Artemis uses enum names like "C_PLUS_PLUS", "C_SHARP"; Shiki uses IDs like "cpp", "csharp"
   - What's unclear: Whether fallback logic is needed for alternative language names
   - Recommendation: Use Shiki's `getLoadedLanguages()` to check availability, fallback to 'text' if language not found (current implementation already does this correctly)

2. **Bundle size delta tracking across builds**
   - What we know: Metafile contains sizes for all modules
   - What's unclear: Whether to track historical sizes or just report current
   - Recommendation: Start with console reporting only (requirement), add automated tracking in v1.2+ if needed

3. **@vscode/webview-ui-toolkit remnants**
   - What we know: User wants verification it's fully removed
   - What's unclear: Whether any imports or package.json references remain
   - Recommendation: Search codebase for imports, check package.json dependencies/devDependencies, remove if found

## Validation Architecture

> This project does not use Nyquist validation (workflow.nyquist_validation: false in .planning/config.json)

## Sources

### Primary (HIGH confidence)

- [esbuild API documentation - Metafile](https://esbuild.github.io/api/) - metafile generation, tree-shaking configuration
- [esbuild Bundle Size Analyzer](https://esbuild.github.io/analyze/) - official web-based bundle visualization tool
- [Shiki Bundles Guide](https://shiki.style/guide/bundles) - fine-grained bundle approach, import patterns
- [Shiki Best Performance Guide](https://shiki.style/guide/best-performance) - highlighter caching, engine selection, bundle optimization
- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react) - tree-shaking with named imports
- [VS Code Extension Bundling Guide](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) - external configuration, platform settings
- [GitHub Issue #93041 - VS Code webview code splitting](https://github.com/microsoft/vscode/issues/93041) - IIFE/ESM limitation for webviews

### Secondary (MEDIUM confidence)

- [esbuild-visualizer npm package](https://www.npmjs.com/package/esbuild-visualizer) - version 0.7.0, usage instructions (verified via web search)
- [@shikijs/langs npm package](https://www.npmjs.com/package/@shikijs/langs) - version 3.12.2, ESM language grammars (verified via web search)
- [ESLint no-restricted-imports rule](https://eslint.org/docs/latest/rules/no-restricted-imports) - pattern matching for import restrictions
- [esbuild tree-shaking documentation](https://github.com/evanw/esbuild/blob/main/docs/architecture.md) - automatic with bundle: true, ESM-compatible
- [Next.js barrel import optimization](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) - optimizePackageImports feature for Lucide
- [Christopher N. Katoyi Kaba - Lucide tree-shaking with Vite](https://christopher.engineering/en/blog/lucide-icons-with-vite-dev-server) - alias approach for direct imports

### Tertiary (LOW confidence)

- WebSearch results about Shiki language IDs (DeepSeek-Coder, Yi-Coder) - general language identifier conventions, not Shiki-specific documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools verified via official documentation and current package.json
- Architecture: HIGH - Patterns verified via official esbuild/Shiki docs and current codebase implementation
- Pitfalls: MEDIUM-HIGH - Common pitfalls documented in community resources, some inferred from general bundler behavior
- Shiki language mapping: HIGH - Verified via installed Shiki package (bundledLanguagesInfo array inspection)
- Lucide import verification: MEDIUM - Current usage verified via grep, tree-shaking behavior inferred from esbuild + ESM standards

**Research date:** 2026-02-25
**Valid until:** 60 days (stable technologies — esbuild, Shiki API, ESLint, VS Code constraints unlikely to change rapidly)
