---
phase: 12-typescript-strict-mode
plan: 04
subsystem: type-safety
tags: [typescript, extension-host, type-exports, legacy-commands, message-contracts]
dependency_graph:
  requires: [12-03-SUMMARY]
  provides: [extension-host-type-exports, typed-legacy-commands]
  affects: [apiResponses, messageContracts, appStateManager, extension-commands]
tech_stack:
  added: []
  patterns: [legacy-command-message-typing, discriminated-union-extension]
key_files:
  created: []
  modified:
    - iris-thaumantias/src/types/apiResponses.ts
    - iris-thaumantias/src/shared/messageContracts.ts
    - iris-thaumantias/src/views/app/appStateManager.ts
    - iris-thaumantias/src/views/app/commands/types.ts
    - iris-thaumantias/src/views/app/commands/webViewMessageHandler.ts
    - iris-thaumantias/src/views/app/commands/repositoryCommands.ts
    - iris-thaumantias/src/views/app/commands/navigationCommands.ts
decisions:
  - context: Legacy command message typing strategy
    decision: Option A - Create typed per-command interfaces for all 13 unique legacy commands
    rationale: 13 unique command shapes < 15 threshold specified in plan. Individual typing provides better type safety than LegacyCommandMessage escape hatch
    alternatives: [Option B - Single LegacyCommandMessage with command:string and index signature]
    impact: All legacy command messages now have proper TypeScript interfaces in ExtensionToWebviewMessage union
  - context: ArchivedCourse type mapping
    decision: Map CourseDashboardCourse to ArchivedCourse subset in loadArchivedCourses
    rationale: API returns CourseDashboardCourse[] but appStateManager expects ArchivedCourse[] (subset with only id, title, semester, color)
    alternatives: [Change _archivedCoursesData type to CourseDashboardCourse[], Create type alias]
    impact: Proper type safety without modifying API return types
  - context: ExerciseDetail to ExerciseSource conversion
    decision: Explicit field mapping instead of type casting
    rationale: ExerciseSource requires non-optional id and title fields, type predicate alone insufficient
    alternatives: [Type assertion with !, Keep any cast, Add id!: number to ExerciseDetail]
    impact: Type-safe exercise flattening with proper field extraction
metrics:
  duration_minutes: 12
  tasks_completed: 2
  files_modified: 7
  type_exports_added: 3
  legacy_command_interfaces_added: 9
  ts2305_errors_fixed: 3
  ts2307_errors_fixed: 2
  ts2353_errors_fixed: 21
  remaining_typescript_errors: 67
---

# Phase 12 Plan 04: Fix extension host TypeScript compilation errors Summary

## One-liner

Added missing type exports (ArtemisUser, ArchivedCourse, CourseDetailData) and typed 13 legacy command messages (Option A approach), eliminating 26 extension host compilation errors while preserving runtime message format compatibility.

## What Was Done

### Task 1: Create missing type exports and fix broken imports

**Objective:** Add missing type exports to apiResponses.ts and fix broken module import paths.

**Implementation:**

1. **Added missing type exports to apiResponses.ts (fixes 3 TS2305 errors):**
   - `ArtemisUser`: User authentication information with id, login, firstName, lastName, email, activated, langKey, authorities fields. Matches ArtemisUser class shape from models/core.ts
   - `ArchivedCourse`: Archived course subset with id (required), title, semester, color. Used by appStateManager for archived course list
   - `CourseDetailData`: Full course detail structure with course (CourseDashboardCourse + exercises, exams, isArchived flag). Used by appStateManager and types.ts
   - All include `[key: string]: unknown` index signature for API extensibility

2. **Fixed broken module imports (fixes 2 TS2307 errors):**
   - `src/views/app/commands/types.ts` line 8: Updated BuildErrorCodeLensProvider import path from `../../../codeErrorCodeLensProvider` to `../../../provider/buildErrorCodeLensProvider`
   - `src/views/app/webViewMessageHandler.ts` line 10: Same import path correction
   - Actual file location: `src/provider/buildErrorCodeLensProvider.ts`

3. **Fixed appStateManager type issues (fixes 1 TS2345, 1 TS2322):**
   - Line 185: Removed invalid `_currentExerciseData?.id` property access (ExerciseDetailsResponse doesn't have direct id field, only exercise.id)
   - Line 216: Added explicit mapping from `CourseDashboardCourse[]` to `ArchivedCourse[]` in loadArchivedCourses method
   - Mapping extracts subset: `{ id: course.id!, title: course.title || '', semester, color }`

**Outcome:** Zero TS2305 and TS2307 errors. appStateManager compiles without type mismatches.

**Commit:** 04ae675

### Task 2: Migrate legacy command format to typed message contracts

**Objective:** Add typed interfaces for legacy command messages that use `command:` field instead of `type:` field.

**Context:** Extension host commands send messages using `{ command: 'foo', ...data }` legacy format. The typed ExtensionToWebviewMessage union uses `type:` field for modern messages, causing 21 TS2353 errors. Webview React code checks `message.command` (not `message.type`), confirming legacy format is the runtime reality.

**Decision Rule Applied:**
- Counted unique command shapes: 13 unique commands
- Threshold: < 15 → Option A (typed per-command interfaces)
- Chosen: **Option A** for better type safety

**Implementation:**

1. **Added 9 legacy command message interfaces to messageContracts.ts:**
   - `BuildLogParsedMessage`: Build log first error with participationId, resultId
   - `GitIdentityInfoMessage`: Git name/email response
   - `PlantUmlRenderedMessage`: Rendered SVG with index
   - `PlantUmlErrorMessage`: Rendering error with index
   - `ShowClonedRepoNoticeMessage`: Repository cloned notification
   - `SubmissionResultMessage`: Submission success/error result
   - `TestResultsDataMessage`: Test case results array
   - `UpdateDirtyPagesStatusMessage`: Unsaved file status (hasDirtyPages, dirtyFileCount, autoSaveEnabled)
   - `UpdateRepoStatusMessage`: Git connection status (isConnected, hasChanges, isGradedRepo)

   Note: 4 commands already had typed interfaces but were unused at runtime (`healthCheckResults`, `gitCredentialsResult`, `loginError`, `workspaceExerciseDetected`). Runtime code sends legacy `command:` field format.

2. **Added legacy command interfaces to ExtensionToWebviewMessage union:**
   - Extended discriminated union to include both `type:` and `command:` discriminators
   - Updated doc comment: "Discriminated by 'type' or 'command' property"

3. **Fixed GitCredentialsResultMessage status type (fixes 2 TS2322):**
   - Extended status union: `'success' | 'error' | 'warning'` → `'success' | 'error' | 'warning' | 'info'`
   - Used by repositoryCommands.ts lines 649, 704 for informational notifications

4. **Fixed ExerciseDetail to ExerciseSource mapping (fixes 1 TS2345):**
   - repositoryCommands.ts line 92: ExerciseDetail has optional `id?: number`, ExerciseSource requires `id: number`
   - Replaced type predicate with explicit field mapping:
     ```typescript
     exercises.push({
         id: ex.id,  // TypeScript narrows to number after typeof check
         title: ex.title,
         shortName: ex.shortName,
         courseId: ex.course?.id,
         repositoryUri: undefined,
         studentParticipations: ex.studentParticipations
     });
     ```

5. **Fixed navigationCommands.ts examData type narrowing (fixes 2 TS2345):**
   - Lines 497, 500: `courseId` and `examId` extracted from `examData: StudentExam | undefined` but StudentExam doesn't have these fields (they're added as context by showExamConduction)
   - Added explicit type narrowing:
     ```typescript
     const courseId = (examData as any).courseId;
     const examId = (examData as any).examId;
     if (typeof courseId !== 'number' || typeof examId !== 'number') return;
     ```

**Outcome:** Zero TS2353 errors. All legacy command messages have typed contracts in ExtensionToWebviewMessage union. Extension host commands compile without errors.

**Commit:** 923f1b7

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written.

## Verification Results

### Automated Verification

**Target errors eliminated:**
```bash
npx tsc --noEmit 2>&1 | grep -c "TS2305\|TS2307\|TS2353"
# Output: 0 ✅
```

**Remaining errors (webview/provider scope):**
```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
# Output: 67 (down from ~85 at plan start)
```

**Strict mode verification:**
```bash
grep '"strict": true' tsconfig.json
# Output: "strict": true ✅
```

### Success Criteria

- [✅] Zero TS2305 (missing export) and TS2307 (broken module) errors
- [✅] Zero TS2353 (legacy command format) errors — all legacy commands have typed contracts
- [✅] No new @ts-ignore or @ts-expect-error comments added
- [✅] Decision documented: Option A chosen for legacy commands (13 commands < 15 threshold)
- [✅] Remaining 67 errors are webview/provider scope (addressed by Plan 12-08)

## Impact Assessment

**Positive:**
- ✅ Extension host command layer fully typed — zero TS2305/TS2307/TS2353 errors
- ✅ 9 legacy command message interfaces provide type safety at runtime message boundaries
- ✅ ArtemisUser, ArchivedCourse, CourseDetailData exports enable proper typing across extension host
- ✅ Import path corrections unblock BuildErrorCodeLensProvider usage
- ✅ ExerciseDetail to ExerciseSource mapping preserves type safety without data loss

**Breaking Changes:**
None. All changes preserve runtime behavior while adding type safety.

**Technical Debt:**
- 📋 Dual message format (type: vs command:) remains — legacy `command:` format used at runtime, modern `type:` format defined but unused
- 📋 examData type mismatch (StudentExam vs StudentExam + context fields) requires any cast
- 📋 67 remaining TypeScript errors in webview/provider layer (addressed by Plan 12-08)

## Lessons Learned

1. **Runtime vs contract mismatch:** Typed contracts (type: field) didn't match runtime behavior (command: field). Always verify actual message handling code when adding types to existing systems.

2. **Option A threshold justified:** 13 unique commands < 15 threshold made individual interfaces feasible. Provides better autocomplete and refactoring support than escape hatch approach.

3. **Optional to required type mapping:** ExerciseDetail.id (optional) to ExerciseSource.id (required) requires explicit field extraction with runtime checks, not just type predicates.

4. **Index signatures hide errors:** `[key: string]: unknown` allows accessing non-existent properties (e.g., `_currentExerciseData?.id`) — TypeScript infers `unknown` instead of error. Explicit property access safer.

5. **Context field pattern:** showExamConduction/showExamStart accept any and add context fields (courseId, examId) beyond StudentExam interface. This pattern breaks type safety — consider explicit context wrapper types.

## Next Steps

**Immediate:**
1. ✅ Complete Phase 12-04 SUMMARY creation
2. ✅ Update STATE.md with progress and decisions
3. ✅ Update ROADMAP.md via `roadmap update-plan-progress`

**Follow-up Plans:**
1. **Phase 12-08:** Fix remaining 67 webview/provider TypeScript errors
2. **Legacy message format cleanup:** Migrate from `command:` field to `type:` field for consistency (requires webview React changes)
3. **examData type safety:** Define explicit ExamContext interface instead of StudentExam + any cast
4. **Message format consolidation:** Remove dual format (type: vs command:) by standardizing on discriminated union approach

## Files Modified

**Type exports:**
- types/apiResponses.ts: Added ArtemisUser, ArchivedCourse, CourseDetailData interfaces (3 new exports)

**Message contracts:**
- shared/messageContracts.ts: Added 9 legacy command interfaces, added to ExtensionToWebviewMessage union, extended GitCredentialsResultMessage status type

**Extension host fixes:**
- views/app/appStateManager.ts: Fixed exerciseId access, added ArchivedCourse mapping
- views/app/commands/types.ts: Fixed BuildErrorCodeLensProvider import path
- views/app/webViewMessageHandler.ts: Fixed BuildErrorCodeLensProvider import path
- views/app/commands/repositoryCommands.ts: Fixed ExerciseDetail to ExerciseSource mapping
- views/app/commands/navigationCommands.ts: Added examData type narrowing

**Total:** 7 files modified, 2 commits (04ae675, 923f1b7)

## Self-Check: PASSED

All files verified:
- ✅ iris-thaumantias/src/types/apiResponses.ts
- ✅ iris-thaumantias/src/shared/messageContracts.ts
- ✅ iris-thaumantias/src/views/app/appStateManager.ts
- ✅ iris-thaumantias/src/views/app/commands/types.ts
- ✅ iris-thaumantias/src/views/app/webViewMessageHandler.ts
- ✅ iris-thaumantias/src/views/app/commands/repositoryCommands.ts
- ✅ iris-thaumantias/src/views/app/commands/navigationCommands.ts

All commits verified:
- ✅ 04ae675 (Task 1: Add missing type exports and fix broken imports)
- ✅ 923f1b7 (Task 2: Add typed legacy command message interfaces)
