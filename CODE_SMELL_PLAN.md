# Code Smell Audit — Plan

## HIGH: Dead / Legacy Code

- [x] **H1** `auth/authManager.ts:9-11` — `LEGACY_SECRET_KEY = 'artemis-auth-cookie'` + `clear()` delete call. Migration window long expired.
- [x] **H2** `iris/chatSessionService.ts:279-284` — Legacy `.message` field fallback that never existed in API contract.
- [x] **H3** `api/artemisApi.ts:285` — Unused `data` variable from Bearer auth era.
- [x] **H4** `utils/constants.ts:14-24` — 6/7 unused API endpoint constants (only `AUTHENTICATE` is used).
- [x] **H5** `services/loggingService.ts` — 22 unused logger convenience methods + `LogLevel.NONE` + `configure()`, `setLogLevel()`, `setEnabledCategories()`.
- [x] **H6** `telemetry/types.ts:69-92` — `LocalStruggleContext` + `ServerStruggleContext` legacy types, zero references.
- [x] **H7** `extension.ts:17` — Unused import `getTheiaEnvironment`.
- [x] **H8** `workspace/index.ts` — `WorkspaceRegistrationCallbacks` barrel re-export removed (type kept in source for function signature).
- [x] **H9** `recording/index.ts` — `RecordingState` barrel re-export removed (type kept in source for internal use).
- [x] **H10** `replay/index.ts` — `ReplayEqSnapshot` barrel re-export removed (type kept in source for internal use).
- [x] **H11** `controller/appStateManager.ts:261` — `isLoggedIn()` public method removed.
- [x] **H12** `telemetry/interventionFilter.ts:108` — `reset()` public method removed.
- [x] **H13** Dead barrel re-exports removed: `pickBestContext`, `shouldOverrideWithWorkspace` (iris), `configureGitIdentityFromEnv`, `VSCODE_ENVIRONMENT` (theia), `ConsentLevel` (auth), `isCompilerDiagnostic`, `getErrorFamily`, `isLikelyManualPaste` (telemetry).

## HIGH: Circular Dependencies

- [ ] **C1** `serverUrl.ts` imports from `theia/index.ts` barrel — root cause of 2-3 cycles. Fix: import directly from `theia/theiaEnvironment.ts`.
- [ ] **C2** `utils/index.ts` star-exports everything incl. `serverUrl` — amplifies C1.
- [ ] **C3** `theia/index.ts` re-exports auth+workspace deps — amplifies C1.
- [ ] **C4** `fullscreenPanelManager` in `services/ui/` depends on `controller/webViewMessageHandler` — crosses layer boundary.

## HIGH: Type Safety Holes

- [ ] **T1** `domainMappers.ts:16` — `course.id!` on optional field, lies to compiler.
- [ ] **T2** `exerciseDataLoader.ts:61`, `navigationCommands.ts:139,306` — `as CourseDashboardCourse` without null-check (3 sites).
- [ ] **T3** `webviewCommands.ts:291` — `getPayload` self-referential return type collapses to `any`.
- [ ] **T4** `appStateManager.ts:248` — `{} as StudentExam` empty object cast.

## MEDIUM: Legacy Fallbacks (verify before removing)

- [ ] **M1** `api/artemisApi.ts:441-463` — Uncommitted files retry fallback ("server might not support feature yet").
- [ ] **M2** `api/artemisApi.ts:320-325` — Dual Iris profile detection (`activeProfiles` fallback).
- [ ] **M3** `iris/chatMessageService.ts:188-189` — Misleading "backward compatibility" comment.

## MEDIUM: Architectural Smells

- [ ] **A1** `telemetryManager.ts:462-476` + `interventionDecisionEngine.ts:102-113` — Duplicated EQ thresholds (0.15/0.35/0.60).
- [ ] **A2** ExerciseRegistry called from 5 sites — no single authoritative registration path.
- [ ] **A3** `exerciseRegistry.ts:35` — `registerFromCourseData(unknown)` accepts unknown, immediately casts.
- [ ] **A4** `telemetryManager.ts:480-675` — ~200 lines debug UI presentation in service orchestrator.
- [ ] **A5** `artemisWebsocketService.ts` — 891 lines, mixed responsibilities.
- [ ] **A6** `artemisApi.ts:21` — `onAuthExpired` setter pattern, inconsistent with EventEmitter pattern.
- [ ] **A7** `irisWebSocketSessionClient.ts:185` — `as IrisWebSocketMessage` without validation.
- [ ] **A8** `appStateManager.ts:66` — `onStateChange` single-callback setter, inconsistent with EventEmitter.

## MEDIUM: Silent Error Handling

- [ ] **E1** `artemisWebsocketService.ts:838,515` — Errors go to `_log()` only, invisible in output channel.
- [ ] **E2** `workspaceDetectionService.ts:445` — Outer catch swallows everything silently.

## LOW: Cleanup

- [ ] **L1** `telemetryManager.ts:256` — `endExerciseSession()` public but only self-called, should be private.
- [ ] **L2** `chatContextManager.ts:132-174` — "kept for call-site compatibility" wrappers — rename or inline.
- [ ] **L3** `authFlowHandler.ts:95-97` — `_getServerUrl()` trivial one-liner wrapper.
- [ ] **L4** `CourseDetailView.tsx:228` — Commented-out exams section with stale TODO.
- [ ] **L5** `websocketMessageHandler.ts:66` — Stale TODO: "Show status indicator in UI".
- [ ] **L6** `messageUtils.ts:3-16` — `extractIrisMessageContent` handles impossible formats (string, JSON fallback).
- [ ] **L7** `contextStore.ts:162-173` — `migrateState()` for version bump that never happened.
- [ ] **L8** `submissions.ts:8-10` — 3 unused `ProgrammingSubmissionState` enum values.
- [ ] **L9** Duplicate `@types` packages: `@types/dompurify`, `@types/katex`, `@types/marked`.
- [ ] **L10** `.vscodeignore` references non-existent `.editorconfig`.
- [ ] **L11** `utils/aiExtensionsBlocklist.ts:5,11,16` — `AiExtensionInfo`, `AiProvider`, `AiExtensionsBlocklist` only used in same file.
