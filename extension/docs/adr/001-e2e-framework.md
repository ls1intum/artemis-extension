# ADR 001: E2E Test Framework Selection

**Date:** 2026-02-28
**Status:** Accepted

---

## Context

The Artemis VS Code extension requires E2E UI tests that launch a real VS Code instance and interact with Artemis webview panels. The extension renders its primary UI as sidebar webview panels (not editor tabs), which constrains framework options — any viable framework must be able to switch into the webview iframe context for sidebar panels.

Three frameworks were evaluated during initial test architecture setup.

---

## Options Considered

| Framework | Version | Approach | Pros | Cons |
|-----------|---------|----------|------|------|
| **vscode-extension-tester** | v8.22.0 | Selenium WebDriver; launches real VS Code; provides `WebviewView` page object with built-in iframe switching for sidebar panels | Mature ecosystem; sidebar webview iframe support via `WebviewView.switchToFrame()`; existing helper library built (`switchToWebviewFrame`, `waitForElement`, `takeScreenshot`); screenshot-on-failure for local debugging | Selenium-based (heavier than Playwright); requires `xvfb` on headless Linux; element waits can be flaky |
| **wdio-vscode-service** | latest | WebDriverIO service for VS Code; extends wdio with VS Code-specific locators | Modern WebDriverIO ecosystem; good documentation; active maintenance | **No sidebar webview iframe support** — cannot switch into the webview iframe context for sidebar panels. This is a blocking limitation for this extension's architecture. |
| **Playwright** | N/A | Browser automation framework with potential VS Code extension support | Fast; reliable; modern async API; excellent debugging tools (trace viewer, video recording) | **No VS Code extension automation target** — microsoft/playwright#22351 is open and unresolved. Cannot launch VS Code or interact with the extension host. Entirely excluded — not a viable option. |

---

## Decision

Retain **`vscode-extension-tester` v8.22.0** as the sole E2E test framework.

The existing helper library (`test/e2e/ui/helpers.ts`) provides the core primitives needed for sidebar webview testing:

- `switchToWebviewFrame` / `switchBackFromWebview` — iframe context switching via `WebviewView.switchToFrame()`
- `waitForElement` — CSS-selector-based element waiting with configurable timeout
- `getCredentials` — reads `ARTEMIS_USER` / `ARTEMIS_PASSWORD` from environment (the legacy name `ARTEMIS_PASS` is also accepted)
- `takeScreenshot` — PNG capture to `test/ui/screenshots/` for local debugging

E2E tests run locally only via `npm run test:ui` / `test/e2e/ui/run-tests.sh`. They are not executed in CI.

`wdio-vscode-service` and Playwright are not evaluated further for this project.

---

## Consequences

- E2E tests depend on Selenium WebDriver and ChromeDriver managed by `vscode-extension-tester`.
- Tests require a running Artemis + Iris instance with valid credentials (`ARTEMIS_USER`, `ARTEMIS_PASSWORD` env vars, sourced from a local `.env` file; see `.env.example`).
- Screenshot-on-failure is available locally for debugging via the `takeScreenshot()` helper.
- CI runs unit tests (Vitest) and integration tests (Mocha + `@vscode/test-electron`) only — E2E tests remain local.
- Future contributors should not introduce `wdio-vscode-service` or Playwright for E2E testing in this project.
- If Playwright adds VS Code extension support (microsoft/playwright#22351), this decision should be revisited.
