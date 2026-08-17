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
├── extension/                    # VS Code extension package (npm root)
│   ├── src/
│   │   ├── extension.ts          # Entry point & activation
│   │   ├── extension/            # Extension host (Node.js)
│   │   │   ├── activation/       # Command registration, wiring
│   │   │   ├── api/              # Artemis REST API client
│   │   │   ├── controller/       # Message handling, state, routing
│   │   │   ├── dataCollection/   # Consent-gated data collection
│   │   │   ├── domain/           # Domain model classes
│   │   │   ├── provider/         # Webview providers, CodeLens
│   │   │   ├── services/         # Business logic (auth, iris, telemetry, ui, websocket, workspace)
│   │   │   ├── telemetry/        # Struggle detection & recording pipeline
│   │   │   ├── theia/            # EduIDE/Theia environment detection (data bridge)
│   │   │   ├── types/            # Domain types & ambient shims
│   │   │   └── utils/            # Shared utilities (incl. serverUrl resolution)
│   │   ├── shared/               # Cross-runtime types & message contracts
│   │   └── webview/              # React UI (components, views, stores, hooks, styles)
│   ├── test/                     # unit/ (extension host) + react/ (component) tests
│   ├── scripts/                  # Packaging & build helpers
│   └── docs/                     # DEVELOPER-GUIDE.md, ADRs, diagrams
└── recording-viewer/             # Standalone session recording viewer (Vite/React)
```

## Architecture Overview

The codebase spans three runtimes:

- **`extension/` (host, Node.js)** - services, providers, controllers, the REST client, and the telemetry pipeline.
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
| `npm run package:vsix` | Build and package the full marketplace `.vsix` |
| `npm run lint` | ESLint over `src` and `test` |
| `npm run check-types` | Type-check without emitting |
| `npm run test:vscode` | All extension host tests (vscode-test). What CI runs |
| `npm run test:struggle` | Struggle detection tests only (a subset of the above) |
| `npm run test:react` | React component tests (vitest) |
| `npm run test:all` | Extension host + React tests |

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
- **Clean build** (Open VSX, bundled into EduIDE) - built by `scripts/package-openvsx.js` from a staging directory using `scripts/generate-clean-manifest.js`. The clean variant **excludes** the struggle-detection engine, the recording pipeline, and the data-collection consent flow. In its manifest the `artemis.dataCollectionConsent` setting and the `artemis.replaySession` / `artemis.openRecordingsFolder` / `artemis.showStruggleScore` commands are **removed**, while the `artemis.struggleDetection.*` settings are **kept but defaulted to `false`**; `scripts/verify-clean-bundle.js --profile=openvsx` fails the build if any excluded code reappears in the bundle.
- **Local recording build** (not shipped) - keeps the session recorder and consent flow for local development, via `npm run package:rec` or the "Run Extension (Recording)" launch config. It is refused under CI (`resolveBuildVariant` throws when `GITHUB_ACTIONS === 'true'` or `CI === 'true'`), so it never reaches a release.

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
| [CHANGELOG.md](CHANGELOG.md) | Release notes (single source) |

## Resources

- **Artemis Platform**: [artemisapp.github.io](https://artemisapp.github.io)
- **Artemis Documentation**: [docs.artemis.cit.tum.de](https://docs.artemis.cit.tum.de)
- **Artemis Repository**: [github.com/ls1intum/Artemis](https://github.com/ls1intum/Artemis)
- **VS Code Extension Guidelines**: [code.visualstudio.com/api](https://code.visualstudio.com/api/references/extension-guidelines)
