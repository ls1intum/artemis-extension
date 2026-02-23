# Artemis VS Code Extension

## What This Is

A VS Code extension that integrates with the Artemis learning platform, providing students with course browsing, exercise management, code submission, real-time build feedback, AI tutoring (Iris chat), and exam support — all within their editor. Currently uses server-side HTML string generation for webviews.

## Core Value

Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- ✓ Authentication — Login/logout with cookie-based sessions, token persistence
- ✓ Course browsing — Dashboard, course list, course detail views
- ✓ Exercise management — Exercise detail view with submission status, repository actions, build progress
- ✓ Code submission — Submit exercises, view results, real-time WebSocket updates
- ✓ Iris AI chat — Chat sessions with context switching, message streaming, code highlights
- ✓ Exam support — Exam start, conduction, and exercise detail views with timing
- ✓ Telemetry — Struggle detection, error quotient, intervention hints
- ✓ Build feedback — Build error CodeLens, build log parsing
- ✓ Real-time updates — WebSocket/STOMP for submissions, results, build status

### Active

<!-- Current scope. Building toward these in v1.0. -->

- [ ] Migrate all webview views from HTML string generation to React components
- [ ] Modernize webview messaging with typed contracts and clean routing
- [ ] Port existing UI components (Button, ListItem, Container, etc.) to React with same visual design
- [ ] Set up React build pipeline for VS Code webviews
- [ ] Ensure exam timer correctness through migration (no timing regressions)
- [ ] Ensure Iris chat streaming smoothness (no flicker/lag from React re-renders)

### Out of Scope

<!-- Explicit boundaries. -->

- Visual redesign — Migration preserves existing look and feel, not a redesign
- Test migration — View tests will be updated in a follow-up milestone
- New features — No new user-facing capabilities, pure infrastructure migration
- Backend changes — Extension host services (auth, API, WebSocket, telemetry) stay as-is

## Current Milestone: v1.0 React Webview Migration

**Goal:** Replace all HTML string template webviews with React components, modernize webview messaging, and improve developer experience while preserving existing visual design and functionality.

**Target features:**
- React component architecture for all 14+ views
- Typed message contracts between extension host and webviews
- React-based state management (approach TBD via research)
- Build pipeline supporting React/JSX in webviews
- Same visual design, same functionality, better DX

## Context

- **Codebase:** ~14 view screens, 20+ reusable components, all using `generateHtml()` string templates
- **Pain points:** View files up to 1487 lines, full webview redraws on every state change, 250+ `any` usages in view layer, inline JS scripts mixed with HTML
- **Architecture:** Two webview providers (ArtemisWebviewProvider for main UI, ChatWebviewProvider for Iris chat), message handler routing, app state manager
- **Build:** Currently esbuild with dual output (extension CJS + webview IIFE). Open to switching bundlers.
- **Critical views:** ExerciseDetail (1475 lines), ExamExerciseDetail (1487 lines), IrisChat (1106 lines) — these share code and have real-time/timing requirements
- **ExamExerciseDetail reuses ExerciseDetail components** — React composition will formalize this shared code

## Constraints

- **Functionality parity**: Every existing view must work identically after migration
- **Exam timing**: Countdown timers and time-sensitive state must not regress
- **Chat streaming**: Real-time Iris message streaming must remain smooth (no flicker/lag)
- **VS Code API**: Must work within VS Code webview sandbox constraints (CSP, postMessage bridge)
- **No backend changes**: Extension host services remain unchanged; only webview rendering changes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React for webviews | Industry-standard component model, team familiarity, rich ecosystem | — Pending |
| Same visual design | Reduce scope and risk — separate concerns of migration vs redesign | — Pending |
| Tests separate | Keep migration focused; test updates follow in next milestone | — Pending |
| State management TBD | Let research inform the right approach for VS Code webview context | — Pending |
| Build tooling open | May switch from esbuild if better React/webview support elsewhere | — Pending |

---
*Last updated: 2026-02-23 after milestone v1.0 definition*
