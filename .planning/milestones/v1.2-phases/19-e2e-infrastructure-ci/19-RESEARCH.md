# Phase 19: E2E Infrastructure & CI - Research

**Researched:** 2026-02-28
**Domain:** GitHub Actions CI, JUnit reporting, ADR documentation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase Boundary:** Set up a GitHub Actions CI pipeline that runs Vitest and Mocha extension host tests on push/PR, and document the E2E framework decision (vscode-extension-tester retained). E2E tests remain local-only — they do NOT run in CI.

**Deviation from roadmap:** The original success criteria call for Selenium E2E in CI. Per user decision, E2E stays local. CI covers Vitest (React components) and Mocha (extension host) only.

**CI Trigger Strategy:**
- Trigger on every push to any branch AND on pull requests to main
- Single sequential job with early exit: Vitest → Mocha extension host — if Vitest fails, skip Mocha
- Ubuntu-latest only (no macOS/Windows matrix)
- No VSIX artifact upload — CI is tests-only

**Test Layers in CI:**
- Layer 1: Vitest (React component tests) — `npm run test:react`
- Layer 2: Mocha extension host tests — `npm run test:unit`
- NOT in CI: Selenium E2E tests — remain local-only via `npm run test:ui` / `run-tests.sh`

**Failure Handling & Reporting:**
- JUnit XML reports for both Vitest and Mocha, rendered in GitHub Test Summary UI
- GitHub UI notifications only (no Slack, no external notifications)

**Framework Decision Documentation:**
- ADR in `docs/adr/` (e.g., `001-e2e-framework.md`)
- Full comparison of all three options considered (vscode-extension-tester, wdio-vscode-service, Playwright) with pros/cons and rationale
- ADR focused on E2E decision only — no broader test landscape overview needed

### Claude's Discretion
- Exact GitHub Actions workflow structure and step naming
- JUnit reporter configuration for Vitest and Mocha
- ADR template and formatting
- Whether to update cross-references in existing docs (.planning/codebase/TESTING.md)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| E2EI-01 | E2E framework decision finalized (vscode-extension-tester vs wdio-vscode-service) with documented rationale | ADR format researched; decision already made in STATE.md — ADR is documentation artifact |
| E2EI-02 | CI workflow runs all test layers on GitHub Actions with xvfb on Linux | Note: per CONTEXT.md, E2E stays local — CI runs Vitest + Mocha only; xvfb is needed for Mocha (@vscode/test-electron spawns a headless VS Code); official VS Code CI docs confirm `xvfb-run -a` pattern |
| E2EI-03 | Screenshot captured automatically on E2E test failure for debugging | Screenshot capability already exists in `helpers.ts`; CI artifact upload pattern researched for JUnit reports; E2E stays local so this requirement is satisfied by the existing `takeScreenshot()` implementation + a note in the ADR or docs |
</phase_requirements>

## Summary

This phase is primarily infrastructure authorship — creating a GitHub Actions workflow YAML file, adding a JUnit reporter to the Vitest config, configuring Mocha to output JUnit XML, and writing an ADR document. There is no new library installation required; the entire test stack is already installed.

The Mocha extension host tests (`npm run test:unit`) use `@vscode/test-electron` under the hood, which launches a real VS Code process — this requires a display on Linux. The official VS Code CI pattern is `xvfb-run -a npm run test:unit`, and `xvfb-run` is pre-installed on `ubuntu-latest` GitHub Actions runners. No separate xvfb action or apt-get install is needed.

Vitest has a built-in `junit` reporter (no extra package). Mocha JUnit reporting requires installing `mocha-junit-reporter` (not currently in the project). The `@vscode/test-cli` `defineConfig` `mocha` property accepts `Mocha.MochaOptions`, which includes `reporter` and `reporterOptions` — confirmed via the installed type definition at `node_modules/@vscode/test-cli/out/config.d.cts`. The GitHub Test Summary UI can be populated using `dorny/test-reporter@v2` (reads JUnit XML and creates a Check Run on the PR/commit).

Regarding E2EI-03 (screenshot on failure): E2E tests run local-only. The requirement is satisfied by the existing `takeScreenshot()` helper in `test/e2e/ui/helpers.ts` — the planner should document that CI artifact upload for screenshots is out of scope (E2E is local), and the ADR should note the local screenshot capability.

**Primary recommendation:** Write a single GitHub Actions workflow YAML with two sequential steps (Vitest → Mocha), both wrapped with `xvfb-run -a` on Linux (only Mocha strictly requires it, but wrapping both is safe), output JUnit XML from both, and use `dorny/test-reporter@v2` to surface results in the GitHub UI.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| GitHub Actions (`ubuntu-latest`) | N/A | CI runner | Pre-installed xvfb-run; official VS Code CI recommendation |
| `xvfb-run -a` | pre-installed | Virtual display for headless VS Code | Official VS Code CI docs pattern; `-a` auto-selects free display number |
| Vitest built-in `junit` reporter | vitest ^4.0.18 (already installed) | JUnit XML output for Vitest | Built-in, zero additional packages |
| `mocha-junit-reporter` | ^2.2.1 (needs install) | JUnit XML output for Mocha | De facto standard; works with `Mocha.MochaOptions` |
| `dorny/test-reporter@v2` | v2 | Render JUnit XML as GitHub Check Run | Best-maintained action for JUnit; supports `jest-junit` format which Vitest outputs |
| `actions/upload-artifact@v4` | v4 | Upload JUnit XML as downloadable CI artifact | Standard artifact action |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `actions/setup-node@v4` | v4 | Node.js setup | Standard in all Node.js CI |
| `actions/checkout@v4` | v4 | Repo checkout | Standard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dorny/test-reporter@v2` | `mikepenz/action-junit-report` | mikepenz is simpler but dorny produces proper GitHub Check Runs (visible on PR status); either works |
| `dorny/test-reporter@v2` | `test-summary/action` | test-summary writes to job summary only, not a Check Run; less visible |
| `mocha-junit-reporter` | `mocha-multi-reporters` | Unnecessary for this project — only one reporter needed |

**Installation (only new package needed):**
```bash
npm install --save-dev mocha-junit-reporter
```
(Install in `iris-thaumantias/` directory)

## Architecture Patterns

### Recommended Project Structure
```
iris-thaumantias/
├── .github/
│   └── workflows/
│       └── ci.yml          # New: the CI workflow
├── docs/
│   └── adr/
│       └── 001-e2e-framework.md  # New: the ADR
├── vitest.config.mts           # Modified: add junit reporter
└── .vscode-test.mjs            # Modified: add mocha-junit-reporter
```

### Pattern 1: GitHub Actions Workflow (Sequential, Early Exit)

**What:** A single job with two steps; if Vitest fails, the `npm run test:unit` step is skipped by default (GitHub Actions skips all subsequent steps after a failure unless `if: always()` is set). Wrap the `test:unit` step with `xvfb-run -a` because `@vscode/test-electron` launches real VS Code.

**When to use:** Always — this is the decided shape.

**Example:**
```yaml
# Source: Official VS Code CI docs (https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main]

permissions:
  contents: read
  checks: write   # Required for dorny/test-reporter to create Check Runs

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: iris-thaumantias/package-lock.json

      - name: Install dependencies
        working-directory: iris-thaumantias
        run: npm ci

      - name: Compile
        working-directory: iris-thaumantias
        run: npm run compile-tests

      - name: Run Vitest (React component tests)
        working-directory: iris-thaumantias
        run: npm run test:react

      - name: Run Mocha extension host tests
        working-directory: iris-thaumantias
        run: xvfb-run -a npm run test:unit

      - name: Publish test results
        uses: dorny/test-reporter@v2
        if: ${{ !cancelled() }}
        with:
          name: Test Results
          path: iris-thaumantias/reports/*.xml
          reporter: jest-junit

      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: junit-reports
          path: iris-thaumantias/reports/
```

**Note on `working-directory`:** The repo root is `artemis-extension/`, but all source lives in `iris-thaumantias/`. Either set the working-directory on all steps, or `cd iris-thaumantias` in the run commands. The `working-directory` approach is cleaner.

**Note on `npm ci` vs `npm install`:** `npm ci` is required for reproducible CI builds (installs from lockfile, fails on mismatch). The project has a `package-lock.json` in `iris-thaumantias/`.

### Pattern 2: Vitest JUnit Reporter Configuration

**What:** Vitest has a built-in `junit` reporter. Configure it alongside `default` so console output is preserved. Use `outputFile` map syntax to direct each reporter's output to a separate file.

**Example:**
```typescript
// Source: https://vitest.dev/guide/reporters (Vitest docs)
// vitest.config.mts — modified test section
test: {
  reporters: process.env.CI
    ? ['default', 'junit']
    : ['default'],
  outputFile: {
    junit: './reports/vitest-results.xml',
  },
  // ... rest of existing config unchanged
}
```

Alternatively, always output JUnit (simpler, no conditional):
```typescript
reporters: ['default', 'junit'],
outputFile: { junit: './reports/vitest-results.xml' },
```

### Pattern 3: Mocha JUnit Reporter via @vscode/test-cli

**What:** The `mocha` property in `defineConfig` accepts `Mocha.MochaOptions`, which includes `reporter` and `reporterOptions`. This is confirmed by the installed type definition (`node_modules/@vscode/test-cli/out/config.d.cts` line 32: `mocha?: Mocha.MochaOptions & { reporter?: string }`).

**Example:**
```javascript
// Source: @vscode/test-cli config.d.cts (installed, verified)
// .vscode-test.mjs — modified unit label config
{
  label: 'unit',
  files: 'out/test/unit/**/*.test.js',
  exclude: ['out/test/unit/struggle-detection/**'],
  coverage: {
    exclude: ['**/test/**', '**/out/test/**'],
  },
  mocha: {
    reporter: 'mocha-junit-reporter',
    reporterOptions: {
      mochaFile: './reports/mocha-results.xml',
    },
  },
}
```

**Important:** `mocha-junit-reporter` must be `require`-able, so it must be installed as a devDependency. Set `MOCHA_FILE` env var as an alternative to `reporterOptions.mochaFile` if the `reporterOptions` key doesn't survive the CLI → Mocha option passing (test this during implementation).

### Pattern 4: ADR (Architecture Decision Record)

**What:** A Markdown document in `docs/adr/` following Michael Nygard's format (Title, Status, Context, Decision, Consequences). Simple, no tooling needed.

**Template:**
```markdown
# 001: E2E Test Framework Selection

**Date:** 2026-02-28
**Status:** Accepted

## Context

[Why was a decision needed? What were the options?]

## Decision

[What was decided and why?]

## Consequences

[What are the results of this decision?]
```

The ADR must compare: `vscode-extension-tester` (chosen), `wdio-vscode-service` (rejected: no sidebar webview iframe support), Playwright (excluded: issue #22351 — no VS Code extension automation target).

### Anti-Patterns to Avoid

- **Using `actions/checkout@v3` or older:** Always use `@v4`; older versions have known CVEs and performance issues.
- **Omitting `permissions: checks: write`:** `dorny/test-reporter` requires write permission to create Check Runs. Without it, the step silently fails.
- **Using `if: failure()` for artifact upload:** Prefer `if: ${{ !cancelled() }}` — this uploads on both success and failure, but not on workflow cancellation. Use `if: always()` if you want upload even on cancellation (less common).
- **Passing `--reporter` to `vscode-test` CLI via npm script:** The CLI doesn't accept `--reporter` as a command-line arg the same way raw Mocha does. Configure the reporter in `.vscode-test.mjs` instead.
- **Not compiling before `test:unit`:** `@vscode/test-cli` runs compiled JS from `out/`, not TypeScript source. The `compile-tests` script (`tsc -p . --outDir out`) must run before `test:unit`. The existing `pretest` hook does this, but `pretest` only triggers on `npm test`, not `npm run test:unit`. The CI workflow must explicitly run `compile-tests` first.
- **Running `npm run compile` (full compile) before tests:** Full compile includes ESLint and type checking, which is slow and fails on type errors unrelated to tests. `compile-tests` (just tsc for the test output dir) is sufficient for CI test execution.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JUnit XML output (Vitest) | Custom reporter | Built-in `junit` reporter | Built-in, stable, no install |
| JUnit XML output (Mocha) | Custom reporter | `mocha-junit-reporter` | De facto standard; handles test timing, nested suites, classnames correctly |
| Displaying test results in GitHub | Parse XML in shell script | `dorny/test-reporter@v2` | Creates proper Check Runs visible on PRs; handles forked PR security model |
| Virtual display for VS Code in CI | Complex Xvfb startup script | `xvfb-run -a` | Pre-installed on ubuntu-latest; `-a` auto-selects display number; no configuration needed |

**Key insight:** `xvfb-run -a` is the official VS Code recommendation and requires zero setup on `ubuntu-latest`. Do not install Xvfb manually or use `GabrielBB/xvfb-action`.

## Common Pitfalls

### Pitfall 1: Mocha Reporter Not Picked Up
**What goes wrong:** `npm run test:unit` runs but no XML file is created; the `dorny/test-reporter` step fails with "No files matching path found."
**Why it happens:** `mocha-junit-reporter` wasn't installed, or `reporterOptions.mochaFile` path isn't reachable from the working directory at runtime.
**How to avoid:** Install `mocha-junit-reporter` as devDependency. Use a relative path like `./reports/mocha-results.xml` — relative to where `vscode-test` is invoked (the `iris-thaumantias/` directory). Alternatively, set the `MOCHA_FILE` environment variable in the CI step.
**Warning signs:** Missing XML file in the `reports/` directory after CI run; `dorny/test-reporter` warns about no files found.

### Pitfall 2: compile-tests Must Run Before test:unit
**What goes wrong:** `@vscode/test-cli` fails with "No test files found" or module-not-found errors.
**Why it happens:** `test:unit` runs compiled JS from `out/`. Without `compile-tests` first, the `out/` directory is either absent or stale.
**How to avoid:** In the CI workflow, add an explicit `npm run compile-tests` step before `npm run test:unit`. Do NOT rely on the `pretest` npm hook — it only triggers for `npm test`, not `npm run test:unit`.
**Warning signs:** "Cannot find module" errors in CI; tests pass locally (where `out/` may already exist) but fail in CI (fresh checkout, no `out/` directory).

### Pitfall 3: Missing `permissions: checks: write`
**What goes wrong:** `dorny/test-reporter` step completes but no Check Run appears on the PR; action logs show a 403 permission error.
**Why it happens:** GitHub Actions workflows need explicit `checks: write` permission to create Check Runs via the GitHub API.
**How to avoid:** Add `permissions: checks: write` at the job or workflow level. Also add `contents: read` to follow least-privilege.
**Warning signs:** `dorny/test-reporter` step exits with non-zero code citing GitHub API permissions error.

### Pitfall 4: Vitest `outputFile` with Single Reporter
**What goes wrong:** Specifying `outputFile: './reports/vitest.xml'` as a string when multiple reporters are configured causes only one reporter to write to that file.
**Why it happens:** When using multiple reporters, `outputFile` must be an object mapping reporter name to file path.
**How to avoid:** Always use object syntax: `outputFile: { junit: './reports/vitest-results.xml' }`.
**Warning signs:** JUnit XML file is empty or contains non-XML content (console output was written to it instead).

### Pitfall 5: xvfb-run Not Needed for Vitest (But Fine to Include)
**What goes wrong:** Unnecessary complexity if you wrap Vitest with `xvfb-run`.
**Why it happens:** Vitest uses happy-dom (not a real browser), so it doesn't need a display. Only `@vscode/test-electron` (used by `test:unit`) requires a display.
**How to avoid:** Apply `xvfb-run -a` only to the `test:unit` step. Running Vitest without it is safe.
**Warning signs:** N/A — wrapping Vitest with `xvfb-run` won't break anything, it's just unnecessary.

### Pitfall 6: ADR Missing Decision Rationale for All Three Frameworks
**What goes wrong:** ADR is too thin — only states the choice without explaining why alternatives were rejected.
**Why it happens:** Shortcut writing.
**How to avoid:** The ADR must address all three candidates: `vscode-extension-tester` (retained), `wdio-vscode-service` (rejected), Playwright (excluded). The existing rationale from `STATE.md` is: wdio-vscode-service has no sidebar webview iframe support; Playwright excluded via issue #22351 (no VS Code extension automation target).
**Warning signs:** ADR has a "Decision" section but no "Alternatives Considered" section with rejection reasons.

## Code Examples

Verified patterns from official sources:

### Complete GitHub Actions CI Workflow
```yaml
# Source: Official VS Code CI docs + project-specific adaptations
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main]

permissions:
  contents: read
  checks: write

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: iris-thaumantias

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: iris-thaumantias/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Compile tests
        run: npm run compile-tests

      - name: Run Vitest (React component tests)
        run: npm run test:react

      - name: Run Mocha extension host tests
        run: xvfb-run -a npm run test:unit

      - name: Publish test results
        uses: dorny/test-reporter@v2
        if: ${{ !cancelled() }}
        with:
          name: Test Results
          path: iris-thaumantias/reports/*.xml
          reporter: jest-junit
          fail-on-error: 'true'

      - name: Upload JUnit reports
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: junit-reports
          path: iris-thaumantias/reports/
```

**Note on `defaults.run.working-directory`:** Setting this at the job level applies to all `run` steps, avoiding repetition. Action steps (`uses:`) are unaffected and use their own path resolution.

**Note on `dorny/test-reporter` path:** The `path` is relative to the workspace root (`$GITHUB_WORKSPACE`), not the `working-directory`. So even with `defaults.run.working-directory: iris-thaumantias`, the path in `dorny/test-reporter` must be `iris-thaumantias/reports/*.xml`.

### Vitest Config with JUnit Reporter
```typescript
// Source: https://vitest.dev/guide/reporters (verified)
// vitest.config.mts additions to existing test block:
reporters: ['default', 'junit'],
outputFile: {
  junit: './reports/vitest-results.xml',
},
```

### .vscode-test.mjs Unit Label with Mocha JUnit Reporter
```javascript
// Source: @vscode/test-cli config.d.cts (verified in node_modules)
{
  label: 'unit',
  files: 'out/test/unit/**/*.test.js',
  exclude: ['out/test/unit/struggle-detection/**'],
  coverage: {
    exclude: ['**/test/**', '**/out/test/**'],
  },
  mocha: {
    reporter: 'mocha-junit-reporter',
    reporterOptions: {
      mochaFile: './reports/mocha-results.xml',
    },
  },
}
```

### ADR Template (Michael Nygard format, adapted)
```markdown
# ADR 001: E2E Test Framework Selection

**Date:** 2026-02-28
**Status:** Accepted

## Context

The extension requires E2E UI tests that launch a real VS Code instance and interact
with the Artemis webview panels using Selenium WebDriver.

## Options Considered

| Framework | Pros | Cons |
|-----------|------|------|
| vscode-extension-tester | ... | ... |
| wdio-vscode-service | ... | No sidebar webview iframe support |
| Playwright | ... | Issue #22351: no VS Code extension automation target |

## Decision

Retain `vscode-extension-tester` v8.22.0.

## Consequences

- E2E tests run locally only (no CI)
- wdio-vscode-service and Playwright are not evaluated further for this project
- Future contributors should not introduce new dependencies on the excluded frameworks
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vscode-test` (old package) | `@vscode/test-electron` + `@vscode/test-cli` | ~2022-2023 | Scoped packages are the current standard; old `vscode-test` is deprecated |
| `GabrielBB/xvfb-action` | `xvfb-run -a` (built-in to ubuntu-latest) | 2023+ | No need for third-party xvfb action; pre-installed on runner |
| `actions/upload-artifact@v3` | `actions/upload-artifact@v4` | 2024 | v4 has breaking changes (artifact names must be unique per workflow run) |
| `dorny/test-reporter@v1` | `dorny/test-reporter@v2` | 2024 | v2 handles fork PR security model better |

**Deprecated/outdated:**
- `vscode-test` (npm): Replaced by `@vscode/test-electron`. Do not reference.
- `GabrielBB/xvfb-action`: Superseded by native `xvfb-run -a` which is pre-installed.
- `actions/upload-artifact@v2` / `@v3`: Use `@v4`. Note: artifact names in v4 must be unique within a run.

## Open Questions

1. **Does `reporterOptions` pass through @vscode/test-cli to mocha-junit-reporter correctly?**
   - What we know: `Mocha.MochaOptions` includes `reporterOptions?: any` (confirmed via `@types/mocha`); `@vscode/test-cli` accepts `Mocha.MochaOptions` in the `mocha` field
   - What's unclear: Whether the CLI serializes/deserializes `reporterOptions` correctly when passing to the Mocha runner subprocess
   - Recommendation: If `reporterOptions` doesn't work, fall back to the `MOCHA_FILE` environment variable (`env: { MOCHA_FILE: './reports/mocha-results.xml' }` in the CI step), which `mocha-junit-reporter` checks automatically

2. **Does `dorny/test-reporter` handle both Vitest JUnit and Mocha JUnit XML correctly?**
   - What we know: `dorny/test-reporter` supports `jest-junit` format; Vitest's built-in JUnit reporter is `jest-junit` compatible; `mocha-junit-reporter` also outputs `jest-junit`-compatible XML
   - What's unclear: Edge cases in attribute naming between the two reporters
   - Recommendation: Test locally by generating both XML files and inspecting. If `dorny/test-reporter` fails, `mikepenz/action-junit-report` is a solid fallback.

3. **`reports/` directory creation**
   - What we know: Neither Vitest nor mocha-junit-reporter creates parent directories automatically (this varies by version)
   - What's unclear: Whether the current installed versions handle directory creation
   - Recommendation: Add a `mkdir -p iris-thaumantias/reports` step before the test steps in CI, or configure the reporters to use an existing directory.

## Sources

### Primary (HIGH confidence)
- Official VS Code CI docs (https://code.visualstudio.com/api/working-with-extensions/continuous-integration) — xvfb-run pattern, GitHub Actions workflow structure
- `@vscode/test-cli/out/config.d.cts` (installed at `node_modules/@vscode/test-cli/out/config.d.cts`) — confirmed `mocha?: Mocha.MochaOptions & { reporter?: string }` interface
- `@types/mocha/index.d.ts` (installed) — confirmed `reporterOptions?: any` in `Mocha.MochaOptions`
- Vitest reporters guide (https://vitest.dev/guide/reporters) — confirmed built-in `junit` reporter and `outputFile` object syntax
- Vitest config reference (https://vitest.dev/config/reporters) — confirmed reporters configuration

### Secondary (MEDIUM confidence)
- `dorny/test-reporter@v2` README (https://github.com/dorny/test-reporter) — action usage, permissions requirements, `jest-junit` format
- `actions/upload-artifact@v4` docs — `if: ${{ !cancelled() }}` conditional upload pattern

### Tertiary (LOW confidence)
- WebSearch findings on `mocha-junit-reporter` `reporterOptions` passthrough via `@vscode/test-cli` — unverified, flagged as Open Question 1

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via installed node_modules + official docs
- Architecture: HIGH — official VS Code CI docs confirm xvfb pattern; Vitest docs confirm junit reporter
- Pitfalls: MEDIUM — most derived from official docs + code inspection; pitfall about `reporterOptions` passthrough is LOW (not directly tested)
- ADR format: HIGH — Michael Nygard format is well-established

**Research date:** 2026-02-28
**Valid until:** 2026-04-28 (stable ecosystem; GitHub Actions actions use pinned major versions)
