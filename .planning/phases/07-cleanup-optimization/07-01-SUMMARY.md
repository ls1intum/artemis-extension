---
phase: 07-cleanup-optimization
plan: 01
subsystem: views
tags: [cleanup, migration, legacy-removal, react]
dependency_graph:
  requires: [03-01, 04-01, 05-01, 06-01]
  provides: [clean-react-only-codebase]
  affects: [viewRouter, artemisWebviewProvider, esbuild]
tech_stack:
  added: []
  patterns: [react-only-routing]
key_files:
  created: []
  modified:
    - iris-thaumantias/src/views/app/viewRouter.ts
    - iris-thaumantias/src/provider/artemisWebviewProvider.ts
    - iris-thaumantias/esbuild.js
  deleted:
    - iris-thaumantias/src/views/aiChecker/
    - iris-thaumantias/src/views/courseDetail/
    - iris-thaumantias/src/views/courseList/
    - iris-thaumantias/src/views/dashboard/
    - iris-thaumantias/src/views/examConduction/
    - iris-thaumantias/src/views/examExerciseDetail/
    - iris-thaumantias/src/views/examStart/
    - iris-thaumantias/src/views/exerciseDetail/
    - iris-thaumantias/src/views/gitCredentials/
    - iris-thaumantias/src/views/irisChat/
    - iris-thaumantias/src/views/login/
    - iris-thaumantias/src/views/recommendedExtensions/
    - iris-thaumantias/src/views/serviceStatus/
    - iris-thaumantias/src/views/struggleDetection/
    - iris-thaumantias/src/views/components/
    - iris-thaumantias/src/views/utils/
    - iris-thaumantias/src/views/index.ts
    - iris-thaumantias/src/views/webview/components.ts
    - iris-thaumantias/test/views/components/
    - iris-thaumantias/test/views/exerciseDataTransformer.test.ts
    - iris-thaumantias/test/views/markdownProcessor.test.ts
decisions:
  - Temporarily disabled fullscreen panel support (will be re-implemented with React in future plan)
  - Removed legacy webview-components.js bundle entirely
  - Removed CSS copy plugin since React uses CSS Modules
metrics:
  duration_minutes: 4
  tasks_completed: 2
  files_deleted: 78
  lines_removed: 21093
  completed_at: "2026-02-24"
---

# Phase 07 Plan 01: Legacy View Removal Summary

**One-liner:** Removed ~21,000 lines of dead legacy HTML generation code and coexistence router after completing React migration

## What Was Built

### Task 1: Delete legacy view/component directories and simplify ViewRouter to React-only
- **Deleted 14 legacy view directories** with their generateHtml() methods and CSS files:
  - aiChecker, courseDetail, courseList, dashboard, examConduction, examExerciseDetail, examStart, exerciseDetail, gitCredentials, irisChat, login, recommendedExtensions, serviceStatus, struggleDetection
- **Deleted 11 legacy component directories** (HTML string components):
  - askIris, backLink, badge, button, container, dropdown, helpPopup, input, listItem, serviceHealth, sideMenu
- **Deleted legacy utils** (CSS loaders and HTML utilities)
- **Deleted legacy test files** for deleted components and utils
- **Simplified ViewRouter** to always return React HTML:
  - Removed all 14 legacy view class imports and instance fields
  - Removed `_reactViews` Map (coexistence pattern no longer needed)
  - Removed constructor logic that instantiated legacy view classes
  - Simplified `getHtml()` to always call `getReactWebviewHtml()` without coexistence check
- **Updated artemisWebviewProvider**:
  - Removed legacy view imports (ExerciseDetailView, CourseDetailView)
  - Temporarily disabled fullscreen panel support (will be re-implemented with React)
- **Commit:** a89dc9a

### Task 2: Remove legacy webview bundle and CSS plugin from esbuild
- **Commented out legacy webview bundle** (webviewCtx):
  - Entry point `src/views/webview/components.ts` no longer exists
  - Bundle `dist/webview-components.js` no longer generated
- **Commented out CSS copy plugin**:
  - No longer needed since React uses CSS Modules
  - Legacy CSS files were deleted in Task 1
- **Extension now builds only 2 bundles**:
  - `dist/extension.js` (Node.js extension host)
  - `dist/webview-react.js` (React webview bundle)
- **Commit:** 4b733c3

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Updated esbuild.js to remove legacy bundle**
- **Found during:** Task 1 verification
- **Issue:** esbuild.js referenced deleted `src/views/webview/components.ts` which would cause build failure
- **Fix:** Commented out webviewCtx bundle and CSS copy plugin
- **Files modified:** iris-thaumantias/esbuild.js
- **Commit:** 4b733c3
- **Rationale:** Plan mentioned this would be handled in Plan 02, but since we deleted the file in Task 1, had to fix immediately to prevent build breakage

## Verification Results

### Automated
✅ TypeScript compilation: Pre-existing errors only (streamdown/mermaid types, unused @ts-expect-error directives)
✅ Build: Extension builds successfully with esbuild
✅ Directory structure: Only `app/` and `webview/` remain under `src/views/`
✅ No generateHtml references outside webview/react/
✅ No _reactViews references anywhere
✅ Dead code detection: knip reports false positives (doesn't understand VS Code extension architecture)

### Manual
✅ All 14 legacy view directories deleted
✅ All 11 legacy component directories deleted
✅ Legacy utils directory deleted
✅ ViewRouter simplified to React-only routing
✅ No migration TODOs except intentional fullscreen panel notes

## Key Decisions Made

1. **Fullscreen panel support temporarily disabled** — Legacy fullscreen panels used `ExerciseDetailView` and `CourseDetailView` classes which no longer exist. Will be re-implemented with React in a future plan. Currently shows warning message to users.

2. **Build configuration updated immediately** — Plan suggested updating esbuild.js in Plan 02, but had to do it in this plan to prevent build failures after deleting components.ts.

3. **CSS copy plugin removed** — No longer needed since all CSS is now bundled via CSS Modules in React components.

## Impact

### Before
- 2 webview bundles: webview-components.js (legacy) + webview-react.js (React)
- ViewRouter with coexistence pattern (_reactViews Map)
- 14 legacy view classes with generateHtml() methods
- 11 legacy HTML string component classes
- CSS copy plugin for legacy view stylesheets
- ~21,000 lines of legacy view code

### After
- 1 webview bundle: webview-react.js (React only)
- ViewRouter always returns React HTML
- 0 legacy view classes
- 0 legacy HTML string components
- No CSS copy plugin (React uses CSS Modules)
- Clean React-only codebase

### Files Changed
- **Deleted:** 78 files (~21,093 lines)
- **Modified:** 3 files (viewRouter.ts, artemisWebviewProvider.ts, esbuild.js)

### Known Limitations
- Fullscreen panels temporarily disabled (not yet implemented with React)

## Self-Check

✅ **Files exist:**
- iris-thaumantias/src/views/app/viewRouter.ts (modified)
- iris-thaumantias/src/provider/artemisWebviewProvider.ts (modified)
- iris-thaumantias/esbuild.js (modified)

✅ **Commits exist:**
- a89dc9a (Task 1: Remove legacy view classes)
- 4b733c3 (Task 2: Remove legacy webview bundle)

✅ **Deletions verified:**
- No directories under src/views/ except app/ and webview/
- No legacy component directories
- No legacy utils directory
- No src/views/index.ts barrel export
- No src/views/webview/components.ts entry point

## Self-Check: PASSED
