---
phase: 10-testing-infrastructure
plan: 01
subsystem: testing
tags: [vitest, testing-library, test-infrastructure, test-helpers, directory-reorganization]
dependency-graph:
  requires: []
  provides: [vitest-config, react-test-helpers, test-directory-structure]
  affects: [test-suite, CI-pipeline]
tech-stack:
  added:
    - vitest@4.0.18
    - "@vitejs/plugin-react@5.1.4"
    - happy-dom@20.7.0
    - "@testing-library/react@16.3.2"
    - "@testing-library/jest-dom@6.9.1"
    - "@testing-library/user-event@14.6.1"
    - "@vitest/coverage-v8@4.0.18"
  patterns:
    - "Vitest with happy-dom for React component testing"
    - "Triple-slash directives for TypeScript global type support"
    - "Custom render wrapper with VS Code API mocking"
    - "Test directory separation by runner: unit/, e2e/, react/"
key-files:
  created:
    - iris-thaumantias/vitest.config.ts
    - iris-thaumantias/test/react/__helpers__/vitest.setup.ts
    - iris-thaumantias/test/react/__helpers__/vscodeApi.ts
    - iris-thaumantias/test/react/__helpers__/renderWithProviders.tsx
    - iris-thaumantias/test/__shared__/.gitkeep
  modified:
    - iris-thaumantias/package.json
    - iris-thaumantias/package-lock.json
    - iris-thaumantias/.vscode-test.mjs
    - 23 test files (import path updates)
  moved:
    - test/* → test/unit/ (existing extension host tests)
    - test/ui/* → test/e2e/ui/ (UI tests are E2E tests)
decisions:
  - "Use triple-slash directives for Vitest global types instead of polluting main tsconfig"
  - "Separate test directories by runner: test/unit/ (vscode-test), test/e2e/ (vscode-test E2E), test/react/ (Vitest), test/__shared__/ (cross-runner helpers)"
  - "UI tests moved to test/e2e/ui/ since vscode-extension-tester is an E2E test framework"
  - "Keep test:react script as 'vitest run' without --passWithNoTests (production use should fail on zero tests)"
  - "Use git mv for all file moves to preserve history"
metrics:
  duration_minutes: 6
  tasks_completed: 3
  files_created: 5
  files_modified: 26
  files_moved: 68
  dependencies_added: 7
  npm_scripts_added: 5
  npm_scripts_renamed: 2
  completed_at: "2026-02-25T11:46:46Z"
---

# Phase 10 Plan 01: Vitest Testing Infrastructure Summary

**One-liner:** Complete Vitest + Testing Library infrastructure with VS Code API mocking, helper wrappers, and reorganized test directories by runner type.

## What Was Built

Established the complete React testing foundation for Phase 13 component tests:

1. **Vitest Configuration**: Created vitest.config.ts with React plugin, happy-dom environment, coverage settings (v8 provider, text/html/lcov reporters), and CSS module support. No path aliases - project uses relative paths throughout.

2. **Test Helpers**: Created test/react/__helpers__/ with three files:
   - `vitest.setup.ts`: Global setup with @testing-library/jest-dom matchers, cleanup, mock clearing, and global VS Code API mock via Object.defineProperty
   - `vscodeApi.ts`: Mock factory (createMockVsCodeApi), message dispatcher (dispatchExtensionMessage), and convenience accessor (getPostMessageCalls)
   - `renderWithProviders.tsx`: Custom render wrapper with VS Code API injection, re-exports all Testing Library utilities + userEvent

3. **Test Directory Reorganization**: Separated tests by runner type:
   - `test/unit/`: Existing extension host tests (vscode-test + Mocha)
   - `test/e2e/`: E2E tests including UI tests (vscode-extension-tester)
   - `test/react/`: New Vitest React component tests
   - `test/__shared__/`: Cross-runner shared helpers (empty for now)

4. **Import Path Updates**: Updated all moved test files from `../../src/` to `../../../src/` to account for the extra directory level. Used sed for batch updates, preserving git history with git mv.

5. **NPM Scripts**: Added test:react, test:react:watch, test:react:coverage. Renamed test → test:unit, test:coverage → test:unit:coverage. Updated test:all and coverage:all to run both suites. Updated test:ui path to test/e2e/ui/.

6. **TypeScript Types**: Used triple-slash directives (`/// <reference types="vitest/globals" />` and `/// <reference types="@testing-library/jest-dom" />`) in setup file to avoid polluting main tsconfig with Vitest globals.

## Deviations from Plan

None - plan executed exactly as written.

## Technical Implementation

**Vitest Configuration Pattern:**
- `globals: true` enables describe/it/expect without imports
- `environment: 'happy-dom'` provides lightweight DOM simulation
- `setupFiles` array loads global test setup before each test file
- `css: true` enables CSS module handling (matches project's CSS modules usage)
- Coverage excludes test files, type declaration files, and index/types barrel files

**VS Code API Mocking Pattern:**
- Global mock via `Object.defineProperty(global.window, 'acquireVsCodeApi', {...})` ensures all tests get VS Code API automatically without explicit setup
- `vi.fn()` spy functions allow assertion on postMessage calls
- `dispatchExtensionMessage` simulates extension → webview messages via MessageEvent
- `getPostMessageCalls` convenience accessor simplifies test assertions

**Test Helper Design:**
- `renderWithProviders` focuses on VS Code API injection - Zustand stores are module-scoped singletons that don't need React Context providers
- Re-exports from @testing-library/react and @testing-library/user-event provide single import point for test files
- Custom render returns `{ ...renderResult, vscodeApi }` for easy access to spy assertions

**Directory Structure Rationale:**
- `test/unit/`: Extension host tests compile to out/test/unit/ via tsc, run via vscode-test with Mocha
- `test/e2e/`: E2E tests including UI tests (vscode-extension-tester is an E2E framework), compile to out/test/e2e/
- `test/react/`: Vitest tests don't compile - Vitest runs directly on TypeScript source
- `test/__shared__/`: Future home for cross-runner shared utilities (test data factories, assertion helpers)

**Import Path Update Strategy:**
- Used `find + sed` for batch updates: `sed -i '' 's|from '\''../../src/|from '\''../../../src/|g'`
- Applied to both test files and helper files (struggle-detection utilities)
- Git tracked all moves as renames, preserving file history

## Files Modified

**Created:**
- `iris-thaumantias/vitest.config.ts` (Vitest config with React plugin, happy-dom, coverage)
- `iris-thaumantias/test/react/__helpers__/vitest.setup.ts` (Global setup with VS Code API mock)
- `iris-thaumantias/test/react/__helpers__/vscodeApi.ts` (Mock factory and helpers)
- `iris-thaumantias/test/react/__helpers__/renderWithProviders.tsx` (Custom render wrapper)
- `iris-thaumantias/test/__shared__/.gitkeep` (Cross-runner helpers directory)

**Modified:**
- `iris-thaumantias/package.json` (Added test:react scripts, renamed test → test:unit, updated test:all/coverage:all)
- `iris-thaumantias/package-lock.json` (Dependency lockfile)
- `iris-thaumantias/.vscode-test.mjs` (Updated paths to out/test/unit/ and out/test/e2e/)
- 23 test files: Updated relative import paths from `../../src/` to `../../../src/`

**Moved (git mv):**
- `test/auth/` → `test/unit/auth/`
- `test/api/` → `test/unit/api/`
- `test/models/` → `test/unit/models/`
- `test/provider/` → `test/unit/provider/`
- `test/services/` → `test/unit/services/`
- `test/utils/` → `test/unit/utils/`
- `test/views/` → `test/unit/views/`
- `test/struggle-detection/` → `test/unit/struggle-detection/`
- `test/mocks/` → `test/unit/mocks/`
- `test/run-tests.sh` → `test/unit/run-tests.sh`
- `test/run-coverage.sh` → `test/unit/run-coverage.sh`
- `test/ui/*` → `test/e2e/ui/*` (5 files: helpers.ts, login.ui.test.ts, login-flow.ui.test.ts, setup.ts, run-tests.sh)

## Verification Results

**Automated Checks:**
1. ✓ `npx vitest run --passWithNoTests` exits with code 0 (Vitest configured correctly)
2. ✓ `npm run compile-tests` succeeds (existing tests compile with updated import paths)
3. ✓ All helper files exist: vitest.setup.ts, vscodeApi.ts, renderWithProviders.tsx
4. ✓ Directory structure: test/unit/, test/e2e/ui/, test/react/__helpers__/, test/__shared__/
5. ✓ Package.json has test:react, test:react:watch, test:react:coverage, test:unit, test:unit:coverage scripts

**Manual Verification:**
- Vitest config includes React plugin, happy-dom, setupFiles, coverage settings
- Setup file has triple-slash directives, jest-dom matchers, cleanup, global VS Code API mock
- vscodeApi.ts exports createMockVsCodeApi, dispatchExtensionMessage, getPostMessageCalls
- renderWithProviders.tsx exports custom render function and re-exports Testing Library utilities
- .vscode-test.mjs points to out/test/unit/ and out/test/e2e/
- Coverage/ directory already gitignored (coverage/ entry catches coverage/react/)

**Known Issues:**
- TypeScript compilation shows type conflicts between Mocha and Vitest globals (pre-existing issue from STATE.md)
- Vitest config file has ESM import warning (doesn't affect runtime - Vitest handles it)
- These are type-checking warnings that don't prevent test execution

## Dependencies & Integrations

**Requires:**
- None (foundation phase)

**Provides:**
- Vitest configuration for React component tests
- VS Code API mock factory for webview testing
- Custom render wrapper with provider support
- Test directory structure for multiple runners

**Affects:**
- Phase 13 (React Component Tests) - uses these helpers
- CI pipeline - new test:react script needs CI integration
- Test coverage reporting - separate coverage/react/ directory

## Next Steps

Phase 10-02 will create sample component tests using this infrastructure:
1. Test MessageListener component (basic rendering, event handlers)
2. Test LoadingOverlay component (conditional rendering, prop variations)
3. Verify helper integration (renderWithProviders, vscodeApi mocks)

## Testing Strategy

**Manual Testing:**
- ✓ Ran `npx vitest run --passWithNoTests` - exits cleanly with no errors
- ✓ Ran `npm run compile-tests` - existing unit tests compile successfully
- ✓ Verified directory structure matches plan
- ✓ Verified helper files contain expected exports

**Verification Commands:**
```bash
cd iris-thaumantias
npx vitest run --passWithNoTests  # Should exit 0
npm run compile-tests              # Should succeed
ls test/unit/auth/                 # Should show auth.test.ts
ls test/react/__helpers__/         # Should show 3 helper files
cat package.json | grep test:react # Should show 3 test:react scripts
```

## Commits

| Hash    | Message                                                                 |
| ------- | ----------------------------------------------------------------------- |
| c44847e | feat(10-01): install Vitest and create React testing infrastructure    |
| 620c03e | refactor(10-01): reorganize test directories and update paths           |

## Lessons Learned

1. **Triple-slash directives** for Vitest globals avoid polluting main tsconfig - Vitest's own config with `globals: true` handles runtime availability
2. **Git mv** preserves file history - essential for large directory reorganizations
3. **Batch sed updates** for import paths work well but need careful escaping of quotes
4. **Vitest config as .ts file** causes TypeScript warnings but works at runtime - Vitest has its own loader
5. **Test directory separation by runner** clarifies purpose and avoids test file conflicts

## Self-Check: PASSED

**Files exist:**
- ✓ iris-thaumantias/vitest.config.ts
- ✓ iris-thaumantias/test/react/__helpers__/vitest.setup.ts
- ✓ iris-thaumantias/test/react/__helpers__/vscodeApi.ts
- ✓ iris-thaumantias/test/react/__helpers__/renderWithProviders.tsx
- ✓ iris-thaumantias/test/__shared__/.gitkeep
- ✓ iris-thaumantias/test/unit/auth/auth.test.ts
- ✓ iris-thaumantias/test/e2e/ui/login.ui.test.ts

**Commits exist:**
- ✓ c44847e: feat(10-01): install Vitest and create React testing infrastructure
- ✓ 620c03e: refactor(10-01): reorganize test directories and update paths

**Functionality verified:**
- ✓ Vitest runs without errors (npx vitest run --passWithNoTests exits 0)
- ✓ Existing tests compile (npm run compile-tests succeeds)
- ✓ Helper files contain expected exports (createMockVsCodeApi, renderWithProviders)
- ✓ Directory structure matches plan (test/unit/, test/e2e/, test/react/, test/__shared__/)
- ✓ NPM scripts correctly configured (test:react, test:unit, test:all)
