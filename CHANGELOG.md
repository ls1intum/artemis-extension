# Change Log

All notable changes to the Artemis VS Code extension will be documented in this file.

## [Unreleased]

### Changed

- **Trusted domains:** Removed the command "Artemis: Clear Trusted Domains". The list it cleared was written only by the confirmation dialog that used to appear when you opened a link from an exercise description, and that dialog stopped being reached in May, when the description moved to server-side rendering. Nothing writes the list and nothing reads it, so the command had no effect on anything the extension does. A list stored by an older version stays on disk and is ignored.

### Fixed

- **Wrong test results in the exercise description:** With both a graded and a practice participation, the task markers in the exercise description could describe the other one than the card above them, and which one you got was down to the order the server happened to return them in. The extension now renders the description for the repository you actually have open, and says so alongside the result so the two halves of the view cannot disagree. Two related gaps went with it: a build finishing for one participation no longer fails to refresh the description of the other, and while a build is running the description keeps the previous run's markers instead of dropping all of them until it finishes.

- **Login goes quiet after the password is accepted:** Signing in appeared to do nothing. The form reset itself, the progress indicator disappeared, and several seconds later the dashboard simply replaced it. The extension was treating the moment the credential is accepted as the end of the login, when the work of opening Artemis behind it had not started yet. The view now stays with you for that stretch: it reports "Signed in, opening Artemis", keeps the form locked instead of inviting a second sign-in, and says so when the wait is running long. If opening Artemis then fails, you are told that the sign-in itself worked and offered a window reload, rather than being sent back to a login form for a session you already have.

- **Test results while a build runs:** Starting a new submission no longer throws away the test results you already had. Artemis signals a build in progress by leaving the new submission without a result, and the extension was trying to attach the feedback it had just fetched to that empty submission, so the feedback was silently dropped. The exercise view already compensated for this in its own display; the data behind it now does too. The rendered problem statement still shows no test results while a build runs, which is tracked separately.

### Internal

- **Dead webview commands:** Removed three commands the webview had a handler for but no longer sends. Two of them, opening an external link and previewing an image, lost their senders when the exercise description moved to server-side rendering; the third asked the host for the Git identity, which the host has pushed on its own since March. Five private helpers and a whole utility module went with them, and one command module lost its last use of the extension context. The retired Git-identity handler also held the only test of the local-then-global config fallback, for a rule the surviving code implements a second time, so that test moved down onto the function that still runs instead of being deleted with it.

- **Release tooling:** Removed four shell scripts left over from before the release workflow existed. Nothing referenced them, the workflow does the tagging, release creation and packaging itself, and each carried a way to damage published state: one rewrote the minimum VS Code version back to 1.97, one deleted every GitHub release to recreate it.
- **Chat provider:** Split the Iris chat's webview provider, a 1528-line class, into the webview surface plus three collaborators: navigation, the send path, and Iris availability. Two duplicated rules went with it. No behaviour change.
- **Chat view:** Split the Iris chat view, a 1132-line component, into the rendering plus four hooks and a module of pure screen-selection rules that now have their own tests. No behaviour change.
- **God-file guard:** Lint now fails a file in `src/` over 850 lines. A ratchet, not a target: it sits just above the largest file there and drops again whenever that number does.
- **One definition of "latest":** Artemis treats the highest id as the newest, not the newest date. That rule was implemented twice, once in the extension and once in the webview, under two names with two test suites, and a third rule for picking a result during a build existed only on one side. All of them now live in one place, so the two halves cannot drift into disagreeing about which result a student is looking at. Also removed a parser that walked through exercises, courses and results to build values nothing ever read.
- **Copy-paste in workspace detection:** The routine that decides which exercise a cloned repository belongs to built the same result four times and ran the same search twice, differing only in which address it compared against. It is now written once. The two orderings it depends on, checking an exercise's own repository before its participations, and finishing the exact search before falling back to the practice variant, are now stated rather than left to be inferred from the nesting. No behaviour change.
- **Helpers that already existed:** Four places spelled out the same error-message extraction the shared helper does, and two screens hand-built the "nothing here" panel that is already a component. Both now use the shared version. The two panels shift slightly in spacing and use a real heading element as a result; the surrounding card is unchanged.
- **Service health checks:** The three checks behind the Service Status view and the login health panel were three near-identical copies with no test coverage at all, which made them risky to touch. They now share one probe and have 22 tests pinning what each one reports, including the parts that read as bugs but are not: an HTTP error still counts as "server reachable", and Iris being switched off is reported differently from the info endpoint being unreachable. No behaviour change.
- **Dead code:** Removed three units that nothing reached. A score component no view ever rendered; a registry method for importing exercises from raw course data that no longer had a caller, along with the older `{ id, exercises }` input shape it tolerated; and two of the three copies of the service-health result type, which could have drifted apart from the message it travels in without the compiler noticing. Also removed a date helper and a re-export left unused by those deletions. No behaviour change.

## [0.5.0] - 2026-08-20

### Added

- **Get Started tour:** A new "Get Started with Artemis" walkthrough guides you through choosing your Artemis server, signing in, picking where exercises are cloned to, and meeting the Iris tutor, with a final step for reviewing Iris and Artemis preferences. It opens once on your first run of the extension and is reachable afterwards from VS Code's own Get Started page. It is not included in the Open VSX build.
- **Set Default Exercise Folder:** A new command opens a folder picker and stores the result as your default clone location, so you can set it without typing a path. The Get Started tour uses it, and on desktop it is also available from the command palette.

### Changed

- **Login:** Signing in now starts with your username on its own. Artemis then decides how you continue: accounts it manages itself get the password field as before, and accounts managed by an identity provider get a "Sign in with TUM Login" button that finishes the sign-in in your browser. If you go back, the browser sign-in is cancelled rather than left able to log you in afterwards, and declining "Remember me on this device" now really does forget an earlier session instead of leaving it stored.
- **Login:** Signing in now shows what it is doing. A spinner names the current step instead of the form sitting there looking untouched, and a slow sign-in is no longer a dead end: a Cancel button stops the attempt, at both the username and the password step. Cancelling, going back or logging out is no longer quietly undone by a sign-in that was already on its way, and logging out no longer forgets a session you started right after it. A server that does not answer in time now says so instead of reporting a raw timeout.
- **Exercise folder:** A default clone folder written as `~/artemis-exercises` now works. The leading `~` is expanded to your home folder instead of failing at the first clone.
- **Start page:** The suggestion to always open your workspace exercise no longer appears after you have already chosen a start page yourself.
- **Server setting:** Correcting the Artemis server address by adding a trailing slash, or by spelling out the default port, no longer signs you out. The address is now recognised by which server it means rather than by its exact text.
- **Server picker:** Selecting an Artemis server now opens on the server you are currently using instead of always on production, so confirming your choice does not mean scrolling to find it first.

### Internal

- **Extension host tests in CI:** The 1511 tests that run inside a real VS Code instance had never been executed by any workflow, so they could break without CI noticing. They now run on every pull request and block merges. Their failures are also readable again: the reporter in use wrote only a machine-readable file, so a red run named no test.
- **Code comments:** Removed comments that documented the history of the code rather than the code itself ("used to race", "the removed X command", "kept for backwards compat"), along with comments restating the line below them, JSDoc that only re-spelled the signature, and Arrange/Act/Assert labels in tests. Where a historical note carried a constraint that still holds, the constraint was rewritten in the present tense instead of deleted. Comments only, no behaviour change.

## [0.4.10] - 2026-08-09

### Changed

- **VS Code Compatibility**: Lowered the minimum required VS Code version from 1.97.0 to 1.93.0 (August 2024), so four more releases of VS Code can install the extension. 1.93 is the genuine floor: it is the release that finalised the Terminal Shell Integration API the struggle detection depends on.

### Security

- **WebSocket client**: Updated `ws` to 8.21.0. It ships inside the extension and carries the live connection to Artemis, so the fix only reaches you with this release. Addresses [CVE-2026-45736](https://nvd.nist.gov/vuln/detail/CVE-2026-45736), where closing a connection could disclose uninitialised memory.

### Internal

- **Release pipeline:** The Marketplace publish now retries transient network failures instead of stalling the whole release, and the release runbook documents the dev-to-main sync and the CI gate timing.
- **Dependencies:** Brought the build and test toolchain up to date (esbuild, vite, vitest, eslint, and the React and testing libraries). Every type package in `extension/package.json` is now pinned to an exact version, with `engines.vscode` the only range, so the compiler can no longer accept a VS Code API that the declared minimum version does not have.

## [0.4.9] - 2026-08-08

### Changed

- **Iris streaming:** Iris answers now stream in as they are generated instead of appearing all at once, and the chat shows which tools Iris used during a run, replacing the progress display that stopped working with Artemis 9.6.
- **Iris chat redesign:** The chat sidebar now separates the context (which exercise or course you are asking about) from the conversation thread, adding a context picker, course-wide conversation history, and a roomier message layout.
- **Iris chat follows Artemis' conversations:** One conversation at a time, exactly the one the server has. Changing the topic now stays in that conversation and is written into the transcript as a divider instead of opening a second one; the `+` in the header starts a fresh conversation. Messages you write in the Artemis web client show up here as they arrive, and a course whose instructor has switched Iris off can be opened and says so.
- **WebSocket status bar:** Removed the `artemis.showWebSocketStatusBar` setting. The connection indicator now appears automatically only when there is a problem; enable `artemis.developerMode` to keep it always visible with full diagnostics on hover. When the connection drops, students now see a plain-language explanation (no "WS" jargon) instead of a technical label.
- **Server URL change:** Removed the manual "Clear Credentials" prompts that appeared when the Artemis server URL changed. Changing the server while logged in now logs you out automatically and returns you to the login view (a session is not valid across servers); the logout command remains for clearing credentials on demand.
- **While Iris is answering:** You can already type your next message. You send it yourself once the answer is there.

### Fixed

- **Opening an exercise for the first time:** The chat now waits for the workspace to be recognised instead of racing it, so an exercise you have never chatted about before opens its conversation instead of leaving you on the course list. A course or topic you pick yourself is no longer overridden a moment later, and a chat that cannot reach the server says so and offers a retry rather than pretending the folder has no exercise. A course whose instructor has switched Iris off now says that too, instead of offering a retry that could never work.
- **Exercise description header:** Tightened the spacing under the "Exercise Description" heading and added a divider line, so the description starts directly below the title instead of after a large gap.
- **Stale credentials at startup:** Credentials that are no longer valid on the configured Artemis server are now reliably detected during startup validation and cleared, instead of lingering until a later request fails.
- **Brief connection problems:** A short outage no longer hides the conversation you were reading or empties your conversation history, and a message that could not be sent keeps its text behind a single Retry that reconnects and then sends it.
- **Iris logo:** The mascot now has a subtle shadow, so on light themes it no longer sits on the surface as a flat block, and it keeps its proportions instead of being squashed into a square.
- **Course and exercise lists:** The chat kept a list of its own that only ever grew, so a deleted course, or one you were removed from, stayed on offer and then failed when you picked it. The lists come from the server now, and nothing from a previous account or Artemis server is left behind when you switch. When the server cannot be reached, the course list says so and offers a retry instead of reporting that you have no courses.
- **Sending a message:** Your own message no longer appears twice for a moment before collapsing into one.

### Internal

- **Session Recorder Retired From Shipped Builds**: The recorder and its consent flow are now also excluded from the Desktop/Marketplace VSIX (previously Open VSX only); they remain available through a local-only build variant that CI refuses to build.

## [0.4.8] - 2026-06-24

### Changed

- **EduIDE Exercise Actions**: In the EduIDE (Theia cloud) build the exercise repository is already the workspace, so cloning is replaced by an "Open in Artemis" button. The primary "Clone Repository" button, the dropdown "Clone Repository" and "Open Repository" entries, and the "recently cloned" notice are hidden in this managed environment; the "Copy Clone URL" options remain. The desktop build is unchanged.

### Fixed

- **EduIDE Server Links**: In EduIDE (Theia) the "Open in Artemis" button and other browser-open actions now target the connected Artemis server (delivered via the data-bridge) instead of falling back to the production default; problem-statement relative links resolve against the same server.

### Internal

- **EduIDE Auto-Update**: A new release-pipeline job notifies the EduIDE (Theia cloud) repository after a successful Open VSX publish, which automatically opens a PR bumping the bundled extension version, replacing the previous manual version-pin step.
- **Documentation & Marketplace Docs**: Reorganized the docs into two root files (`README.md` for users, `DEVELOPER.md` for development) and rewrote the contributor guide. The user README and changelog are now single-sourced at the repo root and generated into `extension/` at package time, so both store listings share one description and gain a Changelog tab.

## [0.4.7] - 2026-06-22

### Changed

- **Open VSX Build**: The Open VSX (EduIDE/Theia cloud) distribution now also excludes the struggle-detection engine and its webview UI via fail-closed build seams (on top of the existing recorder/consent exclusion) and ships cloud-tailored setting defaults.

### Fixed

- **Local Dev Server Preset**: The "Local Development" server option now targets `localhost:8080` (the Artemis server) instead of `localhost:9000`.

### Internal

- **Open VSX Bundle Verifier**: `verify-clean-bundle.js` now denies the entire telemetry subtree by default (fail-closed) instead of a hand-picked denylist, so any new telemetry/recorder file is kept out of the clean build automatically.

## [0.4.6] - 2026-06-18

### Added

- **Reading Telemetry**: The session recorder now captures problem-statement reading behavior (scrolling and text selections, with extended consent only).
- **Sticky Build Status**: Build progress and ETA stay visible in a slim strip at the top of the exercise view while you scroll; the result flashes briefly when the build finishes out of view.

### Fixed

- **Replay Fidelity**: Live and recording paths share one build-error-family builder, so replayed EQ matches the live curve.
- **Intervention Block Reasons**: Withheld interventions record the real gate; `recent-progress`/`last-dismissed` no longer logged as `warmup`.
- **Test Results With Hidden Names**: The "See test results" overview now lists results for exercises that hide test names from students (`showTestNamesToStudents` disabled), instead of showing "No test results available".
- **Submission Git Locks**: Submitting is now guarded against a double-click, and a busy or stale Git index lock surfaces an actionable message instead of raw git output or a misleading "No local changes detected".
- **Build Error CodeLens Position**: Build-error CodeLenses now shift with your edits instead of staying stuck at the originally reported line.
- **Feedback During Builds**: Build feedback now stays visible while a new build runs, with a banner, and updates automatically when results arrive.

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
