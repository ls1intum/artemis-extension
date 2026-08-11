# Artemis VS Code Extension - Developer Guide

> User documentation lives in **[README.md](README.md)**. The contribution workflow is in **[CONTRIBUTING.md](CONTRIBUTING.md)**. For a deep dive into the webview architecture, message contracts, and stores, see **[extension/docs/DEVELOPER-GUIDE.md](extension/docs/DEVELOPER-GUIDE.md)**.

This guide covers building, running, and shipping the extension. The codebase is a React-based webview UI driving a VS Code extension host, bundled with esbuild and communicating over a typed message contract.

## Prerequisites

- **Node.js** v22.x or higher
- **npm**
- **VS Code** version 1.93.0 or higher
- *(Optional, for packaging)* `vsce`: `npm install -g @vscode/vsce`

## Getting Started

All npm commands run from the `extension/` directory.

```bash
# 1. Clone
git clone https://github.com/ls1intum/artemis-extension.git
cd artemis-extension/extension

# 2. Install dependencies
npm install

# 3. Compile (type-check + lint + bundle)
npm run compile

# 4. Watch for changes during development
npm run watch
```

Then press `F5` in VS Code to launch the extension (see [Running Locally](#running-locally)).

## Repository Layout

```
artemis-extension/
├── README.md                     # User documentation (also shipped to the stores)
├── DEVELOPER.md                  # This file
├── CONTRIBUTING.md               # Contribution workflow
├── CHANGELOG.md                  # Single source of truth for release notes
├── scripts/                      # Repo-level release helpers (shell)
├── extension/                    # VS Code extension package (npm root)
│   ├── src/
│   │   ├── extension.ts          # Entry point & activation
│   │   ├── extension/            # Extension host (Node.js)
│   │   │   ├── activation/       # Command registration, wiring
│   │   │   ├── api/              # Artemis REST API client
│   │   │   ├── controller/       # Message handling, state, routing
│   │   │   ├── dataCollection/   # Consent-gated data collection (seam: index.ts | noop.ts)
│   │   │   ├── domain/           # Domain model classes
│   │   │   ├── provider/         # Webview providers, CodeLens
│   │   │   ├── services/         # Business logic (see below)
│   │   │   ├── telemetry/        # Struggle-detection seam & wiring (seam: index.ts | noop.ts)
│   │   │   ├── theia/            # EduIDE/Theia environment detection (data bridge)
│   │   │   ├── types/            # Domain types & ambient shims
│   │   │   └── utils/            # Shared utilities (incl. serverUrl resolution)
│   │   ├── shared/               # Cross-runtime types & message contracts
│   │   └── webview/              # React UI (components, views, stores, hooks, styles)
│   ├── test/                     # See "Tests" below
│   ├── scripts/                  # Packaging & build helpers
│   └── docs/                     # DEVELOPER-GUIDE.md, ADRs, diagrams
└── recording-viewer/             # Standalone session recording viewer (Vite/React)
```

### `src/extension/services/`

| Directory | Responsibility |
|---|---|
| `auth/` | Login, token lifecycle, consent |
| `iris/` | Iris chat: conversations, context, availability |
| `struggle/` | The struggle-detection engine (severity, boundaries, decision, alerting) |
| `sensing/` | The SensorHub and its collectors, feeding the engine |
| `struggleIntervention/` | Requesting an intervention from Artemis and routing the reply |
| `intervention/` | The in-editor surfaces (inline cue, ambient lamp) |
| `recording/` | Session recorder (local recording build only) |
| `session/`, `ui/`, `websocket/`, `workspace/` | Session state, UI helpers, the Artemis socket, workspace/exercise tracking |

No always-bundled code imports the struggle engine or the recorder as a runtime dependency
(type-only imports are fine; the seam's own implementation naturally imports them). Both sit
behind the `@telemetry` and `@dataCollection` esbuild aliases, which resolve to a `noop.ts` in
the builds that exclude them (see
[Build Variants](#build-variants--deployment) and
[ADR 003](extension/docs/adr/003-theia-openvsx-telemetry-seam.md)).

### Tests

| Directory | Runner | Contents |
|---|---|---|
| `test/unit/` | `vscode-test` | Extension-host tests needing the real `vscode` API |
| `test/react/` | vitest | Everything rendering-side: components, views, hooks, stores, flows, CSP |
| `test/logic/` | vitest | Pure-logic tests (services, contracts, build scripts) |
| `test/golden-replay/` | vitest | Replays recorded sessions against pinned engine output. Local only: it skips unless `IRIS_STUDY_DATA` and `GOLDEN_DIR` point at the study dataset |
| `test/e2e/` | `vscode-test` | End-to-end flows in a real Extension Development Host |
| `test/__shared__/` | - | Fixtures and fakes shared across suites |

## Architecture Overview

The codebase spans three runtimes:

- **`extension/` (host, Node.js)** - services, providers, controllers, the REST client, and the struggle-detection engine behind its build seam.
- **`webview/` (React)** - page-level views and components rendered in VS Code webview panels, with Zustand stores hydrated from extension messages.
- **`shared/`** - types and the typed message contracts used by both sides.

UI styling uses CSS Modules scoped per component, integrated with VS Code themes via native CSS custom properties.

For the detailed walkthrough (adding a view, the message-contract system, store architecture, the build pipeline), read **[extension/docs/DEVELOPER-GUIDE.md](extension/docs/DEVELOPER-GUIDE.md)**.

## Scripts

Run from `extension/`:

| Script | Purpose |
|--------|---------|
| `npm run compile` | Type-check, lint, and bundle (dev) |
| `npm run watch` | Watch mode (esbuild + tsc) |
| `npm run package` | Production bundle (type-check + lint + esbuild `--production`) |
| `npm run package:vsix` | Build and package the full Desktop `.vsix` (VS Marketplace) |
| `npm run package:openvsx` | Build and package the clean `.vsix` (Open VSX / EduIDE) |
| `npm run package:rec` | Build the local recording variant (local only: the build itself is refused under CI) |
| `npm run lint` | ESLint over `src` and `test` |
| `npm run check-types` | Type-check without emitting |
| `npm run knip` | Dead-code / unused-export check (its own CI job) |
| `npm run test:unit` | Extension host tests (vscode-test) |
| `npm run test:react` | vitest: `test/react/` **and** `test/logic/` |
| `npm run test:all` | `test:unit` + `test:react` |
| `npm run test:golden-replay` | Replay recorded sessions against the pinned engine output |
| `npm run test:e2e` | End-to-end suite in an Extension Development Host |
| `npm run coverage:all` | Coverage for both main suites |

## Running Locally

1. Open the project in VS Code.
2. Press `F5` (or Run → Start Debugging).
3. A new Extension Development Host window opens with the extension loaded.
4. Click the Artemis icon in the activity bar to test.

### Launch configurations

- **Run Extension** (recommended) - starts watch mode and recompiles on change.
- **Run Extension (No Watch)** - runs without auto-recompilation.
- **Run Extension (Recording)** - starts the local-recording watch build (session recorder and consent flow present) for recorder/replay development. Not for release builds.
- **Extension Tests** - compiles tests, then runs the suite.

### Debugging

- Set breakpoints in the gutter next to TypeScript line numbers.
- Inspect via the Debug Console, Variables, and Call Stack panels.
- Check the "Artemis" / "Extension Host" output panels for logs.
- Use Restart (`Ctrl+Shift+F5`) to reload the extension with changes.

## Build Variants & Deployment

### Three build variants

The release ships **two** packages from the same source, plus a third **local-only** variant for recorder development:

- **Full build** (VS Marketplace) - built by `scripts/package-desktop.js` from a staging directory using `scripts/generate-clean-manifest.js`. The Desktop VSIX now also **excludes** the session recorder and the data-collection consent flow while keeping the struggle-detection engine; `scripts/verify-clean-bundle.js` fails the build if the recorder reappears in the bundle.
- **Clean build** (Open VSX, bundled into EduIDE) - built by `scripts/package-openvsx.js` from a staging directory using `scripts/generate-clean-manifest.js`. The clean variant **excludes** the struggle-detection engine, the recording pipeline, and the data-collection consent flow. `scripts/verify-clean-bundle.js --profile=openvsx` fails the build if any excluded code reappears in the bundle.
- **Local recording build** (not shipped) - keeps the session recorder and consent flow for local development, via `npm run package:rec` or the "Run Extension (Recording)" launch config. It is refused under CI (`resolveBuildVariant` throws when `GITHUB_ACTIONS === 'true'` or `CI === 'true'`), so it never reaches a release.

#### What the clean manifest changes

`generate-clean-manifest.js` rewrites `package.json` into the staging directory without touching the source manifest. Three things happen there:

- **Dropped contributions.** Both profiles drop the recorder group: the `artemis.dataCollectionConsent` setting and the `artemis.openRecordingsFolder` command. Open VSX additionally drops the struggle commands, whose handlers live in excluded code: `artemis.showStruggleScore`, `artemis.forceStruggleIntervention`, `artemis.toggleStruggleWarmupSkip`. Contributing one of these without its handler puts a palette entry in EduIDE that fails with "command not found", so **a new command in the struggle or recorder modules must be added to the matching drop list**. `test/logic/scripts/generateCleanManifest.test.ts` guards that: for each profile it classifies every source file with `verify-clean-bundle.js`'s own predicate, then fails if a shipped command's id occurs only in the code that profile drops. That is a necessary condition, not a proof that a handler exists, but it catches the failure that actually occurs here. The legacy `artemis.struggleDetection.enabled` / `artemis.struggleDetection.showInterventions` settings are not part of this: they were removed from the extension entirely (#352).
- **Cloud defaults (Open VSX only).** Three settings keep their entry but ship a different default, because the EduIDE workspace is pre-provisioned: `artemis.startPage` becomes `workspace-exercise`, and `artemis.showStartPageSuggestion` / `artemis.showSetDefaultClonePathPrompt` become `false`. See [ADR 002](extension/docs/adr/002-theia-openvsx-setting-defaults.md). Renaming one of these settings without updating the override fails the build rather than silently losing it.
- **The `vscode:prepublish` hook is deleted**, because the staged manifest is packaged as-is and must not re-run the doc sync or a second bundle.

The equivalent guarantee does **not** yet exist for settings. `artemis.iris.proactiveCodeEgress` still ships in the Open VSX manifest although the only code that acts on it (`services/struggleIntervention/proactiveEgressConsent.ts`) is excluded there. It is inert rather than broken - the card that links to it never renders without the engine - but it is a setting describing an absent feature.

### EduIDE / Theia integration

The extension runs both in desktop VS Code and inside EduIDE (browser-based, managed Theia). In a managed environment it reads the connected server and credentials from the EduIDE **data bridge** (`DATA_BRIDGE_ENABLED` + the `dataBridge.getEnv` command) instead of the local config. `resolveServerUrl()` (`src/extension/utils/serverUrl.ts`) is the single source of truth for the active server: it returns the data-bridge `ARTEMIS_URL` in Theia, otherwise the `artemis.serverUrl` setting. All server-facing links ("Open in Artemis", problem-statement assets) resolve through it, so they point at the connected server rather than the config default.

### Release & auto-deploy

Releasing is driven by `.github/workflows/release-openvsx.yml` (manual `workflow_dispatch` from `main` or `dev`):

1. Validates the branch, version (must match `extension/package.json`), changelog section, and the green CI gate.
2. Builds both VSIX variants and attaches build provenance.
3. Publishes to Open VSX and/or the VS Marketplace, then tags and creates a GitHub release with the changelog notes.
4. On a successful **Open VSX** publish, dispatches EduIDE's `artemis_extension_auto_update.yml`, which opens a PR bumping the bundled extension version. Reviewing, merging, building, and deploying in EduIDE stay manual.

### Cutting a release

1. Bump the `version` in `extension/package.json` and add the matching `## [x.y.z]` section to `CHANGELOG.md`; merge to `dev` (or `main`).
2. For a normal release, sync `dev` into `main` **with a real merge commit, never a squash**. A squash carries no parent link, so `main` never gets `dev` as an ancestor and the next sync computes its merge base from the release before it. The 0.4.7 and 0.4.8 syncs were squashed, and by 0.4.9 that produced conflicts in eight files that had nothing to do with the release. If the sync PR conflicts for this reason, the resolution is "main becomes dev": the tree should end up identical to `dev`, with `dev` recorded as the second parent.

   **The GitHub UI cannot do this.** The repository allows squash merges only (`allow_merge_commit` is off), so the merge button on the sync PR would undo the point of the step and the API rejects `--merge` outright. Do it locally and push, which also lets you verify the result before it reaches `main`:

   ```bash
   git fetch origin
   git checkout -B sync-main origin/main
   git merge --no-ff origin/dev -m "chore(release): sync dev → main for X.Y.Z (#PR)"
   # verify before pushing: the tree must equal dev's, and dev must be a parent
   [ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse origin/dev^{tree})" ] && echo "tree ok"
   git log -1 --format='%P'   # two parents: main, then dev
   git push origin HEAD:main
   ```

   The push goes straight at a protected branch and needs admin rights. Open the sync PR anyway (`--base main --head dev`): it carries the release notes and CI runs on it, and GitHub closes it as merged once the push lands. Do **not** delete the branch afterwards, since the head branch is `dev` itself.
3. Wait for CI to finish on the commit you are about to release. The workflow requires a green `CI gate` check run on that exact SHA and fails immediately if none exists yet, which is easy to trip by dispatching straight after a push.
4. Go to **Actions → "Release to Open VSX and VS Marketplace" → Run workflow**.
5. Pick the branch (`main` for a normal release, `dev` for an ad-hoc / hotfix release of pre-merge work), enter the exact `version` (must match `package.json`), and leave both publish toggles on - or tick **Dry run** to build and validate only.
6. Approve the `production` environment gate when prompted.
7. On success the workflow tags the commit, creates the GitHub release with the changelog notes, and (after the Open VSX publish) dispatches the EduIDE bundled-extension bump PR.

### Marketplace docs are generated

The store listings show the repo-root **`README.md`** (user docs) and **`CHANGELOG.md`**. At package time both shipped packagers (`scripts/package-desktop.js`, `scripts/package-openvsx.js`) copy them from the repo root into their staging directory, so the listing matches the release. A plain non-staged `vsce package` (e.g. the `vscode:prepublish` hook used by the local recording build) instead runs `scripts/sync-marketplace-docs.js`, which generates `extension/README.md` and `extension/CHANGELOG.md`. Those `extension/` copies are therefore **generated and git-ignored** - edit only the repo-root copies.

## Documentation Map

| File | Audience / purpose |
|------|--------------------|
| [README.md](README.md) | Users (also the store listing) |
| [DEVELOPER.md](DEVELOPER.md) | This guide: build, run, release |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution workflow & conventions |
| [extension/docs/DEVELOPER-GUIDE.md](extension/docs/DEVELOPER-GUIDE.md) | Deep dive: webview architecture, message contracts, stores |
| [recording-viewer/README.md](recording-viewer/README.md) | The standalone session recording viewer |
| [extension/docs/adr/](extension/docs/adr/) | Architecture decision records |
| [CHANGELOG.md](CHANGELOG.md) | Release notes (single source) |

Per-change design specs and implementation plans are **not** in the repository. They are working
notes for one change and age out as soon as it lands, so `docs/superpowers/`,
`extension/docs/superpowers/` and `extension/docs/plans/` are git-ignored. Rationale that should
outlive a pull request belongs in the code, in an ADR, or on the issue.

## Resources

- **Artemis Platform**: [artemisapp.github.io](https://artemisapp.github.io)
- **Artemis Documentation**: [docs.artemis.cit.tum.de](https://docs.artemis.cit.tum.de)
- **Artemis Repository**: [github.com/ls1intum/Artemis](https://github.com/ls1intum/Artemis)
- **VS Code Extension Guidelines**: [code.visualstudio.com/api](https://code.visualstudio.com/api/references/extension-guidelines)
