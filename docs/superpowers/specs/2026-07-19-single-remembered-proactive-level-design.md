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
  unresolved scope → `more`.
- `setLevel(level: ProactiveLevel): void` — persists the scalar. Writing `more`
  **deletes** the key (keeps the existing "absent = default" convention and
  avoids storing the default). Uses the same shadow-map + serialized write-chain
  pattern already in the file for sync read-after-write.
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
id. It is the engine's transient surface-clear that guards "act only on the
*active* exercise" (`getExerciseId() !== exerciseId`) — genuinely per-exercise,
not a level read.

### Semantic note (intentional, behavior-preserving)

Today five guards short-circuit on `exId === undefined` to "proactive on =
true":

- `struggleInterventionService.ts` debug snapshot (`getDebugSnapshot`),
  `_suppressReason`, the two decide accept/reconcile paths, and the follow-up
  bubble gate.

After the strip, the global level applies even when no exercise is active. In
every real path an exercise *is* active (alerts and decisions originate from an
exercise session), so live behavior is unchanged. In the degenerate
no-exercise case the global Off is now honored, which is strictly more correct.
This is called out here so a reviewer does not flag it as an accidental change.

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
  - `setLevel('more')` deletes the key (globalState no longer holds the scope key);
  - persistence across a fresh service instance over the same `globalState`;
  - scope isolation: two distinct `server::principal` scopes keep independent
    levels;
  - unresolved scope (`getScope()` → null) → `getLevel()` returns `more` and
    `setLevel` is a no-op.
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

**Modify:**
- `extension/src/extension/services/proactivePreferenceService.ts`
- `extension/src/extension.ts`
- `extension/src/extension/telemetry/contract.ts`
- `extension/src/extension/telemetry/index.ts`
- `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- `extension/src/extension/controller/commands/proactiveControlCommands.ts`

**Tests:**
- `extension/test/logic/proactivePreferenceService.test.ts` (rewrite)
- `extension/test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts`
  (rewrite — drop the per-exercise premise)
- `extension/test/logic/struggleIntervention/helpers.ts` (confirm/adjust the
  no-arg `_deps` stubs to the new signatures)
