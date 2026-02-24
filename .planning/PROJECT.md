# Artemis VS Code Extension

## What This Is

A VS Code extension that integrates with the Artemis learning platform, providing students with course browsing, exercise management, code submission, real-time build feedback, AI tutoring (Iris chat), and exam support — all within their editor. Uses React components with Zustand state management for all webview UI.

## Core Value

Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.

## Requirements

### Validated

- ✓ Authentication — Login/logout with cookie-based sessions, token persistence
- ✓ Course browsing — Dashboard, course list, course detail views
- ✓ Exercise management — Exercise detail view with submission status, repository actions, build progress
- ✓ Code submission — Submit exercises, view results, real-time WebSocket updates
- ✓ Iris AI chat — Chat sessions with context switching, message streaming, code highlights
- ✓ Exam support — Exam start, conduction, and exercise detail views with timing
- ✓ Telemetry — Struggle detection, error quotient, intervention hints
- ✓ Build feedback — Build error CodeLens, build log parsing
- ✓ Real-time updates — WebSocket/STOMP for submissions, results, build status
- ✓ React webview migration — All 12 views render through React components — v1.0
- ✓ Typed message contracts — Discriminated unions replacing any-typed handlers — v1.0
- ✓ React component library — 22 components with CSS Modules and VS Code theme compliance — v1.0
- ✓ React build pipeline — Dual-target esbuild (Node.js CJS + browser IIFE) with nonce-based CSP — v1.0
- ✓ Exam timer accuracy — Web Worker timers with absolute timestamps, drift-free in background tabs — v1.0
- ✓ Chat streaming smoothness — RAF-based token buffering with React.memo, no flicker — v1.0

### Active

- [ ] Fix bugs identified in v1.0 migration (to be defined in v1.1)

### Out of Scope

- Visual redesign — Migration preserved existing look and feel, not a redesign
- Hot module replacement — DX improvement deferred (DX-01)
- VS Code Messenger RPC — Protocol upgrade deferred (DX-02)
- Stateless webview pattern — Full state refactor deferred (ARCH-01)
- Virtualized message list — Large chat history optimization deferred (ARCH-02)
- Backend changes — Extension host services (auth, API, WebSocket, telemetry) stay as-is

## Context

- **Codebase:** 39,841 LOC TypeScript/TSX, 12 React views, 22 shared components, 9 Zustand stores
- **Architecture:** React 18 webviews with CSS Modules, esbuild dual-target build, typed message contracts
- **Build artifacts:** extension.js (665KB CJS), webview-react.js (3.5MB IIFE), webview-react.css (~74KB)
- **Known issues:** 10 pre-existing TypeScript errors, 3.5MB bundle size (code splitting candidate), fullscreen panel temporarily disabled
- **Tech stack:** React 18.3.1, Zustand, esbuild, CSS Modules, Shiki, Streamdown, Web Workers

## Constraints

- **Functionality parity**: Every existing view works identically after migration
- **Exam timing**: Countdown timers use Web Workers with absolute timestamps (drift-free)
- **Chat streaming**: RAF-based token buffering with React.memo (no flicker)
- **VS Code API**: Nonce-based CSP, postMessage bridge, getState/setState persistence
- **No backend changes**: Extension host services remain unchanged

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React 18.3.1 for webviews | Safer than React 19 for webviews, includes deprecation warnings | ✓ Good |
| Same visual design | Reduce scope and risk — separate migration from redesign | ✓ Good |
| esbuild dual-target | Faster than webpack/Vite, simpler config for CJS + IIFE | ✓ Good |
| Zustand for state | Lightweight, works with postMessage, 9 independent stores | ✓ Good |
| CSS Modules | camelCase class names, VS Code CSS variables, no CSS-in-JS bloat | ✓ Good |
| Incremental migration | View-by-view with coexistence router, not big-bang | ✓ Good |
| Web Worker timers | Absolute timestamps prevent background tab drift | ✓ Good |
| RAF token buffering | Sentence boundary detection, no per-token setState | ✓ Good |
| Shiki syntax highlighting | Singleton highlighter with lazy init for chat code blocks | ✓ Good |
| Tests separate milestone | Keep v1.0 focused; test updates in v1.1 | ⚠️ Revisit |
| IIFE bundle format | Single file, consistent with webview constraints | ⚠️ Revisit (3.5MB) |

---
*Last updated: 2026-02-24 after v1.0 milestone*
