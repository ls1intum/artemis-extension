# Design: Recorder as a local-only build variant (issue #336)

Date: 2026-07-15
Branch: `feat/336-recorder-local-flag` (off `dev`)
Issue: ls1intum/artemis-extension#336 — "Retire the session recorder: exclude it from the desktop build too"
Reviewed by: codex (gpt-5.6-sol, high) — round 1 findings incorporated.

## 1. Goal

The session recorder and its data-collection consent flow existed only to collect
study data. Collection is finished, so no **shipped** VSIX needs them. Make every
shipped build (Desktop/Marketplace **and** Open VSX) exclude the recorder + consent,
while keeping struggle detection + interventions in the Desktop build. The recorder
must stay buildable **locally** as an explicit, fail-safe build variant that can never
be produced by the CD pipeline. Ship early on `dev`, independent of the large
struggle-v3 PR #335.

## 2. Requirements

1. Recorder + consent excluded from every shipped VSIX (Desktop and Open VSX).
2. Struggle detection + proactive interventions **stay** in the Desktop build.
3. The recorder is a **local-only build variant**: producible only when a developer
   builds locally, and **impossible** to enable from the CD pipeline (fail-safe, not
   convention-only).
4. A usable **local** recording build must remain possible (a packageable VSIX, not
   just an F5 dev session).
5. Recorder feature **source** stays in the repo (recording-viewer, replay tooling,
   golden-replay tests). This issue changes build *output*, not source deletion.
6. Must stay compatible with the struggle-v3 branch: after #336 lands on `dev` and the
   struggle branch rebases on top, nothing struggle-related breaks, and the rebase cost
   is minimized.

### 2.1 What "excluded" means here (scope decision A)

"Excluded" = **no recording persistence, no replay, no consent flow, no recorder
wiring** in the shipped bundle. It does **not** (in this issue) mean removing the
recorder-only *instrumentation* that still exists outside the `@dataCollection` seam
(e.g. `useProblemStatementTracking`, the chat-content emitter in `chatWebviewProvider`,
the submission-event construction in `repositorySubmitCommands`). With the recorder
wiring gone (noop seam), those events still reach command handlers / `EventEmitter`s but
have **no recorder consumer, no disk persistence, and no external network egress** — so
they are inert. This exactly matches the **current** Open VSX "clean"
build, which already ships this dormant instrumentation and is considered clean.
Fully gating the dormant instrumentation is deferred to the later "delete the recorder
source" follow-up (and would have to be applied to Open VSX too). See §6, §7.

## 3. Current state on `dev` (the implementation target)

Two build variants exist, selected by `--variant=` / `IRIS_BUILD_VARIANT`
(default `full`) in `extension/esbuild.js`:

| Variant | `@dataCollection` | `@telemetry` | `@struggleView` | `__IRIS_RECORDING__` |
|---|---|---|---|---|
| `full` (Desktop/Marketplace) | real | real | real | `true` |
| `openvsx` (EduIDE clean) | noop | noop | stub | `false` |

- **Seam target `@dataCollection` → `dataCollection/index.ts`** wires the recorder +
  `ConsentService` + palette commands (`replaySession`, `openRecordingsFolder`). The
  noop target imports none of it, so esbuild tree-shakes the recorder subtree out.
- **Recorder subtree on `dev`:** nested under `services/telemetry/`
  (`services/telemetry/recording/`, `services/telemetry/replay/`) + `services/auth/consentService.ts`
  + `activation/sessionRecorderWiring.ts`. (On the struggle branch it is a **separate**
  `services/recording/`; see §7.)
- **`generate-clean-manifest.js`** (openvsx only) deletes `artemis.dataCollectionConsent`,
  defaults `artemis.struggleDetection.*` OFF, drops commands `replaySession` /
  `openRecordingsFolder` / `showStruggleScore`, applies cloud setting defaults, removes
  `vscode:prepublish`.
- **`verify-clean-bundle.js`** (fail-closed) reads the `-openvsx` metafiles and forbids
  the whole `services/telemetry/` subtree (allow `types.ts`) + `consentService.ts` +
  `sessionRecorderWiring.ts` + the non-stub `StruggleDetection` view files.
- **`package-openvsx.js`** builds openvsx, stages, generates the clean manifest, packages
  from staging (source `package.json` never mutated).
- **Packaging entry points:** the Desktop/Marketplace VSIX is built with `vsce package`
  from the **source** manifest (recorder commands included). CI (`ci.yml` `build` job)
  and release (`release-openvsx.yml` `build` job) both do `npm run package` →
  `vsce package` for Desktop and verify only the **openvsx** bundle.
  `release-openvsx.yml` publishes to **both** VS Marketplace and Open VSX.

### 3.1 Compatibility proof (verified on `dev`, confirmed by codex)

- Struggle detection code does not value-import the recorder subtree.
- The real `@telemetry` target (`telemetry/index.ts` → `services/telemetry` barrel →
  `TelemetryManager`) has no runtime path into recording/replay/consent. So Desktop
  (`@telemetry` real + `@dataCollection` noop) tree-shakes the recorder out while
  keeping the engine.
- The `SubmissionPayload` imports in the providers/interface/submit commands are
  genuinely `import type` and erase.
- `ConsentService` (recorder consent) is a different service from `ProactiveEgressConsent`
  (proactive code-reading consent). Removing the former does not touch the latter.

## 4. Design

### 4.1 Three mutually-exclusive build variants (decision 2)

Replace the two-variant + implicit-flag model with a single explicit enum. This
eliminates invalid combinations (`openvsx + recording`) and a second opt-in surface:

| Variant | Ships? | Struggle | Recorder | `@dataCollection` | `@telemetry`/`@struggleView` |
|---|---|---|---|---|---|
| `full` | Desktop/Marketplace | on | **off** | noop | real |
| `openvsx` | Open VSX/EduIDE | off | off | noop | noop/stub |
| `local-recording` | **local only** | on | **on** | real | real |

`full` flips to recorder-**off** (the behaviour change). `local-recording` is the only
variant with the recorder, and it is rejected under CI.

### 4.2 Variant resolution + fail-safe guard (pure, testable)

New `extension/scripts/resolveBuildVariant.js` — a pure function so the guard is
unit-testable:

```
function resolveBuildVariant({ argv, env }) {
    const variant = /* --variant= | IRIS_BUILD_VARIANT | 'full' */;
    if (!['full', 'openvsx', 'local-recording'].includes(variant)) {
        throw new Error(`unknown build variant '${variant}'`);          // fail-closed
    }
    const isCI = env.GITHUB_ACTIONS === 'true' || env.CI === 'true';    // exact match
    if (variant === 'local-recording' && isCI) {
        throw new Error('local-recording is a local-only variant; refused under CI');
    }
    return {
        variant,
        isOpenVsx: variant === 'openvsx',
        recording: variant === 'local-recording',
    };
}
```

Layered defense (do not rely on CI detection alone): the shipped packagers
(`package-desktop.js`, `package-openvsx.js`) **hard-code** their variant (`full` /
`openvsx`) and never accept a recording variant, so a shipped build is recorder-free
regardless of environment.

### 4.3 esbuild wiring (esbuild.js)

`esbuild.js` consumes `{ variant, isOpenVsx, recording }`:
- `@dataCollection` alias → the new real wrapper `dataCollection/recording.ts` when
  `recording`, else `noop.ts`.
- `__IRIS_RECORDING__` define → `String(recording)`.
- `@telemetry` / `@struggleView` stay keyed on `isOpenVsx`.
- **`dataCollection/index.ts` is NOT modified.** The real seam's context-key wiring lives
  in a new wrapper `dataCollection/recording.ts` (§4.7); `index.ts` stays pristine for the
  rebase (§7).

### 4.4 Manifest generation: fail-closed profile switch (generate-clean-manifest.js)

Replace the options object with a required profile enum so a typo can never fail open:

```
function cleanManifest(m, profile) {
    switch (profile) {
        case 'desktop': dropRecorderGroup(m); break;                    // struggle kept
        case 'openvsx': dropRecorderGroup(m); dropStruggleGroup(m); applyCloudDefaults(m); break;
        default: throw new Error(`unknown manifest profile '${profile}'`);
    }
    delete m.scripts?.['vscode:prepublish'];
    assertNoDanglingCommandRefs(m, removedCommands);   // no menu/keybinding may reference a dropped command
    return m;
}
```

- **Recorder group** (dropped for `desktop` and `openvsx`): setting
  `artemis.dataCollectionConsent`; commands `artemis.replaySession`,
  `artemis.openRecordingsFolder`; **and their `contributes.menus.commandPalette` entries**
  (added in the source manifest per §4.7 — they would dangle otherwise).
- **Struggle group** (`openvsx` only): default `artemis.struggleDetection.*` OFF (kept,
  not deleted, as today); drop command `artemis.showStruggleScore`.
- `assertNoDanglingCommandRefs(m, removedCommands)` is generic hardening (L11): after
  dropping, assert no remaining `contributes.menus.*` / `keybindings` entry references any
  removed command. It is passed the removed-command set (it does not assume every menu
  command is locally contributed).
- CLI: `generate-clean-manifest.js <out> --profile=desktop|openvsx`.
- `local-recording` ships the **source** manifest unchanged (recorder present).

### 4.5 Verifier: fail-closed, forward-compatible (verify-clean-bundle.js)

`verify-clean-bundle.js --profile=desktop|openvsx` (unknown/missing profile throws).

- **RECORDER_FORBIDDEN** (both profiles) — enumerate every recorder-only entry point and
  **both** recorder layouts so the set survives the struggle rebase without path edits:
  - `services/telemetry/recording/`, `services/telemetry/replay/`  (dev layout)
  - `services/recording/`  (struggle layout). **`services/sensing/` is deliberately NOT
    here**: on the struggle branch it is the shared `SensorHub` used directly by the
    Desktop struggle engine — forbidding it would reject every valid struggle-enabled
    Desktop build after the rebase.
  - `services/auth/consentService.ts`, `activation/sessionRecorderWiring.ts`
  - the real seam target `src/extension/dataCollection/index.ts` and its wrapper
    `dataCollection/recording.ts` (their presence proves recorder wiring leaked in)
- **STRUGGLE_FORBIDDEN** (`openvsx` only): the remaining `services/telemetry/` subtree
  (allow `types.ts`) — and, for the struggle layout, `services/struggle/`,
  `services/intervention/`, `services/struggleIntervention/` — plus the non-stub
  `StruggleDetection` view files and `recharts` (matching the struggle-branch policy so the
  set is rebase-stable). `services/sensing/` stays allowed unless a separate decision
  excludes it from Open VSX.
- `desktop` asserts RECORDER_FORBIDDEN against `dist/meta-extension.json` +
  `dist/meta-webview.json`; `openvsx` asserts both sets against the `-openvsx` metafiles.
- **Verification runs before `vsce package`** (right after the esbuild build, on the
  metafiles), so a forbidden bundle aborts *before* any VSIX is written (M9).

### 4.6 Packaging: new self-contained desktop packager

To keep the struggle rebase minimal (codex H5), **do not refactor `package-openvsx.js`**.
Instead:

- **New `scripts/package-desktop.js`** (self-contained, ~ mirrors `package-openvsx.js`):
  build `--variant=full`, write metafiles, `verify-clean-bundle.js --profile=desktop`,
  run `sync-marketplace-docs.js`, stage (`dist`, `media`, `LICENSE`, `.vscodeignore`, and
  **explicitly copy** root `README.md` + `CHANGELOG.md` into staging — running the sync
  script alone does not put them in staging), `generate-clean-manifest.js --profile=desktop`,
  `vsce package` from staging (no rebuild; staged manifest has no `vscode:prepublish`).
  Accept the ~40-line duplication with `package-openvsx.js`; a post-rebase DRY pass is a
  follow-up.
- **`package-openvsx.js`** gets a **minimal, required** update (it cannot stay untouched
  once profiles are required): pass `--profile=openvsx` to `generate-clean-manifest.js`,
  and add a **required** pre-stage `verify-clean-bundle.js --profile=openvsx` (a forbidden
  bundle must abort before any VSIX is written — not optional). This is a 2–3 line change;
  the struggle branch already verifies pre-stage, so the rebase keeps its version.
- **New `scripts/package-recording.js`** (Node wrapper, cross-platform — M7): builds with
  `execSync(..., { env: { ...process.env, IRIS_BUILD_VARIANT: 'local-recording' } })` so the
  variant is inherited by `vsce`'s `vscode:prepublish` rebuild, then `vsce package` from the
  **source** manifest, invoked the same cross-platform way as `package-openvsx.js`. Works on
  Windows (no `VAR=value cmd` prefix).

npm scripts:
- `package:vsix` → `node scripts/package-desktop.js` (was `npm run package && vsce package`).
- `package:openvsx` → `node scripts/package-openvsx.js`.
- `package:rec` → `node scripts/package-recording.js`.

### 4.7 F5 / palette honesty (codex H3)

Default F5 runs unflagged `watch` (variant `full`, recorder-off) but loads the **source**
manifest, which contributes `replaySession` + `openRecordingsFolder`; the noop seam
registers neither → "command not found" if invoked. Make every build honest:

- A **new** alias target `dataCollection/recording.ts` (the `@dataCollection` real target
  for the recording variant) sets context key `iris.recorder.active = true`, then delegates
  to the untouched `index.ts` wiring. The **noop** seam explicitly sets
  `iris.recorder.active = false` (not merely "leaves it unset") and resets it to `false` on
  dispose, so the key never goes stale across reload/restart.
- The **source** manifest gains `contributes.menus.commandPalette` entries gating both
  recorder commands on `when: "iris.recorder.active"`, hiding them whenever the recorder is
  not wired (default F5). Shipped builds drop the commands **and** these entries (§4.4), so
  nothing dangles.
- A **"Run Extension (Recording)"** launch config sets `IRIS_BUILD_VARIANT=local-recording`
  via the VS Code task's `options.env` — **not** via a `watch:recording` npm script, because
  `npm run watch` runs every `watch:*` script in parallel and would launch both variants.

### 4.8 CI + release wiring

Intent (exact step wiring left to the plan): both workflows build the Desktop VSIX via
the clean-desktop packager instead of `vsce package` on the source manifest, and both
shipped bundles are proven recorder-free.

- `ci.yml` `build` job: Desktop path builds `full` (recorder off) and gates on the
  `desktop` verify; the openvsx bundle keeps its `openvsx` verify. Net: CI proves **both**
  shipped bundles are clean (today only openvsx is gated).
- `release-openvsx.yml` `build` job: the Marketplace VSIX artifact comes from
  `package-desktop.js`. Keep the step `id: vsix` and run it **after** the pinned-vsce
  install so artifact-name/checksum/attestation propagation is unchanged. Open VSX path
  unchanged.
- Both files are under `.github/` → require CODEOWNERS/admin review to merge.

### 4.9 Stale setting description (codex M8)

Rewrite `artemis.struggleDetection.showInterventions`'s description: it currently claims
the user still contributes research data when interventions are off — false once the
recorder/consent are removed from shipped builds.

### 4.10 Additional implementation notes (from codex sign-off)

Non-blocking items to carry into the plan:
- **Update every direct verifier caller, not just `package-openvsx.js`.** `ci.yml` and
  `release-openvsx.yml` currently call `verify-clean-bundle.js` with no profile → they must
  pass `--profile=openvsx`. Release can drop its now-redundant post-package verify (the
  packager verifies pre-stage) or pass the profile.
- **`package-recording.js` must pass the recording env to BOTH child calls** (the initial
  build *and* `vsce package`), or `vscode:prepublish` may rebuild as `full`.
- **Recording wrapper lifecycle:** delegate to `index.ts` first and set
  `iris.recorder.active=true` only after wiring succeeds; wrap the returned handle so its
  `dispose()` resets the key to `false` in a `finally`, so a wiring exception or disposal
  never leaves a stale `true`.
- **Update stale two-variant docs/comments:** `DEVELOPER.md`, the "full build only" comment
  in `dataCollection/index.ts`, and the activation comment in `extension.ts`.

## 5. Testing

- New `resolveBuildVariant.test.ts`: valid variants resolve; unknown variant throws;
  `local-recording` + CI (`GITHUB_ACTIONS=true` and `CI=true`) throws; `CI=false` locally
  does **not** count as CI; the `package:rec` invocation model (nested build) keeps the
  recording variant.
- Extend `generateCleanManifest.test.ts`: `desktop` keeps struggle settings +
  `showStruggleScore`, drops recorder group; `openvsx` drops both; **unknown/missing
  profile throws**; run once against the **real** `package.json`; `assertNoDanglingCommandRefs`
  catches a synthetic dangling menu ref.
- Extend `verifyCleanBundle.test.ts` with concrete path cases: `services/recording/sessionRecorder.ts`
  and the real `dataCollection/index.ts` are forbidden for `desktop`; `services/sensing/sensorHub.ts`
  and a struggle-engine input are ALLOWED for `desktop`; the future struggle/intervention
  paths are forbidden only for `openvsx`; profile parsing + metafile selection covered;
  unknown profile throws.
- Acceptance (CI + manual): `package-desktop.js` yields a VSIX whose metafile passes
  RECORDER_FORBIDDEN and still contains struggle-engine inputs; `package:rec` yields a
  VSIX that contains the recorder; default F5 shows no recorder commands.

## 6. Out of scope

- Deleting the recorder feature source (separate later issue).
- Fully gating the dormant recorder instrumentation (§2.1) — deferred with the source
  deletion; must also be applied to Open VSX when done.
- Changing struggle detection / proactive behaviour, thresholds, or the `@telemetry` /
  `@struggleView` seams.
- Renaming `release-openvsx.yml` (misleading but orthogonal).

## 7. Struggle-branch compatibility & rebase (codex H5)

`dev` tip is byte-identical to the struggle fork point (the struggle-v3 squash on dev and
its revert cancel exactly), so the only real new content the rebase absorbs is this change.
Struggle imports nothing from the recorder subtree, so the engine runs unchanged after
the rebase.

The rebase is **bounded but not a mere path rewrite** — the struggle branch already
rewrote every file this design touches, with different *policy*:
- `services/telemetry` is deleted and split into `services/recording`, `services/sensing`,
  `services/struggle`, `services/intervention`, `services/struggleIntervention`.
- Its `generate-clean-manifest.js` **deletes** struggle settings (we **default** them off).
- Its verifier uses a different `FORBIDDEN_SUBTREES` policy and also forbids `recharts`.
- Its `package-openvsx.js` already verifies before staging.
- Its `dataCollection/index.ts` differs (no replay command, different deps).

Conflict-minimizing choices baked into this design:
- **Do not modify `dataCollection/index.ts`** (the context-key wiring lives in the new
  wrapper `dataCollection/recording.ts`; the seam swap lives in esbuild.js).
- Put new policy in **new files** (`resolveBuildVariant.js`, `package-desktop.js`,
  `package-recording.js`, `dataCollection/recording.ts`); edit existing shared files
  (`esbuild.js`, `generate-clean-manifest.js`, `verify-clean-bundle.js`) as little as possible.
- Make the verifier's RECORDER_FORBIDDEN accept **both** recorder layouts (dev
  `services/telemetry/recording` and struggle `services/recording`) while excluding the
  shared `services/sensing/`, and let STRUGGLE_FORBIDDEN enumerate the struggle split, so
  the verifier needs no path edit and stays correct after the rebase.
- Keep `package-openvsx.js` changes to the **required minimum** (two profile args + the
  pre-stage verify the struggle branch already has), so its merge is trivial.

Unavoidable conflict sources (honest accounting): `extension/package.json` (commands,
`commandPalette` menus, scripts, and the reworded `showInterventions` text — the struggle
branch also edits it), `generateCleanManifest.test.ts` and `verifyCleanBundle.test.ts`
(both modified on the struggle branch), and the profile-arg lines in `package-openvsx.js`.
The work is bounded but not conflict-free.

## 8. Release notes (codex L12)

- Removing `replaySession` / `openRecordingsFolder` from shipped builds is an intentional
  breaking change for study/debug users (source + `package:rec` still provide them).
- Existing `artemis.dataCollectionConsent` values in users' `settings.json` become inert
  (schema removed, prompt gone); they are not auto-deleted (we do not silently mutate user
  config). Note this in the changelog.

## 9. Open questions

None blocking. Naming (`local-recording`, `package:rec`, `package-desktop.js`,
`iris.recorder.active`) is provisional and cheap to change during implementation.
