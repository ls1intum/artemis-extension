---
phase: 20-e2e-view-coverage-interactions-accessibility-cleanup
plan: 06
subsystem: cleanup
tags: [knip, dead-code, legacy-removal, typescript, message-contracts]

# Dependency graph
requires:
  - phase: 20-01
    provides: knip tooling installed and configured
provides:
  - Clean provider without duplicate legacy postMessage sends (3 removed)
  - Auth without old storage key migration fallback
  - messageContracts.ts with section comment updated to reflect active command messages
  - 5 unused files deleted (models/context.ts, models/telemetry.ts, hooks/useStreamingMessage.ts, views/index.ts, models/index.ts barrel restored)
  - Unexported dead identifiers: ICONS, IconKey, getNonce, LoggingService
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Remove export keyword for internal-only symbols rather than deleting them (getNonce, ICONS)"
    - "Knip false positives documented: barrel re-exports for test consumers, React Props types, service index re-exports"

key-files:
  created: []
  modified:
    - iris-thaumantias/src/provider/artemisWebviewProvider.ts
    - iris-thaumantias/src/auth/auth.ts
    - iris-thaumantias/src/views/app/commands/navigationCommands.ts
    - iris-thaumantias/src/shared/messageContracts.ts
    - iris-thaumantias/src/utils/iconMap.ts
    - iris-thaumantias/src/utils/webviewHelpers.ts
    - iris-thaumantias/src/services/loggingService.ts
    - iris-thaumantias/src/services/index.ts
    - iris-thaumantias/src/models/index.ts

key-decisions:
  - "BuildLogParsedMessage and GitIdentityInfoMessage retained in ExtensionToWebviewMessage union — they ARE sent by extension commands (utilityCommands.ts, repositoryCommands.ts) even though no React consumer handles them"
  - "ShowClonedRepoNoticeMessage retained — sent by repositoryCommands.ts at runtime, part of ExtensionToWebviewMessage union"
  - "models/index.ts recreated without context.ts and telemetry.ts entries — artemis.test.ts imports from barrel, needed for test compilation"
  - "knip remaining 18 unused exports are documented false positives: model class exports tested via artemis.test.ts, React Props types as API surface, service barrel re-exports"
  - "9 pre-existing Mocha test failures (ChatSessionService, ChatContextManager, AppStateManager) confirmed pre-existing before any changes — not introduced by cleanup"

patterns-established:
  - "Pre-existing test failures: always stash+run before making changes to confirm baseline"

requirements-completed: [CLEAN-01, CLEAN-02, CLEAN-03]

# Metrics
duration: ~10min
completed: 2026-02-28
---

# Phase 20 Plan 06: Legacy Cleanup Summary

**Removed 3 backward-compat postMessage duplicate sends, auth migration fallback, and 5 unused files via knip audit — codebase has one canonical websocketUpdate format**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-28T22:00:00Z
- **Completed:** 2026-02-28T23:10:00Z
- **Tasks:** 2
- **Files modified:** 9 modified, 6 deleted

## Accomplishments

- Removed 3 legacy duplicate postMessage sends from `_handleNewResult`, `_handleNewSubmission`, `_handleSubmissionProcessing` — these were sending `{ command: 'newResult', ... }` alongside the canonical `{ type: 'websocketUpdate', ... }` format
- Removed auth migration fallback for old storage key `artemis-auth-cookie` from `getCookieHeader()` — only the new `artemis-auth-token` path remains
- Ran full knip audit: deleted 5 unused files (models/context.ts, models/telemetry.ts, useStreamingMessage.ts, views/index.ts), unexported dead symbols (ICONS, IconKey, getNonce, LoggingService)
- All 892 Vitest React tests pass; 559 Mocha host tests pass (9 pre-existing failures confirmed pre-existing)

## Task Commits

1. **Task 1: Remove legacy backward-compat sends and auth migration fallback** - `55ce2c0` (refactor)
2. **Task 2: Run knip audit and remove unused exports/imports/files** - `7a165a9` (refactor)

## Files Created/Modified

- `iris-thaumantias/src/provider/artemisWebviewProvider.ts` - Removed 3 legacy postMessage blocks and updated "legacy dashboard" comment
- `iris-thaumantias/src/auth/auth.ts` - Removed migration fallback for old `artemis-auth-cookie` key in `getCookieHeader()`
- `iris-thaumantias/src/views/app/commands/navigationCommands.ts` - Updated inaccurate "legacy command" comment
- `iris-thaumantias/src/shared/messageContracts.ts` - Updated section comment from "Legacy Command Messages" to "Command Messages"
- `iris-thaumantias/src/utils/iconMap.ts` - Removed `export` from ICONS constant and IconKey type (internal use only)
- `iris-thaumantias/src/utils/webviewHelpers.ts` - Removed `export` from getNonce function (internal use only)
- `iris-thaumantias/src/services/loggingService.ts` - Removed `export { LoggingService }` (only `logger` singleton used externally)
- `iris-thaumantias/src/services/index.ts` - Removed LoggingService from barrel re-export
- `iris-thaumantias/src/models/index.ts` - Trimmed to exclude deleted context.ts and telemetry.ts entries
- **Deleted:** `src/models/context.ts`, `src/models/telemetry.ts`, `src/views/webview/react/hooks/useStreamingMessage.ts`, `src/views/webview/react/views/index.ts`
- **Deleted (tests for deleted models):** `test/unit/models/context.test.ts`, `test/unit/models/telemetry.test.ts`

## Decisions Made

- `BuildLogParsedMessage` and `GitIdentityInfoMessage` retained in `ExtensionToWebviewMessage` union — while knip flags them as unused exports (the types themselves aren't imported by name), they ARE sent at runtime by `utilityCommands.ts` and `repositoryCommands.ts`. Removing them causes TypeScript errors.
- `ShowClonedRepoNoticeMessage` retained — same reasoning; sent by repositoryCommands.ts.
- `models/index.ts` recreated (trimmed) rather than deleted — `artemis.test.ts` imports the barrel file for testing model classes.
- Remaining 18 knip "unused exports" are documented false positives — model classes tested via test files, React Props types as intentional API surface, service barrel re-exports for downstream consumers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] models/index.ts deletion broke artemis.test.ts compilation**
- **Found during:** Task 2 (knip audit)
- **Issue:** Deleting `models/index.ts` as "unused file" caused TypeScript error TS2307 — `artemis.test.ts` imports from `'../../../src/models'`
- **Fix:** Recreated `models/index.ts` without the deleted `context.ts` and `telemetry.ts` entries
- **Files modified:** `src/models/index.ts`
- **Verification:** `npx tsc --noEmit` — no longer shows models import error
- **Committed in:** `7a165a9` (Task 2 commit)

**2. [Rule 1 - Bug] Removing LoggingService export broke services/index.ts**
- **Found during:** Task 2 (knip audit)
- **Issue:** After removing `export { LoggingService }` from loggingService.ts, the barrel `services/index.ts` re-export caused TS2459
- **Fix:** Removed `LoggingService` from the `services/index.ts` barrel export line
- **Files modified:** `src/services/index.ts`
- **Verification:** `npx tsc --noEmit` — error resolved
- **Committed in:** `7a165a9` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - bugs introduced by removal causing compilation failures)
**Impact on plan:** Both auto-fixes necessary to maintain TypeScript compilation. No scope creep.

## Issues Encountered

- 9 Mocha test failures (ChatSessionService, ChatContextManager, AppStateManager) were initially concerning but confirmed pre-existing by running `git stash` and re-running tests — not introduced by cleanup.
- knip remaining "unused exports" (18) cannot be reduced to zero without removing intentionally public API types or breaking test file imports — documented as known false positives.

## knip Status After Cleanup

- **Unused files:** 1 (src/models/index.ts — false positive, consumed by artemis.test.ts)
- **Unused exports:** 18 (documented false positives — model class re-exports for tests, React Props API surface, service barrel exports)
- **Unused devDependencies:** Same as before (known false positives per knip.json ignoreDependencies)
- **Key improvements:** 4 unused files deleted, 4 dead identifiers unexported, section comment updated

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 20 complete — all 6 plans done
- v1.2 milestone cleanup complete (CLEAN-01, CLEAN-02, CLEAN-03 satisfied)
- Codebase has one canonical websocketUpdate message format with no backward-compat duplicates
- knip audit complete with documented false positives

---
*Phase: 20-e2e-view-coverage-interactions-accessibility-cleanup*
*Completed: 2026-02-28*
