# Developer guide

This guide covers setting up, understanding, building and releasing the Artemis Extension. How to get a change merged (branching, checks, PR titles, tests, docs) is in [CONTRIBUTING.md](CONTRIBUTING.md). User documentation is in [README.md](README.md), release notes are in [CHANGELOG.md](CHANGELOG.md).

## Contents

1. [Setup](#setup)
2. [Repository layout](#repository-layout)
3. [Architecture](#architecture)
4. [Adding a view](#adding-a-view)
5. [Conventions](#conventions)
6. [Scripts](#scripts)
7. [Running and debugging](#running-and-debugging)
8. [Documentation screenshots](#documentation-screenshots)
9. [Build variants](#build-variants)
10. [Releasing](#releasing)
11. [Other documentation](#other-documentation)

## Setup

You need Node.js 22 (the version CI uses), npm and VS Code 1.93.0 or newer. Every npm command in this guide runs from `extension/`.

```bash
git clone https://github.com/ls1intum/artemis-extension.git
cd artemis-extension/extension
npm install
npm run compile   # type-check, lint, bundle
```

Open the repository root in VS Code and press `F5`. A second window, the Extension Development Host, starts with the extension loaded; click the Artemis icon in its activity bar.

## Repository layout

```
artemis-extension/
├── README.md                     # User documentation, also the store listing
├── DEVELOPER.md                  # This file
├── CHANGELOG.md                  # Release notes, single source
├── extension/                    # The extension package (npm root)
│   ├── src/
│   │   ├── extension.ts          # Entry point and activation
│   │   ├── extension/            # Extension host (Node.js)
│   │   │   ├── activation/       # Command registration and wiring
│   │   │   ├── api/              # Artemis REST client
│   │   │   ├── controller/       # App state, view routing, webview command handlers
│   │   │   ├── dataCollection/   # Recorder seam (index.ts | recording.ts | noop.ts)
│   │   │   ├── domain/           # Domain model
│   │   │   ├── provider/         # Webview providers, CodeLens
│   │   │   ├── services/         # Business logic (see below)
│   │   │   ├── telemetry/        # Struggle-detection seam (index.ts | noop.ts)
│   │   │   ├── theia/            # EduIDE/Theia detection and data bridge
│   │   │   ├── types/            # Domain types and ambient shims
│   │   │   └── utils/            # Shared utilities, including server URL resolution
│   │   ├── shared/               # Types and message contracts used by both runtimes
│   │   └── webview/              # React UI: views, components, hooks, stores, styles
│   ├── test/                     # See the test table below
│   ├── scripts/                  # Packaging and build helpers
│   └── docs/adr/                 # Architecture decision records
└── recording-viewer/             # Standalone viewer for session recordings (Vite, React)
```

`src/extension/services/`:

| Directory | Responsibility |
|---|---|
| `auth/` | Login, token lifecycle, consent |
| `iris/` | Iris chat: conversations, context, availability |
| `struggle/` | The struggle-detection engine (severity, boundaries, decision, alerting) |
| `sensing/` | The SensorHub and its collectors, which feed the engine |
| `struggleIntervention/` | Requesting an intervention from Artemis and routing the reply |
| `intervention/` | The in-editor surfaces (inline cue, ambient lamp) |
| `recording/` | Session recorder, present only in the local recording build |
| `session/`, `ui/`, `websocket/`, `workspace/` | Session state, UI helpers, the Artemis socket, workspace and exercise tracking |

`extension/test/`:

| Directory | Runner | Contents |
|---|---|---|
| `unit/` | vscode-test | Extension host tests that need the real `vscode` API. Shared mocks are in `unit/mocks/` |
| `react/` | vitest | Rendering side: components, views, hooks, stores, flows, CSP. Helpers are described in [test/react/\_\_helpers\_\_/README.md](extension/test/react/__helpers__/README.md) |
| `logic/` | vitest | Pure logic: services, contracts, build scripts |
| `golden-replay/` | vitest | Replays recorded sessions against pinned engine output. Skips unless `IRIS_STUDY_DATA` and `GOLDEN_DIR` point at the study dataset, so it only runs locally |
| `e2e/` | vscode-test | End-to-end flows in an Extension Development Host. `e2e/ui/` holds the Selenium suite |
| `__shared__/` | | Fixtures and fakes shared across suites |

## Architecture

The code runs in three places. The extension host (`src/extension/`, Node.js) owns authentication, API calls, the WebSocket, navigation state and the struggle-detection engine. The webviews (`src/webview/`, React in a browser context) render the UI and send user actions back. `src/shared/` holds the types and message contracts both sides compile against.

### Webviews

There are two webview providers, both in `src/extension/provider/`:

- `ArtemisWebviewProvider` renders the main sidebar: login, dashboard, course list, course detail, exercise detail, submission setup and the struggle-detection debug view.
- `ChatWebviewProvider` renders the Iris chat.

Both load the same React bundle. The extension host picks the view: `controller/viewRouter.ts` maps the current `AppState` to a view name, the HTML it renders carries that name in a `data-view` attribute on `#root`, and `webview/App.tsx` switches on it.

A view becomes usable in four steps:

1. The host renders the HTML with `data-view` set.
2. React mounts. Each view registers its message listener in a `useEffect`.
3. `App.tsx` posts `{ type: 'ready' }`. It is the only place that sends this signal. Child effects run before parent effects, so every listener is in place by then.
4. The host answers with the init message for the current state (`services/ui/viewInitDataService.ts`).

A view must not send its own ready signal.

### Message contracts

All traffic between host and webview is typed in `src/shared/messageContracts/`:

- `extensionMessages.ts`: host to webview. Each message type is a key in the `ExtensionMsg` constant and an interface in the `ExtensionToWebviewMessage` union.
- `webviewCommands.ts`: webview to host. User actions are `{ type: 'command', command, payload }`, with the command names in the `WebviewCmd` constant. A command whose payload is required must also be listed in `PAYLOAD_REQUIRED`.
- `typeGuards.ts`: `isExtensionMessage` and `isWebviewMessage`. They read their allowed values from those constants, so a new message needs no change here.

On the webview side, `hooks/useExtensionMessage.ts` registers a listener that only passes on messages the guard accepts. On the host side, `controller/webViewMessageHandler.ts` collects the handler maps of the command modules in `controller/commands/` and dispatches each command to its handler.

### Stores

The webview keeps UI state in Zustand stores in `src/webview/stores/`: `useDashboardStore`, `useCourseListStore`, `useCourseDetailStore`, `useExerciseDetailStore` and `useChatStore`. Each is created with `create<State>()(devtools(...))` and names its actions as the third argument to `set()`.

The extension host is the source of truth and sends a view's data again whenever the view loads. Stores do not depend on each other; if two views need the same data, the host sends it to both. State that has to survive the webview being hidden goes through `vscodeApi.getState()` / `setState()`, as `CourseDetailView` does.

### Build seams

The struggle engine and the session recorder are left out of some builds (see [Build variants](#build-variants)). esbuild aliases decide what each build gets:

| Alias | Full build | Excluded |
|---|---|---|
| `@telemetry` | `telemetry/index.ts` | `telemetry/noop.ts` (Open VSX) |
| `@dataCollection` | `dataCollection/recording.ts` (local recording build) | `dataCollection/noop.ts` (every shipped build) |
| `@struggleView` | `views/StruggleDetection/index.ts` | `views/StruggleDetection/stub.tsx` (Open VSX) |

Code outside a seam must not import the engine or the recorder at runtime; type-only imports are fine. [ADR 003](extension/docs/adr/003-theia-openvsx-telemetry-seam.md) has the reasoning.

### EduIDE and Theia

The extension runs in desktop VS Code and in EduIDE, a browser-based managed Theia. In EduIDE it reads the server and credentials from the EduIDE data bridge (`DATA_BRIDGE_ENABLED` and the `dataBridge.getEnv` command) instead of the local settings, and authenticates with a Bearer token, while desktop uses the `jwt` cookie.

`resolveServerUrl()` in `src/extension/utils/serverUrl.ts` returns the active server: the data bridge's `ARTEMIS_URL` in Theia, the `artemis.serverUrl` setting otherwise. Every server-facing link ("Open in Artemis", problem-statement assets) goes through it, so links point at the connected server instead of the configured default.

## Adding a view

1. Create `src/webview/views/YourView/` with `YourViewView.tsx`, `YourViewView.module.css` and an `index.ts` that exports the view. View-specific types go in `types.ts`, view-only components in `components/`.
2. Add the host-to-webview init message and any new commands to the message contracts, as described above.
3. If the view needs state beyond `useState`, add a store in `src/webview/stores/` following the existing ones.
4. In the view, register the listener with `useExtensionMessage` and read the init message into the store or local state.
5. Add a `case` for the view name in `src/webview/App.tsx`.
6. Add the state to the `AppState` union in `controller/appStateManager.ts` and to `STATE_TO_VIEW` in `controller/viewRouter.ts`.
7. Send the init data from `services/ui/viewInitDataService.ts` for the new state.
8. Handle the new commands in the matching module in `controller/commands/`, or add a module and register it in `webViewMessageHandler.ts`.

## Conventions

### Imports

Imports that leave the current directory use path aliases; sibling imports (`./foo`) stay relative. ESLint rejects relative imports that go upward, including in dynamic `import()`, `require()` and `vi.mock()`, and it rejects `@webview` imports from host code and the other way round.

| Alias | Maps to |
|---|---|
| `@extension/*` | `src/extension/*` |
| `@webview/*` | `src/webview/*` |
| `@shared/*` | `src/shared/*` |
| `@test/*` | `test/*` |
| `@root/package.json` | `package.json` (the only valid `@root/` target) |

```typescript
import { Button } from '@webview/components/Button';
import { logger } from '@extension/services/loggingService';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';
```

Use `import type` for imports that are only types.

### TypeScript

`strict` is on. Use `unknown` and a type guard where a value's type is not known, not `any`. Messages and similar variants are discriminated unions.

### React components

- Views end in `View` (`LoginView`); components carry no suffix (`Button`, `Dropdown`). Hooks and stores start with `use`.
- Every component has a props interface.
- Event props pass values, not DOM events: `onChange={(value) => ...}`. That keeps handlers testable without building events.
- Do not use `dangerouslySetInnerHTML`. Inline SVG or import it as a component.

### Styling

Every component has its own CSS Module next to it (`Button.module.css` for `Button.tsx`). Class names are camelCase so they read as `styles.errorMessage`. Combine conditional classes with `clsx`.

Colors come from the VS Code theme variables (`var(--vscode-editor-background)`, `var(--vscode-button-background)` and so on, see the [theme color reference](https://code.visualstudio.com/api/references/theme-color)). Check every UI change in a light and a dark theme.

## Scripts

| Script | Purpose |
|---|---|
| `npm run compile` | Type-check, lint and bundle (development) |
| `npm run watch` | esbuild and `tsc` in watch mode |
| `npm run package` | Production bundle: type-check, lint `src`, minified esbuild |
| `npm run package:vsix` | Package the desktop `.vsix` (VS Marketplace) |
| `npm run package:openvsx` | Package the clean `.vsix` (Open VSX, EduIDE) |
| `npm run package:rec` | Build the local recording variant. Refused under CI |
| `npm run check-types` | Type-check without emitting |
| `npm run lint` | ESLint over `src` and `test` |
| `npm run knip` | Unused files, exports and dependencies |
| `npm run test:vscode` | Extension host tests, as CI runs them. Needs `compile-tests` and `node esbuild.js` first |
| `npm run test:react` | vitest over `test/react` and `test/logic` |
| `npm run test:all` | `test:vscode`, then `test:react` |
| `npm run test:e2e` | End-to-end suite in an Extension Development Host |
| `npm run test:ui` | Selenium UI suite (`test/e2e/ui/run-tests.sh`, reads credentials from `extension/.env`) |
| `npm run screenshots:docs` | Screenshots for the student guide in the Artemis documentation, see [Documentation screenshots](#documentation-screenshots) |
| `npm run test:golden-replay` | Replay recorded sessions against the pinned engine output |
| `npm run coverage:all` | Coverage for the extension host and vitest suites |
| `npm run analyze` | Bundle treemap of the webview, from `dist/meta-webview.json` (`analyze:ext` for the host bundle) |
| `npm run clean` | Remove `dist/`, `out/` and `.vsix` files |

## Running and debugging

The launch configurations in `.vscode/launch.json`:

- Run Extension: builds in watch mode and recompiles on change. Use this one by default.
- Run Extension (No Watch): runs the last build.
- Run Extension (Recording): watch build with the session recorder and the data-collection consent flow, for recorder and replay work.
- Extension Tests: compiles the tests and runs the extension host suite.

Breakpoints set in the TypeScript sources work in the host. Logs go to the "Artemis Extension" output channel. `Ctrl+Shift+F5` restarts the host with the new build. For the React side, run "Developer: Open Webview Developer Tools" from the command palette of the Extension Development Host.

## Documentation screenshots

The student guide in the Artemis documentation (`documentation/docs/student/tools-reference/vscode-extension/` in
ls1intum/Artemis) shows the extension in screenshots. `npm run screenshots:docs` takes all of them in one run: it
drives the extension through the Selenium UI suite (`test/e2e/ui/docsScreenshots.shots.ts`) and writes one PNG per
image to `extension/reports/docs-screenshots/`, under the names the guide imports. Each image is a crop of one element
(the sidebar, the editor, or a single banner), as the Artemis documentation guideline asks.

The run needs a local Artemis with a demo course, because the guideline asks for realistic data and the run changes
the student's repository. It reads `extension/.env.docs.local` (git-ignored) instead of `.env`:

```bash
ARTEMIS_URL=http://localhost:8080
ARTEMIS_USER=lena.fischer
ARTEMIS_PASSWORD=...
ARTEMIS_TEST_REPO=/path/to/the/student/checkout/of/the/sorting/exercise
GIT_CONFIG_GLOBAL=/path/to/a/gitconfig/with/the/student/name/and/email
```

`GIT_CONFIG_GLOBAL` keeps your own Git identity out of the Submission Setup screenshot.

The demo data the shots expect, on a local Artemis with LocalCI, Docker and Iris (Pyris) running:

- A course "Introduction to Software Engineering" (semester WS26/27, running), with Iris and proactive help enabled
  in its Iris settings.
- An archived course "Fundamentals of Programming" (WS25/26, end date passed) with one exercise.
- An internal student account "Lena Fischer" (`lena.fischer`) enrolled in both, who has made the AI choice (Cloud).
- In the running course: the Java template exercise "Sorting with the Strategy Pattern", started by the student,
  with `SortStrategy` and `BubbleSort` implemented and `MergeSort` empty, so the latest result is 5 of 13 tests; a
  programming exercise "Freelancer Project Scheduling" the student has not started; a text exercise "Design Pattern
  Reflection".
- The student's checkout of the sorting exercise at `ARTEMIS_TEST_REPO`, with the participation access token in the
  remote URL, as the extension's own clone would have it.

The run breaks `BubbleSort.java` for the build-failure shots and submits the repaired file again afterwards, also
when a capture fails, so the exercise ends with the same result it started with (two submissions later). It refuses
to run against anything but a local Artemis, since it publishes what it captures. Proactive help is shown through the visual mocks of the developer
intervention menu, for which the run switches developer mode on and off again. Copy the PNGs into
`documentation/docs/student/assets/vscode-extension/` in the Artemis repository and check them before committing:
a screenshot can be wrong in ways no assertion catches.

## Build variants

The same source produces two shipped packages and one local-only build:

| Variant | Command | Struggle engine | Recorder and consent flow | Ships to |
|---|---|---|---|---|
| Desktop | `package:vsix` (`scripts/package-desktop.js`) | yes | no | VS Marketplace |
| Clean | `package:openvsx` (`scripts/package-openvsx.js`) | no | no | Open VSX, bundled into EduIDE |
| Recording | `package:rec`, or the "Run Extension (Recording)" launch config | yes | yes | nowhere |

Both shipped packagers build in a staging directory and check the bundle with `scripts/verify-clean-bundle.js`, which fails the build if excluded code shows up in it. The recording build refuses to run when `GITHUB_ACTIONS` or `CI` is `true` (`scripts/resolveBuildVariant.js`), so it cannot reach a release.

### The staged manifest

`scripts/generate-clean-manifest.js` writes the staged `package.json` and leaves the source manifest alone. The `desktop` profile only drops the recorder contributions. The `openvsx` profile drops more and changes defaults:

- Recorder group (both profiles): the `artemis.dataCollectionConsent` setting and the `artemis.replaySession` and `artemis.openRecordingsFolder` commands.
- Struggle group (Open VSX): the `artemis.iris.proactiveCodeEgress` setting and the `artemis.forceStruggleIntervention` and `artemis.toggleStruggleWarmupSkip` commands.
- Walkthrough (Open VSX): the getting-started walkthrough. In EduIDE every step but "Meet Iris" is already done for the student.
- Cloud defaults (Open VSX): `artemis.startPage` becomes `workspace-exercise`, and `artemis.showStartPageSuggestion` and `artemis.showSetDefaultClonePathPrompt` become `false`, because the EduIDE workspace is provisioned in advance. See [ADR 002](extension/docs/adr/002-theia-openvsx-setting-defaults.md). Renaming one of these settings without updating the override fails the build.
- The `vscode:prepublish` hook is removed, so packaging the staged manifest does not run the doc sync or a second bundle.

A command whose handler lives in the struggle or recorder code has to be added to the matching drop list. Otherwise EduIDE shows a palette entry that fails with "command not found". `test/logic/scripts/generateCleanManifest.test.ts` catches the common case: for each profile it fails if a shipped command's id appears only in code that profile excludes. Settings have no such test yet.

### Store listing

The store listings show the repo-root `README.md` and `CHANGELOG.md`. Both packagers copy them into the staging directory. A plain `vsce package` (the `vscode:prepublish` hook, used by the recording build) runs `scripts/sync-marketplace-docs.js` instead, which writes `extension/README.md` and `extension/CHANGELOG.md`. Those two files are generated and git-ignored; edit the root copies.

## Releasing

`.github/workflows/release-openvsx.yml` ("Release to Open VSX and VS Marketplace") is started by hand from `main` or `dev`. It checks the branch, that the version matches `extension/package.json`, that `CHANGELOG.md` has a section for it and that the commit has a green `CI gate`. Then it builds both packages with build provenance, publishes to Open VSX and the VS Marketplace, tags the commit and creates a GitHub release from the changelog section. After a successful Open VSX publish it dispatches EduIDE's `artemis_extension_auto_update.yml`, which opens a PR there bumping the bundled extension. Reviewing, merging and deploying that PR is done by hand in EduIDE.

### Cutting a release

1. Bump `version` in `extension/package.json` (`npm version X.Y.Z --no-git-tag-version` also updates the lockfile), add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`, and merge both into `dev` with a pull request.
2. Sync `dev` into `main` with a real merge commit. A squash has no parent link to `dev`, so the next sync computes its merge base from an old release and runs into conflicts in files the release never touched. The repository allows only squash merges in the GitHub UI, so do the merge locally and push it (this needs admin rights, since `main` is protected):

   ```bash
   git fetch origin
   git checkout -B sync-main origin/main
   git merge --no-ff origin/dev -m "chore(release): sync dev → main for X.Y.Z (#PR)"
   # the tree must equal dev's, and dev must be the second parent
   [ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse origin/dev^{tree})" ] && echo "tree ok"
   git log -1 --format='%P'
   git push origin HEAD:main
   ```

   Before pushing, open a sync PR with `--base main --head dev` so the release has a PR and CI runs on it. GitHub marks it as merged once the push lands. Do not delete its head branch afterwards; it is `dev`. If the merge conflicts, resolve it so that `main` ends up identical to `dev`.
3. Wait until CI is green on the commit you release. The workflow fails right away if that SHA has no `CI gate` check yet, which happens when you dispatch straight after a push.
4. Under Actions, run "Release to Open VSX and VS Marketplace" on `main` with the exact version and both publish toggles on. Tick "Dry run" to build and validate without publishing. Running it on `dev` is for a hotfix of work that is not on `main` yet.
5. Approve the `production` environment when GitHub asks.

Release tags have no `v` prefix (`1.2.2`).

### If one store fails

The release job waits until both publish jobs have finished, including a pending `production` approval. If one of them published, the tag and the GitHub release are still created, because that version is already live in one store and cannot be withdrawn.

Catch the failed store up with "Re-run failed jobs" on the same run. A new dispatch of the same version fails at "Verify tag does not already exist". The re-run reuses the original artifacts (kept 30 days) and may ask for the `production` approval again. It also re-runs the release and EduIDE jobs, which does no harm: the release job updates the existing release, both publish steps are idempotent, and the EduIDE workflow updates its open bump PR or exits if the bump is already merged.

## Other documentation

| File | Contents |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow for getting a change merged |
| [extension/docs/adr/](extension/docs/adr/) | Architecture decision records |
| [extension/src/extension/services/recording/README.md](extension/src/extension/services/recording/README.md) | The session recorder |
| [extension/test/react/\_\_helpers\_\_/README.md](extension/test/react/__helpers__/README.md) | Helpers for the React tests |
| [recording-viewer/README.md](recording-viewer/README.md) | The standalone recording viewer |

Design specs and implementation plans for a single change are kept out of the repository (`docs/superpowers/`, `extension/docs/superpowers/` and `extension/docs/plans/` are git-ignored). Reasoning that should outlast a pull request goes into the code, an ADR or the issue.
