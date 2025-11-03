# Change Log

All notable changes to the Artemis VS Code extension will be documented in this file.

## [Unreleased]

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
- **Latest Result Selection**: Fixed result selection logic to use `completionDate` instead of ID when determining the latest test result. This ensures that when multiple builds complete out of order (e.g., due to varying build times), the most recently completed result is always displayed, matching Artemis web frontend behavior

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
