# Technology Stack

**Analysis Date:** 2026-02-23

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code in `src/` and extension logic

**Secondary:**
- JavaScript - Build configuration (`esbuild.js`)

## Runtime

**Environment:**
- Node.js 16+ (via VS Code native module system)
- VS Code 1.97.0+ (extension host environment)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- VS Code Extension API - Extension host framework for all UI and commands
  - Entry point: `src/extension.ts`
  - Webview integration for chat and login views
  - Command palette and context menus

**WebSocket/Real-time:**
- STOMP.js 7.2.1 - WebSocket messaging protocol for Artemis server communication
  - Implementation: `src/services/artemisWebsocketService.ts`
  - Handles subscription to build results, submissions, and real-time updates
  - Connection pooling and exponential backoff retry logic

**HTTP Client:**
- Fetch API (native) - REST API communication to Artemis server
  - Implementation: `src/api/artemisApi.ts`
  - All API requests routed through centralized `makeRequest()` method
  - Authentication header injection and error handling

**Reactive Programming:**
- RxJS 7.8.2 - Reactive streams for async operations
  - Used in WebSocket handlers and event emission
  - Context and state management with observables

**Testing:**
- VS Code Test CLI 0.0.12 - Test runner (supports unit and e2e)
  - Configuration: Unit and E2E labels in `vscode-test`
  - Sinon 21.0.1 - Mocking and test doubles

**Build/Dev:**
- esbuild 0.27.2 - JavaScript bundler
  - Config: `esbuild.js`
  - Builds extension code to `dist/extension.js` (CJS, Node.js platform)
  - Builds webview components to `dist/webview-components.js` (IIFE, browser platform)
  - CSS file copying via custom plugin
  - Watch mode and production minification support

**Linting/Formatting:**
- ESLint 9.39.2 - JavaScript/TypeScript linting
  - Config: `eslint.config.mjs` (flat config format)
  - TypeScript ESLint parser and plugin 8.54.0
  - Rules: No console logging (enforced), naming conventions, strict comparison

## Key Dependencies

**Critical:**
- `@stomp/stompjs` 7.2.1 - Required for WebSocket/STOMP communication with Artemis
  - Used to subscribe to real-time build results and submission updates
  - Handles automatic reconnection with configurable backoff

- `ws` 8.19.0 - WebSocket client for STOMP bridge
  - Underlying transport for `@stomp/stompjs`

- `rxjs` 7.8.2 - Async event handling
  - Observable patterns for state and subscription management

**Infrastructure:**
- `@types/vscode` 1.97.0 - TypeScript definitions for VS Code API
- `@types/node` 24.10.9 - Node.js type definitions
- `@types/mocha` 10.0.10 - Test framework types
- `@types/sinon` 21.0.0 - Mock library types
- `@types/ws` 8.18.1 - WebSocket type definitions

## Configuration

**Environment:**
- Artemis Server URL - Configurable via `artemis.serverUrl` setting (default: `https://artemis.tum.de`)
  - Stored in VS Code settings or environment
  - Can be overridden per workspace

**Build:**
- `tsconfig.json` - TypeScript compiler options
  - Target: ES2022
  - Module: Node16
  - Strict type checking enabled
  - Source maps generated (non-production)

- `eslint.config.mjs` - ESLint configuration
  - ES2022 ECMAScript version
  - Module source type
  - No console usage except in tests and config files

**Extension Manifest:**
- `package.json` - VS Code extension manifest
  - Extension ID: `iris-thaumantias` (Artemis - TUM)
  - Publisher: `aet-tum`
  - Category: Education, Other
  - Activation: Lazy (no specific activation events)

## Platform Requirements

**Development:**
- Node.js 16+ with npm
- TypeScript compiler
- VS Code 1.97.0+ for testing extensions

**Production:**
- VS Code 1.97.0+
- Network access to Artemis server
- Git client (for exercise repository operations)
- WebSocket connectivity (no proxy interference)

---

*Stack analysis: 2026-02-23*
