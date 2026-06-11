# Change Log

All notable changes to the Artemis VS Code extension will be documented in this file.

## [Unreleased]

### Added

- **Reading Telemetry**: The session recorder now captures problem-statement reading behavior (scrolling and text selections, with extended consent only).
- **Sticky Build Status**: Build progress and ETA stay visible in a slim strip at the top of the exercise view while you scroll; the result flashes briefly when the build finishes out of view.

### Fixed

- **Replay Fidelity**: Live and recording paths share one build-error-family builder, so replayed EQ matches the live curve.
- **Intervention Block Reasons**: Withheld interventions record the real gate; `recent-progress`/`last-dismissed` no longer logged as `warmup`.
- **Test Results With Hidden Names**: The "See test results" overview now lists results for exercises that hide test names from students (`showTestNamesToStudents` disabled), instead of showing "No test results available".
- **Submission Git Locks**: Submitting is now guarded against a double-click, and a busy or stale Git index lock surfaces an actionable message instead of raw git output or a misleading "No local changes detected".

### Internal

- **Struggle-Detection Config**: Wired `MIN_EVENTS_PER_SESSION` and the paste threshold; removed dead config.
- **Live Recording Viewer**: The Event Breakdown counts, event total, and session duration now update live alongside the timeline instead of freezing at the values from when the live session was opened.
- **Live Recording Viewer**: Live mode can now be served from the production build (`npm run preview:live:token`), which eliminates a browser-tab out-of-memory crash that could occur during long or high-volume live sessions on the dev server.
- **Recorder Test Coverage**: Extended the session-recorder end-to-end and wiring tests to exercise every persistable event type (Iris chat, EQ, interventions, navigation and panel visibility, test-results and task-feedback views, submissions, and file/editor/terminal/debug events) through the full record-to-JSONL-to-parser pipeline, plus the wiring's event forwarding and startup contributors.

## [0.4.5] - 2026-06-01

### Added

- **Debugger Recording**: The session recorder now captures debug session lifecycle and in-exercise breakpoint changes, visible in the recording timeline and live viewer.
- **Submission Recording**: The session recorder now captures explicit submit actions (started, succeeded, or failed with a reason), visible in the recording timeline and live viewer and correlatable with the build result.
- **Test Results & Task Feedback Tracking**: New test-results overview and per-task feedback modal, with differentiated empty states for tasks without feedback.
- **Problem Statement Rendering**: Server-side rendered problem statements via the Artemis API, reloaded live on new build results.
- **Recording Viewer Enhancements**: Distinct per-event colors, configuration/test/task view event rendering, "Iris Moment" and "Reading test results" context markers, and a live elapsed timer.

### Changed

- **Open VSX Build**: The Open VSX distribution (used by EduIDE) now physically excludes the session recorder and the data-collection consent flow; only the local struggle-detection (Error Quotient) logic remains. The VS Marketplace build is unchanged and still gates recording behind extended consent.
- **Theia / EduIDE**: The extension no longer performs repository auto-clone or git-identity setup; the companion Scorpio extension now handles these in EduIDE. User-initiated cloning from the exercise view is unchanged.
- **Iris Chat**: Updated to the unified Iris API in Artemis 9.2+ so chat keeps working after the upstream session-endpoint consolidation.
- **Exercise "More options" Dropdown**: Grouped entries into Workspace, Share, and External sections with icons, and merged the two "Copy Clone URL" entries into a single split-button.
- **Iris Context Dropdown**: Conversations sort newest-first, the dropdown panel now spans exactly down to the chat input (no input controls peek through), scroll shadows appear when lists overflow, and exercise rows align consistently whether or not a course tag is shown.
- **Webview Icon Consistency**: Replaced ~25 hand-rolled inline SVG icons across the chat, exam, and shared components with their Lucide equivalents for visual consistency and to prevent future malformed-path bugs.
- **Live Recording Viewer**: Faster live view (no more lag on long sessions), undo/redo for markers via Cmd/Ctrl+Z, and live sessions appear in the list immediately.

### Fixed

- **Iris Chat Connectivity Resilience**: Network drops and server errors now show a "temporarily unavailable" banner with a Retry button instead of the misleading "instructor disabled Iris" overlay, and the chat reloads automatically when the WebSocket reconnects.
- **Iris Chat New Conversation**: Fixed "New Conversation" silently jumping back to the workspace exercise instead of starting a new session in the currently selected context.
- **Iris Chat Feedback Icons**: Fixed the broken thumbs-down icon on assistant messages (previously rendered as a filled blob when selected).
- **Recorder Gate**: The Record button now reads from the workspace-detected exercise instead of the Iris chat selection. Clicking Record before opening Iris no longer shows the misleading "Select an exercise context" warning.
- **WebSocket Status Bar**: No longer shows a misleading red "WS Disconnected" indicator while logged out (unless `artemis.showWebSocketStatusBar` is explicitly enabled).

### Removed

- **Exam Mode**: Removed entirely.

### Internal

- **Release Pipeline**: Idempotent GitHub Release, validated single-sourced changelog notes, Marketplace post-publish existence check, and a single release-branch selector.
- **Architecture**: Decomposed the WebSocket service, webview provider, and session recorder into smaller cohesive units.
- **TypeScript**: Enabled stricter flags (`noUnused*`, `noImplicitReturns`, `noFallthrough`).
- **Runtime Validation**: Added schema validation at the API, Iris WebSocket, and replay-parse boundaries.
- **Imports**: Introduced `@`-path import aliases and consistent import ordering.
- **Cleanup**: Removed dead code and no-op indirection layers.

## [0.4.4] - 2026-05-10

### Changed

- Internal release pipeline: GitHub Actions workflow now publishes to both Open VSX Registry and VS Code Marketplace in parallel via a single `workflow_dispatch` run with manual approval gating. No user-facing changes.

## [0.4.3] - 2026-05-10

### Added

- **Theia Environment Diagnostic Command**: New `Artemis: Show Theia Environment (Diagnostic)` command that surfaces detection signals (`uiKind`, `DATA_BRIDGE_ENABLED`, `THEIA`) and the snapshot of managed env vars (`ARTEMIS_URL`, `ARTEMIS_TOKEN`, `GIT_URI`, `GIT_USER`, `GIT_MAIL`). Token is masked, `GIT_URI` reduced to host+path so embedded credentials never leak. Used to diagnose Theia auto-clone failures.

### Changed

- **Iris Context Dropdown**: Redesigned the chat context picker as a full-height panel with equal-height lists for Conversations, Exercises, and Courses, top-level workspace shortcuts, and a bugfix that preserves the workspace flag against bulk context re-registration.

### Fixed

- **Cold-start Welcome Flash**: Eliminated the brief "Hi! I'm Iris" welcome state that flashed before message hydration completed on chat cold-start. Replaced the skeleton placeholder with a centered Iris logo + spinner so the loading state is visible across the whole panel instead of just the input row.

## [0.4.1] - 2026-04-26
### Added

- **Session Titles**: Iris chat sessions display LLM-generated titles from Artemis in the session list and chat header.
- **Theia/EduIDE Compatibility**: Full support for running the extension in browser-based Theia environments (e.g., Artemis EduIDE), including Bearer token authentication, environment-based auto-login, DataBridge for late-arriving credentials, and automatic repository cloning.
- **Session Analyzer**: Session recording system that captures coding activity (text changes, cursor/scroll movements, build results) with continuous EQ score tracking, replay engine, and a standalone viewer app for analyzing recorded sessions.
- **Configurable Start Page**: New `artemis.startPage` setting to choose which page opens after login: Dashboard (default), Course List, or automatically open the course/exercise detected in the current workspace.
- **Workspace Exercise Detection Prompt**: When an exercise is detected in the workspace, a notification offers to set it as the default start page with a single click. The setting can be changed later in VS Code Settings.
- **Server URL Dropdown**: Predefined Artemis server URLs in the login dropdown with collapsible exercise header.
- **Iris Stage Display**: Shows the current Iris processing stage (e.g., thinking, fetching context) in the chat via WebSocket STATUS messages.

### Changed

- **Internal Architecture Refactoring**: Major restructuring of the extension codebase including runtime-oriented folder layout, domain consolidation, service extraction, and dependency injection cleanup.
- **Dead Code Removal**: Removed ~2,300 lines of unused code, components, and legacy methods.

### Fixed

- **Dashboard "Recent Courses"**: Shows the 3 most recently accessed courses with exercises sorted by latest published. Exercises without dates are no longer hidden. Resolves #103.
- **Back-to-Course Navigation**: Fixed "Course data is not available" error when returning from an exercise view to its course. The exercise payload now carries its parent course so back-navigation can restore it.
- **API Endpoint Alignment**: Aligned API endpoints with the Artemis webapp, including correct feedback and exam endpoints.
- **Build Error CodeLens**: Fixed duplicate CodeLens errors, missing testCase field in WebSocket feedback, and wired up build log viewing with go-to-source navigation.
- **WebSocket Feedback Mapping**: Fixed missing testCase field, buildFailed propagation, and hasTestInfo derivation in WebSocket submission handling.
- **Dashboard Reload**: Dashboard reload now re-runs archived course check for workspace exercise detection.

## [0.4.0] - 2026-03-13
### Added

- **React Webview Migration**: Complete rewrite of all webview UIs from vanilla HTML/JS to React with Zustand and CSS Modules.
- **`.noai` File Detection**: Automatically detects `.noai` files in the workspace or git repository root and disables Iris AI assistance when found.
- **Struggle Detection**: Real-time monitoring system that tracks student coding activity to detect when they're experiencing difficulties. The system analyzes error patterns, inactivity periods, and build failures to identify struggle signals, enabling proactive assistance through Iris. Includes a developer debug panel for monitoring detection metrics in real-time.
- **Struggle Detection Testing Framework**: Comprehensive test suite for validating struggle detection algorithms using simulated scenarios. Features scenario-based testing with timeline-based events.
- **WebSocket Debug StatusBar**: New optional debug tool (enable via `artemis.developerMode` setting) showing real-time connection status with subscription count, detailed hover info, and quick actions menu.

### Changed

- **Dashboard Tools & Settings**: Renamed "Quick Actions" section to "Tools & Settings". Now shows only 6 buttons initially with additional options (Git Credentials, Bug Report) available via "Show more" toggle for a cleaner dashboard layout.
- **Developer Mode**: All developer/debug settings are now consolidated under the single `artemis.developerMode` setting.

### Fixed

- **User-Agent Tracking**: Ensured User-Agent header ('VS Code Extension') is consistently set on all API and WebSocket requests.
- **CRITICAL: WebSocket Connection Flooding Prevention**: Fixed critical bug that could cause up to 120,000 connections. Added comprehensive safety features including rate limiting (min 2s between attempts), max attempts (20), connection mutex, and callback cleanup. Added 22 new safety tests.
- **Course List Navigation**: Clicking a course in the "All Courses" view now opens the correct course details.
- **Iris Availability Check**: Added global server profile check before checking course-level Iris settings, matching the Artemis webapp behavior.
- **Memory Leaks and Error Handling**: Fixed connection state callback leaks, added error handlers for async operations, and improved resource disposal in WebSocket services.
- **ExerciseRegistry**: Now clears stale exercises per-course when fresh data is registered
- **AuthManager**: 401 responses now properly clear cached auth and prompt re-login

## [0.3.1] - 2025-12-19

### Added

- **Bug Report Button**: New dashboard button to quickly report bugs and issues on GitHub.

### Changed

- **Architecture Refactoring**: Major internal refactoring to improve code maintainability

## [0.3.0] - 2025-11-30

### Added

- **Exam Mode**: Full support for participating in Artemis exams directly from VS Code, including exam start, conduction, and exercise detail views with real-time timer display and status updates.
- **Iris Disabled Banner**: When Iris chat is not enabled for a course or exercise, an inline banner is shown in the input area instead of blocking the entire UI.
- **ContainerComponent**: New reusable UI component for consistent container styling with collapsible sections across all views.
- **Reload Button**: Added reload functionality across views to refresh data from the Artemis server
  - Dashboard: Reload button in "Recent Courses" header to refresh course list
  - Course Detail: Reload button in navigation bar to refresh course and exercise data
  - Exercise Detail: Reload button in navigation bar to refresh exercise, results, and build logs

### Changed

- **View Refactoring**: Major refactoring of all views (CourseDetail, CourseList, Dashboard, etc.) to use the new ContainerComponent for improved maintainability and consistent styling.

## [0.2.6] - 2025-11-21

### Added

- **Practice Mode**: Added support for starting practice runs on programming exercises after the due date, including automatic repository detection and safety warnings.

### Fixed

- **Recently Cloned Notice**: Fixed an issue where the "Recently cloned" notice would persist even after the repository was successfully opened.

## [0.2.5] - 2025-11-07

### Added

- **Build Error Navigation**: Automatic navigation to build errors when submissions fail
  - "Go to source →" button appears when build fails, jumps directly to error location
  - CodeLens displays error message above the problematic line in your code
- **Default Clone Path Setting**: Configure a default folder for automatically cloning all exercise repositories without prompting each time
- **Live Referenced Files Display**: Iris chat now shows real-time file status information
  - **Live updates**: File list updates automatically as you type, save, commit, or stage changes
  - Shows "x/y files referenced" where x/y = changed files detected by Git
  - Click to expand and see list of changed file paths with VS Code-style icons
  - **On message send**: Full analysis runs showing included/excluded files with reasons
  - Updates every 5 seconds, on save, on document change, and on Git state changes
  - Provides full transparency about what context Iris has access to in real-time

### Changed

- **Component Refactoring**: Unified UI components (ListItemComponent, BadgeComponent, ButtonComponent, TextInputComponent) across all views for consistent styling, keyboard navigation, and accessibility, removing ~200+ lines of duplicate CSS
- **Unified File Checking**: Consolidated all file checking logic into single `checkWorkspaceFiles()` method
  - Single source of truth for git status, file filtering, and content reading
  - Configurable options for different use cases (live monitoring vs. message sending)
  - Eliminates code duplication across extension
  - Maintains performance with optional content reading and filtering
- **Code Cleanup**: Removed unused cache fields and implementations for better maintainability
- **Authentication Flow Cleanup**: Centralized server URL helpers so login loading indicators and status messages reuse the same logic instead of copy-pasted blocks

## [0.2.4] - 2025-11-05

### Changed

- **Iris Chat Disclaimer**: Updated disclaimer text to accurately reflect that Iris has access to uncommitted changes
  - Changed from "Iris only has access to your submitted code" to "Iris has access to your uncommitted changes"
  - Added clickable settings link for quick access to privacy configuration
  - Users can now easily toggle the uncommitted changes feature directly from the chat interface

## [0.2.3] - 2025-11-05

### Added

- **Uncommitted Files Integration**: Iris now receives ALL local changes automatically! 🚀
  - Iris can now see your complete local code state, not just pushed code
  - Automatically collects dirty (unsaved) files
  - Automatically collects Git modified files (uncommitted changes)
  - **NEW**: Automatically collects committed but unpushed files from local commits
  - "Dirty" now means everything not pushed yet (uncommitted OR committed but unpushed)
  - Intelligent filtering excludes binaries, node_modules, and other unnecessary files
  - Maximum file size limit (1 MB) to prevent sending overly large files
  - Full backward compatibility - works with older Artemis servers too
  - New utility function `collectUncommittedFiles()` for gathering all local changes
  - Enhanced `sendChatMessage` API to accept uncommitted files as optional parameter
  - Detailed logging of which files are sent to Iris for transparency

## [0.2.2] - 2025-10-25

### Fixed

- **Repository URL**: Fixed the repository URL in package.json to point to the correct GitHub repository for proper resource linking

## [0.2.1] - 2025-10-25

### Added

- **Markdown Table Rendering**: Problem statements now properly render markdown tables with full styling support
  - Responsive table design that scales down on smaller screens
  - Theme-aware styling for VSCode, Modern, and Synthwave themes
  - Automatic text wrapping and font size adjustment for readability
  - Support for text alignment (left, center, right) via markdown table syntax
- **Workspace Context Switcher**: Added a "Switch to Workspace" button in the Iris chat dropdown to quickly switch to the workspace exercise context
  - Button is disabled when no workspace exercise is detected
  - Uses shield icon for visual consistency with workspace exercise indicators
  - Automatically switches context to the detected workspace exercise with a single click

### Fixed

- **Ask Iris Button Context**: Fixed the "Ask Iris" button to correctly set the workspace exercise context when invoked from a workspace folder
- **Context Switching Flash**: Fixed issue where old chat messages briefly appeared when switching between exercise/course contexts
  - Messages are now cleared immediately when context changes to prevent visual flash
  - Improved synchronization between context switching and message loading
- **README Images**: Updated README screenshot URLs to use absolute GitHub URLs for proper display in VS Code Marketplace

## [0.2.0] - 2025-10-23

### Added

#### Iris AI Chat Integration 🤖

- **Iris Chat is now live!** The AI-powered virtual tutor from Artemis is fully integrated into VS Code
- Chat with Iris about your exercises and courses with context-aware assistance
- Real-time message streaming via WebSocket for instant responses
- Multi-session support - create and switch between different conversation threads
- Smart context detection automatically selects your currently open exercise
- Session management with sync to Artemis server
- Full markdown support in chat messages including code blocks
- AI disclaimer banner reminding users about Iris limitations and submitted code access

## [0.1.4] - 2025-10-18

### Changed

- **Exercise Detail Participate Button**: Renamed action to "Start Exercise" to better reflect the flow for initiating work
- **Iris Chat Menu Consolidation**: Merged "Clear History" and "Reset Sessions" into a single "Reset & Sync Sessions" button that clears local data and reloads from the Artemis server
- **Iris Session Storage**: Chat sessions and messages are no longer persisted to local storage - they are fetched fresh from Artemis on each extension load for data privacy and consistency

### Fixed

- **Test Results Loading Freeze**: Added 15-second timeout to prevent infinite "Loading test results..." state when API requests hang or fail, includes retry button
- **Latest Result Selection**: Fixed result selection logic to use `completionDate` instead of ID when determining the latest test result. This ensures that when multiple builds complete out of order (e.g., due to varying build times), the most recently completed result is always displayed, matching Artemis web client behavior

## [0.1.3] - 2025-10-17

### Added

- **Styling Infrastructure**: Introduced a `StyleManager` and dedicated `media/styles` assets so webviews share base, view, component, and theme styles without inline duplication.
- **Git Credentials Helper**: New view to configure Git identity (user.name/email) for Artemis submissions with copyable commands and theme-aware styling
- **Automated Git Identity Flow**: When submitting without configured Git identity, users are now automatically directed to the Git Credentials Helper with a clear explanation

### Changed

- **Theme Handling**: Consolidated theme tokens into reusable CSS files and expanded the token set (`--theme-*`) to support richer differentiation (hover, muted, accent, outline) across all themes.
- **Webview Templates**: Moved inline CSS out of TypeScript templates; each view now loads external CSS resources, simplifying maintenance and unlocking user-defined theme overrides.
- **AI Checker Status**: Simplified extension status detection to show only installed vs. not installed for clearer results

### Improved

- **Recommended Extensions View**: Added installed status badges and version display to mirror the AI Checker experience
- **Exercise Details UI**: Points badge now uses theme accent color for better consistency; repository status icon only shows when there's an issue (disconnected state)

### Fixed

- **PlantUML Diagram Scaling**: Fixed SVG diagrams squeezing in fullscreen view - diagrams now resize properly while maintaining aspect ratio
- **Course Detail & Exercise Detail Styling**: Fixed missing CSS content that caused incorrect rendering after styling refactor

### Removed

- **Checkstyle Recommendation**: Dropped the Checkstyle extension from the Java toolkit suggestions

## [0.1.2] - 2025-10-15

### Improved

- **Non-Programming Exercise UX**: Non-programming exercises (quiz, modeling, text, file-upload) now display appropriate UI without repository/clone buttons. Shows exercise type and directs users to complete in Artemis browser

### Fixed

- **PlantUML Diagram Scaling**: Fixed SVG diagrams squeezing in fullscreen view - diagrams now resize properly while maintaining aspect ratio

## [0.1.1] - 2025-10-15

### Added

- **Iris Chat Coming Soon Banner**: Added full-screen overlay in Iris chat view to inform users the feature is under development
- **Workspace Exercise Quick Access**: Dashboard now shows a button to jump directly to the exercise detail view of the currently open workspace exercise with full navigation context

### Improved

- **Workspace Exercise Button Styling**: Styled workspace exercise button to match recent courses list items for visual consistency across all themes
- **AI Checker Layout**: Fixed header and filters to always appear at the top instead of being vertically centered when few extensions are present

### Fixed

- **Course Navigation**: Fixed "Back to Course" button when opening exercises from workspace - now properly sets parent course context

## [0.1.0] - 2025-10-14

### Added

- **Recently Cloned Repository Notice**: Persistent notification in exercise detail view to open recently cloned repositories (10-minute timeout, max 10 entries)
- **Pull Changes Feature**: Added "Pull Changes" option to exercise detail "more menu" for manually syncing with remote repository
- **Unsaved Changes Detection**: Info banner appears when typing with unsaved files, reminding users to save before submitting. Links to auto-save settings. Can be disabled via `artemis.showUnsavedChangesWarning`
- **Reload Courses Button**: Added reload button next to search bar in course list view to fetch fresh course data from Artemis

### Changed

- **VS Code Compatibility**: Updated minimum required VS Code version to 1.97.0 (January 2025) for broader compatibility

### Improved

- **Exercise Participation**: Removed confirmation dialog when participating in exercises for faster workflow
- **Submission Flow**: Automatic `git pull --rebase` before push to handle remote changes (e.g., test results from Artemis)
- **Recommended Extensions**: Replaced "Lombok Annotations Support" with "#region folding for VS Code" for better universal code organization across all languages
- **Iris Assistant Labels**: More specific context labels ("Ask Iris about this exercise" / "Ask Iris about this course") for clearer user guidance
- **Open in Browser**: Clarified more-menu and dashboard labels from "Open Artemis" to "Open in browser"
- **Sticky Navigation**: Back button and fullscreen button stay at top when scrolling across all views (exercise detail, course detail, course list, recommended extensions, AI checker, service status)
- **Recently Cloned Notice**: Removed thick left border for cleaner appearance

### Fixed

- **Points Label**: Singular "point" now used in exercise detail view when an exercise awards only one point
- **Dashboard Iris Logo**: Fixed missing Iris logo image in dashboard view
- **Submission Push Failures**: Fixed "rejected - fetch first" errors by pulling before pushing
- **Test Results on First Submission**: Show test results immediately after the first submission (WebSocket sync)
- **Unsaved Changes Banner**: Only shows when auto-save is disabled (not when set to afterDelay or other modes)
- **Build ETA Countdown**: Continues showing loading state after estimated time expires instead of stopping at 1s

## [0.0.6] - 2025-10-13

### Changed

- **Extension Identifier**: Changed extension identifier from "iris-thaumantias" to "artemis" for better branding consistency
- **Release Status**: Extension is now published as a stable release (not prerelease)

### Improved

- **WebSocket Real-time Updates**: Added "See test results" button when receiving build results via WebSocket, providing immediate access to test details without needing to refresh
- **Test Results Display**: Enhanced test feedback rendering to properly display all test result details including the `detailText` field from the API

### Fixed

- **UI Cleanup**: Removed WebSocket status indicator from the status bar to declutter the interface (status still available via command palette)
- **Login Flow**: Removed intermediate "Attempting to login to Artemis..." notification for a cleaner login experience
- **Test Feedback Rendering**: Fixed HTML escaping for test messages containing special characters (e.g., `<`, `>`), ensuring full test feedback is displayed correctly including assertion details

## [0.0.5] - 2025-10-12

### Added

- **Recommended Extensions Feature**:
  - New recommended extensions view with comprehensive extension data and management
  - Filter controls for extension categories (all, installed, not installed)
  - Extension installation functionality directly from the extension view
  - Curated list of programming language extensions and utilities for enhanced development experience
  - Visual indicators for installed vs. not installed extensions
- **Enhanced Icon Support**:
  - Added new icon definitions for extension management (plug, download, check)
  - Updated icon usage across dashboard and recommended extensions views for better visual consistency

### Improved

- **Dashboard Navigation**: Added quick access button to recommended extensions from the main dashboard
- **UI/UX**: Improved extension display with clear status indicators and action buttons

## [0.0.4] - 2025-10-12

### Changed

- **Release Status**: Extension moved to prerelease channel for ongoing development and testing
- Updated documentation to focus on Iris integration

## [0.0.3-pre.1] - 2025-10-11 (Pre-Release)

### Added

- **PlantUML Support**: Integrated PlantUML diagram rendering with auto-rendering and new tab opening functionality
- **Exercise Features**:
  - Test results fetching and rendering in exercise detail view
  - Submission details retrieval and display functionality
  - Submission details button in exercise interface
- **Dashboard Enhancements**:
  - Sorting functionality for recent courses
  - Exercise list sorting with enhanced exercise item data attributes
- **Service Status**:
  - Service Health Component for displaying health status checks
  - Enhanced Iris AI service health check with authentication cookie handling
  - Detailed status reporting for service health
  - WebSocket connection status monitoring

### Improved

- **Problem Statement Processing**:
  - Enhanced rendering with support for code blocks and improved styling
  - Horizontal rule support in problem statements
  - Structured task representation with improved layout
  - Better handling of PlantUML diagrams in problem statements
- **UI/UX**:
  - Adjusted padding and font size for sort dropdown
  - Improved background color opacity in exercise detail view for better visibility
  - Style adjustments in exercise detail view

### Fixed

- WebSocket endpoint in health check corrected to proper URL

## [0.0.2]

### Added

- Course and exercise browsing functionality
- Dashboard view with recent courses
- Exercise detail view
- Theme support (VS Code, Modern, Synthwave)

## [0.0.1]

### Added

- Initial release
- Artemis authentication system
- Basic UI framework with theme support
- Iris health status checking command

Thanks for using the Artemis VS Code extension!
