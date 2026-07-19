# Single Remembered Proactive-Help Level — Design (Issue #341)

**Branch:** `feat/struggle-v3-integration`
**Status:** Approved design, ready for implementation plan.

## Motivation

The proactive-help level (Off / Less / More) is stored per exercise in
`ProactivePreferenceService`, defaulting to `more` for every new exercise. The
student meets the same decision again on every exercise, and it blurs the
consent story: the level is a *delivery preference*, not a consent. Consent
stays with the dedicated rings (platform LLM opt-in, course switch, code-egress
opt-in). The level should just be a preference the editor remembers once.

This is a follow-up from #342 testing and a sibling of the settings
consolidation in #352.

## Scope

Make the level a single remembered setting, remembered **once per user**
(`server::principal` scope, unchanged), not per exercise. Default stays `more`.
Keep the three steps Off / Less / More and the pull/push mapping
(`proactivityMode` on the intervention request) exactly as they are.

**In scope:** storage collapse in `ProactivePreferenceService`; stripping the
now-meaningless `exerciseId` parameter from the level *read* path end to end;
the matching test updates.

**Out of scope:** any change to the level's meaning, the pull/push mapping,
the card/webview visuals, or the consent rings. No behavior change beyond
"the level is now shared across exercises."

## Decisions (locked)

1. **Scope stays `server::principal`.** Drop only the exercise dimension. This
   matches "follows the user" and preserves isolation when two logins share one
   OS profile. A truly-global unscoped key was rejected: it could leak one
   student's preference to another on a shared machine.
2. **No migration.** The level control ships only on
   `feat/struggle-v3-integration`, unmerged to `dev`/`main`, so no released user
   has per-exercise level data. Legacy per-exercise entries are never read or
   written; the old `_normalizeLegacy` boolean handling (`false` → `off`) is
   removed with the map.
3. **Honest interface.** Strip the `exerciseId` parameter from the level read
   path rather than keeping it as a decorative dead argument.

## Architecture

### Component 1 — Storage (`extension/src/extension/services/proactivePreferenceService.ts`)

Collapse the per-exercise map (`Record<number, 'less' | 'off'>`) to a single
scoped scalar.

- New storage key: `proactive.level::<server::principal>` holding one
  `ProactiveLevel` string. (Distinct from the legacy `proactive.preference::…`
  map key, which is now dead and never touched.)
- `getLevel(): ProactiveLevel` — reads the scoped scalar; unset → `more`; an
  unresolved scope → `more`. **Validates** the persisted value is exactly one of
  `off`/`less`/`more`; any other (corrupt/legacy) value defaults to `more`.
  Removing the legacy boolean normalization does not mean removing all
  validation — `globalState` is runtime-untyped.
- `setLevel(level: ProactiveLevel): void` — persists the scalar via the same
  shadow-map + serialized write-chain pattern already in the file (sync
  read-after-write). **The shadow always holds the current level string,
  including `more`.** Only *persistence* differs by value: writing `off`/`less`
  updates the key, writing `more` **deletes the persisted key** (keeps the
  "absent = default" convention, avoids storing the default). The shadow must
  keep an explicit `more` entry while the async deletion is queued — if the
  shadow entry were deleted instead, an immediate `getLevel()` could reload the
  old persisted `less`/`off` before `globalState.update(key, undefined)`
  resolves.
- `isProactiveOn(): boolean` — `getLevel() !== 'off'`.
- The service still imports nothing from `services/struggle|intervention`, so it
  stays in the clean/Open VSX bundle.

The constructor signature (`globalState`, `getScope`) is unchanged.

### Component 2 — Read-path parameter strip

The level-read functions lose their `exerciseId` argument everywhere they are
declared and called:

- **`extension/src/extension.ts`** — deps handed to `createStruggleEngine`:
  `getProactiveLevel = () => proactivePreferenceRef?.getLevel() ?? 'more'`;
  `isStudentProactiveOn: () => getProactiveLevel() !== 'off'`.
- **`extension/src/extension/telemetry/contract.ts`** — dep interface:
  `isStudentProactiveOn(): boolean`; `getProactiveLevel(): ProactiveLevel`.
  `getActiveProactiveLevel(): ProactiveLevel` keeps its signature.
- **`extension/src/extension/telemetry/index.ts`** — wiring:
  `isStudentProactiveOn: () => deps.isStudentProactiveOn()`;
  `getProactiveLevel: () => deps.getProactiveLevel()`. The
  `getActiveProactiveLevel` body simplifies: the
  `coordinator.activeExerciseId === undefined ? 'more' : deps.getProactiveLevel(id)`
  guard collapses to `() => deps.getProactiveLevel()` (the level no longer
  depends on the active exercise; `getProactiveLevel()` already defaults `more`).
- **`extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`**
  — the two `_deps` signatures plus the call sites:
  - `exId !== undefined ? this._deps.getProactiveLevel(exId) : 'more'` forms
    collapse to `this._deps.getProactiveLevel()` (identical `more` fallback).
  - `exId !== undefined && !this._deps.isStudentProactiveOn(exId)` guards become
    `!this._deps.isStudentProactiveOn()`.
  - Local `exId`/`exerciseId` computations that are still used for *other*
    purposes (e.g. `setStudentProactive`, row/slot handling) stay.
- **`extension/src/extension/controller/commands/proactiveControlCommands.ts`**
  — `this.context.proactivePreference?.setLevel(level)` and
  `this.context.proactivePreference?.getLevel() ?? 'more'`. The command still
  receives `exerciseId` from the webview for the card push,
  `setStudentProactive(exerciseId, …)`, and `collapseProactiveEpisodes()`.

**Deliberately NOT stripped:** `setStudentProactive(exerciseId, on)` keeps its
id. It is not a level read but the engine's transient surface-clear, and after
Component 2b its id carries *mixed* semantics: the **On** branch still needs the
id (reset the active exercise's evidence gate only when the triggering exercise
is the active one), while the **Off** branch ignores it (clear the active
exercise's surfaces regardless of which view triggered the global Off).

### Component 2b — Cross-exercise Off must clear the active exercise's surfaces

With a *global* level, the student can set Off from exercise B's view while the
engine is monitoring exercise A. Today `setStudentProactive(exerciseId, on)`
early-returns on `getExerciseId() !== exerciseId`, so an Off triggered from B
would gate A's *future* alerts (global level) yet leave A's *live* surfaces
(lamp, inline cue, badge, banner) uncleared — a new inconsistency introduced by
the global level (per-exercise storage never had it).

Resolution — restructure `setStudentProactive` so the two branches guard
differently:

- **Off (`on === false`):** clear the active exercise's surfaces
  **unconditionally** (drop the id guard for this branch). Global Off means
  "stop everywhere," and the orchestrator instance already targets the active
  exercise, so clearing is always correct regardless of which view triggered it.
- **On (`on === true`):** keep the id guard — `_setAwaitingEvidence(false,
  'proactive re-enabled')` means "the student is present *in this exercise*," so
  it must fire only when the triggering exercise is the active one. Re-enabling
  from B must not reset A's evidence gate.

The `collapseProactiveEpisodes()` call in the command stays (it collapses chat
episodes globally, which is correct for a global Off).

### Semantic note (intentional, no student-facing change)

Four guards in `struggleInterventionService.ts` short-circuit on
`exId === undefined` to "proactive on = true": the debug snapshot
(`getDebugSnapshot`), `_suppressReason`, and the two decide accept/reconcile
paths (ambient + active reply). (The help-request path is *not* one of them — it
returns early when there is no exercise rather than forcing on; and the four
`exId !== undefined ? getProactiveLevel(exId) : 'more'` reads in the rerouting/
offer logic simply keep their `more` fallback via `getProactiveLevel()`'s own
default.)

After the strip, the global level applies even when no exercise is active. In
every **student-facing production path** an exercise *is* active — the
coordinator holds the id defined through final engine drain, ambient/active
websocket frames only reach the orchestrator when their exercise is active, and
help requests require an exercise — so live behavior is unchanged. The lone
difference is the developer "force full pipeline" debug command, which can
deliver an alert with no active exercise: under the old behavior it reached
`decideOutcome`, recorded a local-silent decision, then stopped for lack of an
exercise; under the new behavior a global Off suppresses it earlier. No egress
or bubble differs — only diagnostics/logging. This is called out so a reviewer
does not flag it as an accidental change; "no student-facing production path is
affected" is the precise claim.

### Component 3 — Webview

No functional change. The exercise view already re-requests the control on
exercise switch (`RequestProactiveControl`), so opening exercise B now shows the
same global level that A was set to — the intended effect. The `setProactiveLevel`
message still carries `exerciseId` (used by the command for the card push); the
storage just ignores it now.

## Testing

- **`test/logic` (Vitest) `proactivePreferenceService.test.ts`** — rewrite:
  - unset scope/level → `more`;
  - `setLevel('less')` then `getLevel()` → `less`, and reflected regardless of
    any exercise context (cross-exercise sharing);
  - `setLevel('off')` → `isProactiveOn()` false;
  - `setLevel('more')` after an `off`/`less`: `getLevel()` reads `more`
    **synchronously from the shadow**, and after the write chain settles the
    persisted key is deleted (globalState no longer holds the scope key);
  - a corrupt persisted scalar (e.g. `'bogus'`, `false`, `7`) → `getLevel()`
    returns `more` (validation);
  - persistence across a fresh service instance over the same `globalState`
    (assert only **after awaiting the write chain** — see note below);
  - scope isolation: two distinct `server::principal` scopes keep independent
    levels;
  - unresolved scope (`getScope()` → null) → `getLevel()` returns `more` and
    `setLevel` is a no-op.
  - **Async-persistence caveat:** persistence is serialized through the private
    write chain, so a persisted-state assertion (raw `globalState` inspection or
    a second service instance) must first let the chain settle — flush
    microtasks / a settle helper. Synchronous read-after-write is guaranteed
    only through the *same* service's shadow. Provide an awaitable fake `Memento`
    whose `update` resolves.
- **`test/logic/proactiveControlCommands.test.ts`** — update: the existing
  `expect(h.pref.setLevel).toHaveBeenCalledWith(42, 'off' | 'less')` assertions
  must drop the id (`toHaveBeenCalledWith('off')` / `('less')`), or `test:react`
  fails to compile. (This file mocks `setStudentProactive`, so it verifies the
  command wiring only, not surface clearing — the 2b behavior is tested in the
  intervention-service file below.)
- **`test/logic/struggleIntervention/struggleInterventionService.test.ts`** —
  the existing test *"setStudentProactive on a NON-active exercise does not touch
  live surfaces"* (currently asserting `setStudentProactive(999, false)` clears
  **nothing**) asserts the *old* behavior and must be **inverted**: an Off on a
  non-active exercise now **clears** the active exercise's surfaces (global Off).
  The sibling test *"setStudentProactive(active, false) clears …"* stays as-is.
  **Add** the On-half guard test: `setStudentProactive(999, true)` (non-active)
  must **not** reset the active exercise's awaiting-evidence gate (the On branch
  keeps its id guard).
- **`test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts`** —
  rewrite: its premise (level keyed by exercise, `fakeDeps` faking
  `getProactiveLevel: (exerciseId) => …`, asserting
  `toHaveBeenLastCalledWith(42)`) no longer holds. Re-target it to the no-arg
  global read (`getProactiveLevel()` called with no exercise id; the returned
  level drives `getActiveProactiveLevel()` regardless of the active exercise).
- **`test/logic/struggleIntervention/helpers.ts`** — the shared `_deps` fake
  already stubs `getProactiveLevel: () => 'more'` and
  `isStudentProactiveOn: () => true` with no args, so it stays type-compatible
  once the interface drops the parameter. Confirm it still compiles; adjust only
  the type annotations if `noUnusedParameters`/signatures require it. The
  intervention-service test files that consume `helpers.ts` need no change
  unless a test explicitly passes an exercise id to these two stubs.
- **Gates:** `npm run check-types` clean; `npm run test:react` (covers
  `test/logic`) and the Mocha `test:unit` suite green; `npm run package:openvsx`
  clean-bundle verification still passes (service imports nothing from
  struggle/intervention).

## Files

**Modify (logic):**
- `extension/src/extension/services/proactivePreferenceService.ts`
- `extension/src/extension.ts`
- `extension/src/extension/telemetry/contract.ts`
- `extension/src/extension/telemetry/index.ts`
- `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
  (read-path strip **and** Component 2b `setStudentProactive` restructure)
- `extension/src/extension/controller/commands/proactiveControlCommands.ts`

**Modify (comment/doc cleanup — wording only, no behavior):**
- `extension/src/shared/messageContracts/proactiveLevel.ts` (header calls the
  level a per-exercise preference)
- `extension/src/shared/messageContracts/extensionMessages.ts:178`
- `extension/src/extension/provider/artemisWebviewProvider.ts:344`
  (`proactivePreference` getter doc: "per-exercise")
- `extension/src/extension/controller/commands/types.ts:51`
  (the exercise-tagged webview state stays; only "per-exercise preference"
  wording changes)
- `extension/src/extension/services/struggle/struggleCoordinator.ts:96`
  (per-exercise wording)
- Any residual "per-exercise (level/preference)" wording in the already-modified
  `extension.ts`, `telemetry/contract.ts`, and `struggleInterventionService.ts`
  (fix in passing while editing those files).

**Tests:**
- `extension/test/logic/proactivePreferenceService.test.ts` (rewrite)
- `extension/test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts`
  (rewrite — drop the per-exercise premise)
- `extension/test/logic/proactiveControlCommands.test.ts` (drop the id from the
  `setLevel` expectations)
- `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`
  (invert the non-active-Off surface test for Component 2b; add the non-active-On
  guard test)
- `extension/test/logic/struggleIntervention/helpers.ts` (confirm/adjust the
  no-arg `_deps` stubs to the new signatures)
