---
phase: 14-dependency-cleanup-security-audit
plan: 01
subsystem: infra
tags: [npm, knip, dependencies, package-json, security-audit]

# Dependency graph
requires: []
provides:
  - knip.json config for dual-entry extension analysis
  - clsx correctly placed in dependencies (production use in 24 .tsx files)
  - "@types/katex correctly placed in devDependencies (type-only package)"
  - Clean package-lock.json regenerated after all dependency changes
  - Zero TypeScript compilation errors (fixed 2 pre-existing type errors)
affects: [all future phases that touch package.json or build]

# Tech tracking
tech-stack:
  added: [knip@5 (devDep analysis tool, npx usage)]
  patterns: [dual-entry knip analysis for VS Code extensions, dependency placement verification before removal]

key-files:
  created:
    - iris-thaumantias/knip.json
  modified:
    - iris-thaumantias/package.json
    - iris-thaumantias/package-lock.json
    - iris-thaumantias/test/react/flows/messageContracts.test.ts
    - iris-thaumantias/test/unit/provider/artemisWebviewProvider.test.ts

key-decisions:
  - "Keep all devDependencies flagged by knip (sinon, @types/sinon, @types/mocha, @vscode/test-electron, vscode-extension-tester) — knip ignores test/ dir, these are legitimately used in tests"
  - "Accept 3 low-severity vulnerabilities in @vscode/test-cli -> mocha -> diff chain (devDep only, no fix available without breaking changes to test runner)"
  - "Use as unknown as BuildErrorCodeLensProvider instead of as any to fix test type error without adding new lint violations"

patterns-established:
  - "knip dual-entry: src/extension.ts + src/views/webview/react/index.tsx covers both extension host and webview bundle entry points"
  - "MANUALLY verify knip findings before removing — knip's test/ exclusion causes false-positive devDep flags"

requirements-completed: [CLEAN-01]

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 14 Plan 01: Dependency Cleanup Summary

**knip dual-entry analysis, clsx moved to dependencies, @types/katex to devDependencies, clean lock file, zero TS errors**

## Performance

- **Duration:** 5 minutes
- **Started:** 2026-02-27T15:33:57Z
- **Completed:** 2026-02-27T15:39:00Z
- **Tasks:** 1
- **Files modified:** 5

## Accomplishments

- Created `knip.json` with dual-entry configuration for VS Code extension (extension host + React webview)
- Corrected dependency placement: `clsx` moved to `dependencies` (24 production `.tsx` files import it), `@types/katex` moved to `devDependencies` (type-only package)
- Regenerated `package-lock.json` clean after all dependency changes (3 low-severity devDep-only vulns accepted as risk)
- Fixed 2 pre-existing TypeScript compilation errors (zero TS errors now achieved)

## Task Commits

Each task was committed atomically:

1. **Task 1: Run knip dependency analysis and fix dependency placement** - `384d3d4` (chore)

**Plan metadata:** (to be added after final commit)

## Files Created/Modified

- `iris-thaumantias/knip.json` - Knip dual-entry config pointing to extension.ts and React index.tsx
- `iris-thaumantias/package.json` - clsx moved to dependencies, @types/katex moved to devDependencies
- `iris-thaumantias/package-lock.json` - Regenerated clean after all dependency changes
- `iris-thaumantias/test/react/flows/messageContracts.test.ts` - Fixed pre-existing TS2339: `payload: {} as ServiceStatusInitMessage['payload']`
- `iris-thaumantias/test/unit/provider/artemisWebviewProvider.test.ts` - Fixed pre-existing TS2345: `as unknown as BuildErrorCodeLensProvider` + added type import

## Decisions Made

- **Keep devDependencies flagged by knip:** sinon, @types/sinon, @types/mocha, @vscode/test-electron, and vscode-extension-tester are all legitimately used in `test/` directory. Knip's `"ignore": ["test/**"]` config causes these to appear unused. All verified by grep before making any decisions.
- **Accept 3 low-severity vulns:** The `@vscode/test-cli -> mocha -> diff` chain has a jsdiff DoS vulnerability. The only fix is `npm audit fix --force` which downgrades to `@vscode/test-cli@0.0.11` (breaking change). No production dependency vulnerabilities found.
- **No devDependency removals:** All flagged devDependencies were verified as legitimately used in test code. The plan's pre-verified removals (clsx placement, @types/katex placement) were the only changes needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TypeScript error in messageContracts.test.ts**
- **Found during:** Task 1 (build verification step)
- **Issue:** `withoutUrl.payload.serverUrl` — TypeScript inferred `payload` as `{}` (literal empty object type) when using `satisfies ServiceStatusInitMessage`, so `.serverUrl` access gave TS2339
- **Fix:** Added type assertion `{} as ServiceStatusInitMessage['payload']` to tell TypeScript about the optional property
- **Files modified:** `test/react/flows/messageContracts.test.ts`
- **Verification:** `npm run check-types` exits 0
- **Committed in:** `384d3d4` (part of Task 1 commit)

**2. [Rule 1 - Bug] Fixed pre-existing TypeScript error in artemisWebviewProvider.test.ts**
- **Found during:** Task 1 (build verification step)
- **Issue:** `provider.setBuildDiagnostics({})` — passing plain `{}` where `BuildErrorCodeLensProvider` is required gave TS2345
- **Fix:** Added `import type { BuildErrorCodeLensProvider }` and cast `{} as unknown as BuildErrorCodeLensProvider` to avoid both TS error and new lint `any` violation
- **Files modified:** `test/unit/provider/artemisWebviewProvider.test.ts`
- **Verification:** `npm run check-types` exits 0, lint error count unchanged (255 pre-existing)
- **Committed in:** `384d3d4` (part of Task 1 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 - pre-existing TypeScript type errors)
**Impact on plan:** Both fixes required to achieve `npm run check-types` success. No scope creep — both errors were in test files, minimal changes.

## Issues Encountered

- `npm ls clsx` showed clsx was actually absent from both `dependencies` and `devDependencies` after running `npm uninstall clsx` — the install/reinstall cycle to correct placement worked correctly. The clean `npm install` regeneration resolved the minor inconsistency.
- After initial `npm audit`, 5 vulnerabilities were reported. After clean reinstall (`rm -rf node_modules && npm install`), only 3 low-severity remain — the ajv and minimatch vulnerabilities were resolved by fresh dependency resolution.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Package.json dependency tree is now accurate and audited
- knip.json provides foundation for ongoing unused dependency detection
- Zero TypeScript compilation errors achieved (pre-existing errors fixed)
- Ready for Phase 14 completion — dependency cleanup plan complete

---
*Phase: 14-dependency-cleanup-security-audit*
*Completed: 2026-02-27*
