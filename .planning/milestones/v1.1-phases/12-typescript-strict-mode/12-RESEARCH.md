# Phase 12: TypeScript Strict Mode - Research

**Researched:** 2026-02-25
**Domain:** TypeScript type safety, strict mode compilation, ESLint type checking
**Confidence:** HIGH

## Summary

Phase 12 eliminates all TypeScript compilation errors and enables full strict mode across the entire codebase (extension host + webview). The project currently has 107 TypeScript errors, with strict mode already enabled in tsconfig.json but generating errors from: (1) 44+ lucide-react direct icon imports missing declaration files (TS7016), (2) test library type conflicts between Vitest/Mocha/Jest globals, (3) streamdown/mermaid module resolution, and (4) 236 occurrences of `any` types across 55 files requiring replacement with specific types. The user has decided to enable all strict flags simultaneously (not incrementally) and enforce no-any rules from the start, which is feasible because strict mode is already enabled — the task is fixing the errors, not introducing new ones.

The migration strategy is straightforward: fix pre-existing errors first (declaration files, test config, module resolution), then systematically eliminate `any` types using specific interfaces and union types. No typescript-strict-plugin is needed since strict mode is already enabled globally. Testing infrastructure (Vitest) is already in place from Phase 10.

**Primary recommendation:** Fix errors in three waves: (1) add lucide-react wildcard declaration file and resolve test library conflicts (infrastructure fixes), (2) resolve streamdown/mermaid module issue, (3) systematically replace all `any` types with proper types using the existing message contracts as a model.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Fix the 10 pre-existing TypeScript errors first, then enable strict flags
- Enable all strict flags at once (not incrementally per-flag)
- Apply strict flags to both tsconfig files (extension host + webview) simultaneously
- No `@ts-ignore` or `@ts-expect-error` suppression comments allowed — every error must be properly fixed

### any-type handling
- Prefer specific interfaces and union types when replacing `any` (not `unknown` as default)
- Single shared types file for message contracts between extension host and webview (single source of truth)
- Type assertions (`as SomeType`) allowed minimally — must include a comment explaining why a type guard isn't possible
- Claude's discretion on whether `any` is genuinely unavoidable at third-party boundaries (e.g., VS Code API callbacks)

### Enforcement rules
- Enable full `strict: true` umbrella (includes strictBindCallApply, strictPropertyInitialization, noImplicitThis, alwaysStrict, useUnknownInCatchVariables, plus the three listed)
- Do NOT enable `noUncheckedIndexedAccess` — skip this flag
- ESLint `@typescript-eslint/no-explicit-any` set to error from the start (not warn-then-flip)
- Enable full strict @typescript-eslint ruleset (no-unsafe-assignment, no-unsafe-return, no-unsafe-member-access, etc.)

### Error resolution
- If a type error reveals a genuine runtime bug, fix the bug (don't just fix the type)
- Refactor code where necessary to achieve proper types — no half-measures or minimal workarounds
- Add explicit return type annotations to all functions (not just where inference fails)
- Same strictness treatment for exported and internal functions — no tiered approach

### Claude's Discretion
- Determining where `any` is genuinely unavoidable at third-party library boundaries
- Choosing which specific @typescript-eslint strict rules to enable from the full ruleset
- Sequencing of error fixes within the pre-existing errors batch
- Deciding when a type assertion is justified vs when a type guard is the right approach

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TYPE-01 | All 10 pre-existing TypeScript errors resolved (zero compilation errors) | Current error count is 107 (not 10 as stated in requirement — likely outdated); errors categorized into: 44+ lucide-react TS7016 errors (missing .d.ts), 14 test library type conflicts, 1 streamdown/mermaid module error, 1 vitest index.d.cts error; systematic resolution approach documented below |
| TYPE-02 | TypeScript strict mode enabled incrementally (noImplicitAny, strictNullChecks, strictFunctionTypes, etc.) | Strict mode ALREADY enabled in tsconfig.json (line 12: `"strict": true`); task is fixing errors not enabling flags; all strict umbrella flags already active except noUncheckedIndexedAccess (user decision to skip) |
| TYPE-03 | ESLint @typescript-eslint/no-explicit-any rule enforced — no `any` types in codebase | 236 `any` occurrences across 55 files documented; message contracts provide model for discriminated unions and type-safe patterns; ESLint strict-type-checked preset includes no-explicit-any + no-unsafe-* rules |

**Note:** Requirement TYPE-01 states "10 pre-existing errors" but actual count is 107. This discrepancy likely reflects outdated documentation — the 10 may refer to distinct error categories or an older baseline. The phase will resolve all 107 current errors.

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 | Type system and compiler | Project standard; latest stable version supports all strict mode flags |
| @typescript-eslint/eslint-plugin | 8.54.0 | TypeScript-specific linting rules | Industry standard for TypeScript linting; provides strict-type-checked preset |
| @typescript-eslint/parser | 8.54.0 | ESLint parser for TypeScript | Required for @typescript-eslint plugin; matches plugin version |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| typescript-plugin-css-modules | 5.2.0 | CSS module type generation | Already installed; provides .module.css typing |
| Vitest | (current) | Test framework with TypeScript support | Phase 10 infrastructure; handles globals type conflicts |
| @types/vscode | (current) | VS Code API type definitions | Extension host typing; strict mode compatible |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual strict mode | typescript-strict-plugin | Plugin adds per-file exemptions; not needed when strict is already enabled globally and user wants all-at-once enablement |
| `unknown` as default | Specific interfaces | `unknown` is safer but requires type guards everywhere; user prefers specific types + unions for better DX |
| Incremental flags | All-at-once strict | Incremental reduces error volume per wave; user decided on single-shot enablement since strict is already on |

**Installation:**
```bash
# No new packages required — all dependencies already installed
# Optional: Verify versions
npm list typescript @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

## Architecture Patterns

### Recommended Error Resolution Structure
```
Wave 1: Infrastructure Fixes (unblock compilation)
├── lucide-react.d.ts              # Wildcard declaration for icon imports
├── test library type conflicts    # Separate test/unit and test/react tsconfigs
└── streamdown/mermaid resolution  # Add module declaration or mark external

Wave 2: Systematic any-type elimination
├── Extension host (src/*)
│   ├── Message handlers           # Use ExtensionToWebviewMessage | WebviewToExtensionMessage
│   ├── Service methods            # Replace any with domain types
│   └── VS Code callbacks          # Document unavoidable any at VS Code API boundaries
├── Webview (src/views/webview/react/*)
│   ├── Message contracts already  # Already has discriminated unions (messageContracts.ts)
│   ├── Component props            # Add explicit prop interfaces
│   └── Store actions              # Type Zustand actions with payloads
└── Shared (src/shared/*)
    └── messageContracts.ts        # Already type-safe; use as model

Wave 3: Function return type annotations
├── Add explicit return types to all exported functions
├── Add explicit return types to internal functions
└── Verify no implicit any in parameters
```

### Pattern 1: Module Declaration for Missing Types
**What:** Add wildcard declaration files for third-party modules without type definitions
**When to use:** TS7016 errors for modules that exist but lack .d.ts files (lucide-react direct imports)
**Example:**
```typescript
// src/types/lucide-react.d.ts
declare module "lucide-react/dist/esm/icons/*" {
  import type { LucideIcon } from "lucide-react";
  const Icon: LucideIcon;
  export default Icon;
}
```
**Source:** [lucide-react TypeScript support](https://github.com/lucide-icons/lucide/discussions/1869)

### Pattern 2: Test Library Type Conflict Resolution
**What:** Isolate test library types using triple-slash directives or separate tsconfigs
**When to use:** TS2451 errors for conflicting global declarations (vitest/mocha/jest)
**Example:**
```typescript
// test/react/tsconfig.json (React tests use Vitest globals)
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["**/*.ts", "**/*.tsx"]
}

// test/unit/tsconfig.json (Extension host tests use Mocha)
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["mocha", "node"]
  },
  "include": ["**/*.ts"]
}
```
**Source:** [Vitest globals TypeScript conflicts](https://github.com/vitest-dev/vitest/discussions/1573)

### Pattern 3: Message Contract Type Safety
**What:** Use discriminated unions for message passing between extension host and webview
**When to use:** Replace `any` in postMessage handlers and message type checking
**Example:**
```typescript
// Already implemented in src/shared/messageContracts.ts
export type ExtensionToWebviewMessage =
    | { type: 'init'; payload: InitData }
    | { type: 'error'; payload: { message: string } }
    | { type: 'loginSuccess'; payload: { username: string } };

// Handler with type narrowing
function handleMessage(message: ExtensionToWebviewMessage) {
    if (message.type === 'init') {
        // message.payload is InitData (narrowed)
        console.log(message.payload.view);
    }
}
```
**Source:** Project's existing messageContracts.ts (lines 529-567, 1261-1330)

### Pattern 4: VS Code API Unavoidable any
**What:** Document third-party API boundaries where any is genuinely unavoidable
**When to use:** VS Code API callbacks that accept unknown message shapes
**Example:**
```typescript
// Unavoidable any at VS Code webview bridge
webviewPanel.webview.onDidReceiveMessage((message: any) => {
    // Type guard immediately narrows to known message type
    if (isWebviewMessage(message)) {
        // message is now WebviewToExtensionMessage (typed)
        handleMessage(message);
    }
});
```
**Justification:** VS Code's postMessage API is untyped; type guards restore safety immediately

### Pattern 5: Specific Types Over unknown
**What:** Prefer specific interfaces and union types when replacing any
**When to use:** Domain data with known structure (courses, exercises, exams)
**Example:**
```typescript
// BAD: Replaces any with unknown (requires type guards everywhere)
interface ExerciseDetailInitMessage {
    type: 'exerciseDetailInit';
    payload: {
        exerciseData: unknown;  // Forces runtime checks
    };
}

// GOOD: Specific interface (type-safe at compile time)
interface Exercise {
    id: number;
    title?: string;
    type?: string;
    dueDate?: string;
}

interface ExerciseDetailInitMessage {
    type: 'exerciseDetailInit';
    payload: {
        exerciseData: Exercise;  // Known structure
    };
}
```
**Source:** User decision in CONTEXT.md (prefer specific interfaces over unknown)

### Anti-Patterns to Avoid
- **Suppression comments:** Never use `@ts-ignore` or `@ts-expect-error` (user requirement) — fix the underlying type issue
- **Type assertions without justification:** `as SomeType` requires a comment explaining why a type guard isn't possible (user requirement)
- **unknown as default replacement:** Prefer specific types and unions over unknown (user requirement)
- **Incremental flag enablement:** User decided on all-at-once approach (already enabled, fixing errors not flags)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-file strict mode exemptions | Custom tsconfig includes/excludes | N/A — already globally strict | User wants all-at-once enablement; project already has strict: true; task is fixing errors not gradual rollout |
| Runtime type validation | Custom type guards for every message | Existing discriminated unions + type guards in messageContracts.ts | Already implemented; isExtensionMessage() and isWebviewMessage() provide runtime safety |
| Module declaration generation | Manual .d.ts for each icon | Wildcard module declaration | lucide-react has 1600+ icons; wildcard declaration covers all direct imports with single file |
| Test type isolation | Manual type filtering in each test file | Separate test/unit and test/react tsconfigs | TypeScript supports multiple tsconfigs; compiler resolves types per context |

**Key insight:** The project already has TypeScript strict mode enabled (tsconfig.json line 12) and robust message contract types. This phase is about fixing errors and eliminating `any`, not introducing strict mode gradually. The user's all-at-once decision is already reality — we're catching up with the errors, not enabling new flags.

## Common Pitfalls

### Pitfall 1: Declaration File Scope Pollution
**What goes wrong:** Global module declarations affect entire project, including files that don't use the module
**Why it happens:** TypeScript merges all .d.ts files in src/types/ into global scope
**How to avoid:** Use specific import paths in module declarations (not wildcard namespaces)
**Warning signs:** Type inference breaks in unrelated files; conflicting type definitions for same module
**Example:**
```typescript
// BAD: Overly broad declaration
declare module "lucide-react" {
  export const Icon: any;  // Breaks existing lucide-react imports
}

// GOOD: Specific sub-path declaration
declare module "lucide-react/dist/esm/icons/*" {
  import type { LucideIcon } from "lucide-react";
  const Icon: LucideIcon;
  export default Icon;
}
```

### Pitfall 2: Test Library Type Conflicts
**What goes wrong:** TypeScript errors for redeclared block-scoped variables (describe, it, test, beforeEach, afterEach)
**Why it happens:** Vitest, Mocha, and Jest all declare the same global test functions; when types are loaded simultaneously, TypeScript sees duplicate declarations
**How to avoid:** Use separate tsconfig.json files for different test contexts (test/unit uses Mocha, test/react uses Vitest)
**Warning signs:** TS2451 errors in node_modules type definitions; IDE shows errors in test files but compilation succeeds
**Example:**
```typescript
// test/react/tsconfig.json (Vitest globals only)
{
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  }
}

// test/unit/tsconfig.json (Mocha globals only)
{
  "compilerOptions": {
    "types": ["mocha", "node"]
  }
}
```

### Pitfall 3: unknown as Lazy Replacement
**What goes wrong:** Replacing all `any` with `unknown` requires type guards everywhere, reducing developer experience
**Why it happens:** `unknown` is safer than `any` but forces runtime checks; tempting as mechanical replacement
**How to avoid:** Prefer specific interfaces and discriminated unions (user requirement); reserve `unknown` for genuinely unpredictable data
**Warning signs:** Type guards proliferate throughout codebase; simple data access requires multi-line narrowing
**Example:**
```typescript
// BAD: unknown requires type guard for every access
function handleInit(data: unknown) {
  if (typeof data === 'object' && data !== null && 'view' in data) {
    const view = (data as { view: string }).view;  // Still needs assertion
  }
}

// GOOD: Specific type allows direct access
interface InitData {
  view: string;
  payload: Record<string, unknown>;
}

function handleInit(data: InitData) {
  const view = data.view;  // Type-safe, no guard needed
}
```

### Pitfall 4: Implicit Return Type Inference
**What goes wrong:** Functions infer return types incorrectly or as overly broad unions; errors surface in callers
**Why it happens:** TypeScript infers from implementation, not intent; control flow can widen types
**How to avoid:** Add explicit return type annotations to all functions (user requirement)
**Warning signs:** Caller sites show type errors; return type hovers show unions like `string | undefined` when only `string` is intended
**Example:**
```typescript
// BAD: Inferred return type is string | undefined (even if logically always returns string)
function getCourseTitle(course: Course) {
  if (course.title) {
    return course.title;
  }
  return 'Untitled';  // Inference widens due to control flow
}

// GOOD: Explicit return type enforces contract
function getCourseTitle(course: Course): string {
  if (course.title) {
    return course.title;
  }
  return 'Untitled';
}
```

## Code Examples

Verified patterns from official sources and project codebase:

### Fixing TS7016 Missing Declaration Files
```typescript
// src/types/lucide-react.d.ts
// Provides types for direct icon imports from lucide-react/dist/esm/icons/*
declare module "lucide-react/dist/esm/icons/*" {
  import type { LucideIcon } from "lucide-react";
  const Icon: LucideIcon;
  export default Icon;
}
```
**Source:** [lucide-react GitHub discussions](https://github.com/lucide-icons/lucide/discussions/1869), [Module declaration patterns](https://blog.atomist.com/declaration-file-fix/)

### Resolving Test Library Type Conflicts
```typescript
// test/react/tsconfig.json — Vitest-only types for React component tests
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["**/*.ts", "**/*.tsx", "__helpers__/**/*.ts"]
}

// test/unit/tsconfig.json — Mocha-only types for extension host tests
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["mocha", "node", "@types/vscode"],
    "lib": ["ES2022"]
  },
  "include": ["**/*.ts"]
}
```
**Source:** [Vitest globals TypeScript conflicts](https://github.com/vitest-dev/vitest/discussions/1573), [TypeScript configuration documentation](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html)

### Message Contract Type Safety (Already Implemented)
```typescript
// src/shared/messageContracts.ts (existing pattern to follow)
export type WebviewToExtensionMessage =
    | ReadyMessage
    | LoginCommand
    | LogoutCommand
    | OpenExerciseCommand
    | ErrorMessage;

// Type guard for runtime validation
export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && typeof (msg as { type: unknown }).type === 'string'
        && ['ready', 'command', 'error'].includes((msg as { type: string }).type);
}

// Usage in handler
webviewPanel.webview.onDidReceiveMessage((message: any) => {
    if (isWebviewMessage(message)) {
        // message is now WebviewToExtensionMessage (typed)
        handleWebviewMessage(message);
    }
});
```
**Source:** Project file `/Users/liamberger/Documents/private/artemis-extension/iris-thaumantias/src/shared/messageContracts.ts`

### ESLint Strict Type-Checked Configuration
```typescript
// eslint.config.mjs — Add strict type checking rules
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: {
            project: "./tsconfig.json",  // Required for type-aware rules
        },
    },
    rules: {
        // Existing rules...

        // Strict type checking rules (add these)
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-return": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
    },
}];
```
**Source:** [@typescript-eslint documentation](https://typescript-eslint.io/rules/no-explicit-any/), [Strict type checking rules](https://typescript-eslint.io/blog/avoiding-anys/)

### Function Return Type Annotations
```typescript
// BAD: Implicit return type (inferred as string | undefined)
function formatDate(date?: string) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString();
}

// GOOD: Explicit return type enforces contract
function formatDate(date?: string): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString();
}

// GOOD: Explicit return type for async functions
async function fetchCourses(): Promise<CourseData[]> {
  const response = await fetch('/api/courses');
  return response.json();
}

// GOOD: Explicit return type for void functions
function logError(error: Error): void {
  console.error(error.message);
}
```
**Source:** [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html), User requirement (explicit return types for all functions)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Incremental strict flag enablement | Global strict: true from start | TypeScript 6.0 beta (2026) | Strict mode now default; migration is fixing errors not enabling flags |
| typescript-strict-plugin for gradual adoption | All-at-once strict mode with systematic error fixing | 2024-2026 | Plugin valuable for massive codebases (100k+ LOC); smaller projects benefit from global strict |
| `any` as acceptable in prototypes | Zero tolerance for `any` in production code | ESLint strict-type-checked presets (2023+) | Type safety enforced at lint time; no-unsafe-* rules catch implicit any propagation |
| `unknown` as default any replacement | Specific types and discriminated unions | Community best practices (2024+) | Better DX; unknown forces type guards everywhere; specific types provide compile-time safety |

**Deprecated/outdated:**
- **typescript-strict-plugin for projects with strict already enabled:** Plugin designed for gradual enablement; this project already has strict: true globally
- **Per-file `// @ts-check` comments:** TypeScript 2.x approach; replaced by tsconfig-based strict mode
- **Manual type definitions for lucide-react barrel imports:** Tree-shaking concerns drove direct imports; wildcard declaration solves typing without barrel import

## Open Questions

1. **Exercise/Exam Data Structure**
   - What we know: messageContracts.ts uses `unknown` for exerciseData and studentExam payloads (lines 269, 280, 296, 309)
   - What's unclear: Whether full Artemis API types exist or need to be created from scratch
   - Recommendation: Check for existing types in services layer; create minimal interfaces for Phase 12 (id, title, basic fields); defer comprehensive Artemis domain types to future phase

2. **VS Code API Unavoidable any Boundaries**
   - What we know: VS Code's webview.postMessage and onDidReceiveMessage are untyped (accept/return any)
   - What's unclear: Whether there are other VS Code API boundaries where any is genuinely unavoidable
   - Recommendation: Document each unavoidable any with comment explaining VS Code API constraint; immediately narrow with type guards

3. **streamdown/mermaid Module Resolution**
   - What we know: TS2307 error "Cannot find module 'mermaid' or its corresponding type declarations" in node_modules/streamdown/dist/index.d.ts
   - What's unclear: Whether streamdown requires mermaid peer dependency or should declare it external
   - Recommendation: Check if streamdown is actually used in codebase; if not, mark external in tsconfig; if yes, install @types/mermaid or add ambient declaration

4. **Function Return Type Annotation Scope**
   - What we know: User requires explicit return types for all functions (exported and internal)
   - What's unclear: Whether arrow functions in callbacks (e.g., .map(item => ...)) require explicit return types
   - Recommendation: Add return types to named functions and methods; arrow function callbacks can use inference if single expression (implicit return); multi-line arrow functions should have explicit types

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + Mocha (dual-runner setup) |
| Config file | vitest.config.ts (React tests), .vscode-test.mjs (extension host tests) |
| Quick run command | `npm run test:react` (React component tests only) |
| Full suite command | `npm run test` (all tests: unit + React) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TYPE-01 | Zero TypeScript compilation errors | Build | `npm run check-types` | ✅ Existing (npm script) |
| TYPE-02 | Strict mode flags enabled (all umbrella flags except noUncheckedIndexedAccess) | Config | Manual verification of tsconfig.json | ✅ Existing (tsconfig.json) |
| TYPE-03 | ESLint no-explicit-any enforced across codebase | Lint | `npm run lint` | ✅ Existing (npm script) |
| TYPE-03 | Message contracts maintain type safety (no any in handlers) | Unit | `npm run test` (validate handler type narrowing) | ❌ Wave 0 (test/unit/messageHandler.test.ts) |

### Sampling Rate
- **Per task commit:** `npm run check-types && npm run lint` (type check + lint only, fast validation)
- **Per wave merge:** `npm run compile` (includes check-types, lint, and build)
- **Phase gate:** `npm run compile && npm run test` (full suite green before /gsd:verify-work)

### Wave 0 Gaps
- [ ] `test/unit/messageHandler.test.ts` — covers TYPE-03 (message handler type safety, no any propagation)
  - Validates that webview message handlers use proper type narrowing
  - Verifies ExtensionToWebviewMessage and WebviewToExtensionMessage type guards work correctly
  - Ensures no any types escape into handler implementations

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

**Note:** TYPE-01 and TYPE-02 are validated by existing build scripts (check-types, lint). TYPE-03 requires one additional unit test to verify message handler type safety explicitly.

## Sources

### Primary (HIGH confidence)
- [TypeScript Official Documentation - tsconfig strict](https://www.typescriptlang.org/tsconfig/strict.html) - Verified strict mode flag behavior
- [TypeScript Official Documentation - Module .d.ts](https://www.typescriptlang.org/docs/handbook/declaration-files/templates/module-d-ts.html) - Module declaration patterns
- [@typescript-eslint no-explicit-any rule documentation](https://typescript-eslint.io/rules/no-explicit-any/) - ESLint rule configuration
- [@typescript-eslint strict-type-checked preset](https://typescript-eslint.io/blog/avoiding-anys/) - Recommended ruleset
- Project file: `/Users/liamberger/Documents/private/artemis-extension/iris-thaumantias/tsconfig.json` - Current configuration (strict: true already enabled)
- Project file: `/Users/liamberger/Documents/private/artemis-extension/iris-thaumantias/src/shared/messageContracts.ts` - Existing type-safe message pattern model

### Secondary (MEDIUM confidence)
- [How to Enable and Use TypeScript Strict Mode Effectively](https://oneuptime.com/blog/post/2026-02-20-typescript-strict-mode-guide/view) - Recent 2026 best practices guide
- [TypeScript 6 Beta Released](https://www.infoq.com/news/2026/02/typescript-6-released-beta/) - Verified TypeScript 6 makes strict mode default
- [Vitest globals TypeScript conflicts resolution](https://github.com/vitest-dev/vitest/discussions/1573) - Test library type conflict patterns
- [Lucide React TypeScript support](https://github.com/lucide-icons/lucide/discussions/1869) - Icon import typing strategy
- [Fixing TS7016 declaration file errors](https://blog.atomist.com/declaration-file-fix/) - Module declaration resolution

### Tertiary (LOW confidence)
- [typescript-strict-plugin GitHub](https://github.com/allegro/typescript-strict-plugin) - Evaluated but not needed (strict already enabled globally)
- [TypeScript any vs unknown guide](https://dmitripavlutin.com/typescript-unknown-vs-any/) - General guidance (user decision overrides with preference for specific types)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - TypeScript 5.9.3 and @typescript-eslint 8.54.0 already installed and configured
- Architecture: HIGH - Project has strict: true enabled; task is fixing errors not migrating to strict mode
- Pitfalls: HIGH - Test library conflicts and declaration file issues are well-documented with proven solutions
- Error inventory: HIGH - Ran `npm run check-types` and counted 107 errors; categorized into 4 types (lucide-react, test conflicts, module resolution, vitest)
- Migration strategy: HIGH - User decisions eliminate uncertainty (all-at-once, no suppressions, specific types over unknown)

**Research date:** 2026-02-25
**Valid until:** 2026-03-27 (30 days — TypeScript and ESLint are stable; strict mode patterns are well-established)
