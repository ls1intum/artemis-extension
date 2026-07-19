# Make the "Ask Iris" card honestly reflect the chat-off state (#334, broadened)

**Issue:** [#334](https://github.com/ls1intum/artemis-extension/issues/334) (scope broadened during brainstorming)
**Branch:** `feat/struggle-v3-integration`
**Date:** 2026-07-19
**Follow-up to:** #342 (proactive card-state matrix)

## Problem

When the manual Iris chat is off for an exercise, the "Ask Iris" card still looks
fully inviting. Today the host renders a warning banner *above* the card, but the
card body underneath keeps the static description "Open the Iris chat to discuss
this exercise or get guidance." and the only "off" affordance is a faded-blue
disabled `Ask` button that reads more like a loading/secondary state than
"turned off". The card contradicts the banner.

Two triggers put the chat in exactly this state:

- **`.noai` file** in the workspace (`cardState === 'unavailable'`, `reason === 'noai'`).
- **Iris off for the course/user** — profile off, no LLM opt-in, settings 403,
  etc. (`cardState === 'unavailable'`, `reason === 'iris-off'`).

Both derive to `cardState === 'unavailable'` and both turn the manual chat off.
The original issue named only `.noai`; the fix applies to the whole `unavailable`
branch.

**Clean/Open VSX build gap (in scope).** The whole card-state mechanism is today
coupled to the struggle engine: `_push` early-returns when the engine seam
(`context.proactiveControl`) is absent, so the clean/no-engine build never sends
a card, never shows the banner, and always renders the inviting card even under
`.noai` or Iris-off. The manual chat still exists there and `.noai` blocks its
messages at send time, so the defect is real in that build too. We decouple the
chat-availability part of the card from the engine so the honest card renders in
every build.

## Decisions taken during brainstorming

1. **Scope = the `unavailable` branch** (`noai` + `iris-off`), i.e. exactly the
   states where the *manual chat* is off. The chat-active states (`available`,
   `off-course`, `degraded/limited`, `degraded/consent-missing`) keep their
   "Open the Iris chat…" description — only proactivity is affected there and the
   proactive sub-section already shows it (#342).
2. **Include the clean/Open VSX build** (chosen over a follow-up issue): the
   chat-availability card must render even without the struggle engine.
3. **The banner moves into the card.** The notice becomes the top element
   *inside* the Ask Iris card container, so the card explains itself.
4. **Neutral, not yellow.** The in-card notice uses a neutral/informational style
   (subtle border all around, info glyph, no colored accent line), not the
   warning-yellow bar. "Off" is a state, not an error.
5. **The Ask row is muted and the description is honest.** In `unavailable` the
   logo/title/description dim, the description is replaced with a truthful line,
   and the `Ask` button is restyled to read as clearly inactive (neutral outline,
   not a faded solid primary).
6. **The proactive sub-section stays hidden** in `unavailable` (unchanged from
   #342), and is never rendered at all when there is no engine (clean build).

## Design

### 1. Decouple chat-availability from the engine (`proactiveControlCommands.ts`)

The command module is already registered in **every** build
(`webViewMessageHandler.ts:99`, unconditional) and imports only clean-safe code
(`classifyIrisCourseAvailability`, `deriveProactiveCardState`). The webview
always sends `requestProactiveControl` (`ExerciseDetailView.tsx:121/151/159`).
Only the engine seam `context.proactiveControl` is absent in the clean build.

Change `_push` (`extension/src/extension/controller/commands/proactiveControlCommands.ts:45`):

- **Remove the early `return` on `!context.proactiveControl`.** Instead:
  - `const control = this.context.proactiveControl;` (may be `undefined`).
  - `const gate = control?.getProactiveGateState() ?? { consentMissing: false, serverUnavailable: false };`
    — the consent/server gates are engine concepts; absent-engine ⇒ neither
    applies.
  - Still fetch the non-engine signals exactly as today: `irisAvailability` +
    `courseProactiveEnabled` via `classifyIrisCourseAvailability`, and `noAi` via
    the chat provider (`whenNoAiReady()` / `isNoAiEnabled()`). These exist in the
    clean build.
  - Feed `deriveProactiveCardState` with the proactive-only inputs masked off
    when there is no engine, so the clean build can only yield
    `noai` / `iris-off` / `available` (never the proactive-only `off-course` /
    `limited` / `consent-missing`):
    ```ts
    deriveProactiveCardState({
      irisAvailability,
      noAi,
      courseProactiveEnabled: control ? courseProactiveEnabled : undefined,
      consentMissing: gate.consentMissing,      // false without engine
      serverUnavailable: gate.serverUnavailable, // false without engine
    })
    ```
  - Keep the `level` mask (`cardState === 'available' ? stored : 'off'`) — inert
    in the clean build (no segments shown), harmless.
  - Post `UpdateProactiveControl` with a new field
    `proactiveControlAvailable: !!control`.
- **Cost note:** the clean build now performs one availability probe + noai scan
  per card request (previously zero work). Accepted — it is the price of an
  honest clean-build card, and it is the same probe the full build already runs.
- Update the now-wrong comments: `proactiveControlCommands.ts:46-47` ("clean
  build does ZERO work / sends nothing") and `proactiveCardState.ts:3-7` ("the
  clean (no-engine) build never reaches this function — its `_push`
  early-returns"). The engine-absence is handled by masking inputs, not by an
  `enginePresent` flag, so `deriveProactiveCardState` stays pure.

### 2. Message contract + store + VM: carry `proactiveControlAvailable`

- `extension/src/shared/messageContracts/extensionMessages.ts:461` — add
  `proactiveControlAvailable: boolean` to the `updateProactiveControl` payload.
- `extension/src/webview/stores/useExerciseDetailStore.ts` — add the field to
  `ProactiveControlState` and thread it through `setProactiveControl`.
- `ExerciseDetailView.tsx:255-264` — include `controlAvailable:
  proactiveControl.proactiveControlAvailable` in the `proactiveVM`.
- `AskIris` `ProactiveControlVM` (`AskIris.tsx:15-24`) — add
  `controlAvailable: boolean`.

### 3. `AskIris.tsx` — render the off-card and gate the proactive section

- `const unavailable = state === 'unavailable';`
- **Notice** (new, top of the card, above `.main`, only when `unavailable`): a
  neutral box with an info glyph and text by reason:
  - `reason === 'noai'` → `"A .noai file disables Iris for this repository, including the chat."`
  - else (`iris-off` / any) → `"Iris is not available for this exercise."`
- **Honest description** (replaces the passed `description` only when
  `unavailable`; a single consistent effect line, so the notice carries the cause
  and the row is not verbatim-redundant): `"The Iris chat is turned off here."`
  The `description` prop remains the source for every chat-active state.
- **Muted row**: add a `mainMuted` class to `.main` when `unavailable`.
- **Disabled Ask, clearly inactive**: keep `askDisabled = unavailable`; pass
  `className={styles.unavailableAsk}` to the Ask `Button` when `unavailable`
  (see CSS §4 for the neutral override).
- **Proactive sub-section gating**: render the entire proactive block only when
  `proactiveControl.controlAvailable && !unavailable`. This both keeps it hidden
  in `unavailable` (as #342 did) *and* removes it entirely in the clean build,
  where `controlAvailable` is false and the card is purely a chat-availability
  reflection (an `available` clean-build card renders exactly as the bare card
  does today — passed description, `Ask` enabled, no segments).
- The two reason→text mappings live in small local maps mirroring the existing
  `NOTE` map; `noai` is the only special case, everything else falls back to the
  generic copy (matching today's `reason === 'noai' ? … : …` banner logic, so a
  defensive `undefined` reason renders the generic copy).
- **Container test hook**: pass `testId="ask-iris-card"` to the wrapping
  `Container` (`Container` already supports `testId`) so tests can assert
  containment without brittle DOM traversal.
- Update the stale `NOTE` comment (`AskIris.tsx:32`) that says the unavailable
  banner lives in the exercise view.

### 4. `AskIris.module.css`

- `.notice` — the neutral in-card box: flex row (info glyph + text),
  `padding: 8px 12px`, `border: 1px solid var(--theme-border)`, subtle
  `background: var(--vscode-editorWidget-background, transparent)`,
  `border-radius: 5px`, `color: var(--vscode-descriptionForeground)`,
  `font-size: 0.9em`. **No** colored left border, **no** `margin-bottom` — the
  `Container` body already applies an 8px flex gap between children, so the notice
  spaces itself from `.main` (adding margin would double it). The glyph is a small
  inline SVG info icon (14px, `currentColor`, `opacity: 0.8`,
  `aria-hidden="true"`, `focusable="false"`); no codicon dependency (components
  use none today). The notice element carries `role="status"` so the async-arriving
  off-state is announced.
- `.mainMuted` — dims the top row without touching the notice: logo
  `filter: grayscale(0.6); opacity: 0.7`; title
  `color: var(--vscode-descriptionForeground)`; description a shade dimmer.
- `.unavailableAsk` neutral disabled override — defined at higher specificity than
  the shared `.btn:disabled` (0,2,0) so cross-module stylesheet order cannot flip
  it, by scoping under the button column:
  ```css
  .buttonCol .unavailableAsk:disabled {
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--theme-border);
    opacity: 1; /* deliberate off-state, not a faded CTA */
  }
  ```
  (`.buttonCol .unavailableAsk:disabled` = specificity 0,3,0 > `.btn:disabled`
  0,2,0; both `.buttonCol` and `.unavailableAsk` live in this module, so the rule
  is self-contained.) The button stays `variant="primary"`; this override fully
  restyles it when disabled.

### 5. `ExerciseDetailView.tsx`

- Delete the standalone §14 banner block (`ExerciseDetailView.tsx:661-668`). Its
  text now lives inside the card via `AskIris`.
- The `<AskIris description="Open the Iris chat…" … />` call is unchanged;
  `AskIris` overrides that description in the `unavailable` state.
- `.banner` in `ExerciseDetailView.module.css` stays — it still renders the
  repository-cloned notice (`ExerciseDetailView.tsx:454`). Other notices (e.g.
  the rebuild banner) live in `TestResultsOverlay`, not this class. After removal
  a few `.banner[data-variant]` selectors become dead CSS; leaving them is
  harmless (out of scope to prune).

## Out of scope

- The chat-active card states (`available`, `off-course`, `degraded/limited`,
  `degraded/consent-missing`) — untouched (built by #342).
- Any change to `deriveProactiveCardState`'s logic, the card-state signals, or the
  level control itself.
- Pruning the now-dead `.banner` variant selectors.

## Acceptance criteria

1. In the `unavailable` state (both `noai` and `iris-off`), the "Ask Iris" card
   shows a neutral in-card notice at the top (info glyph, no yellow, no colored
   accent line), a truthful description, a dimmed logo/title/description, and a
   disabled `Ask` button restyled as an inactive neutral outline.
2. Reason-specific notice copy: `noai` → the `.noai` notice; `iris-off` (or any
   other/absent unavailable reason) → the generic notice. The description is the
   single consistent off-line for both.
3. `ExerciseDetailView` no longer renders a standalone banner above the card for
   the `unavailable` state; the §14 text appears exactly once, inside the card.
4. **Clean/no-engine build:** the honest `unavailable` card renders there too
   (`proactiveControlAvailable === false`); an `available` card in that build
   renders as the bare card (passed description, `Ask` enabled, no proactive
   section); the proactive-only states never appear there.
5. **Full build unchanged for chat-active states:** description "Open the Iris
   chat…", `Ask` enabled, proactive sub-section per #342
   (`proactiveControlAvailable === true`).
6. The proactive sub-section is absent whenever `unavailable` OR
   `!controlAvailable`.
7. Lint, `check-types`, vitest (`npm run test:react`), mocha
   (`npm run compile-tests && npm run test:unit`), and the Open VSX clean-bundle
   verifier (`npm run package:openvsx`) are green; no new
   `services/struggleIntervention/` import enters the clean bundle.

## Tests

`extension/test/react/AskIris.cardState.test.tsx` (add `controlAvailable: true`
to the shared `control()` helper so existing cases keep asserting the proactive
section):
- Extend the `unavailable` case (currently `iris-off`) to assert the neutral
  notice text, the honest description (NOT "Open the Iris chat…"), and the
  disabled `Ask`. Keep the "no proactive section" assertions.
- Add an `unavailable / noai` case asserting the `.noai` notice.
- Add an `unavailable` case with **omitted `reason`** asserting the generic
  fallback notice.
- Assert every chat-active state keeps the passed description and shows **no**
  notice.
- **Clean-build:** `controlAvailable: false` + `available` → no proactive section,
  passed description, `Ask` enabled; `controlAvailable: false` + `unavailable`
  (`noai`) → off-card renders (notice + disabled `Ask`).

`extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` (seed
`proactiveControl` as the existing consent test does, `ExerciseDetailView.test.tsx:164`):
- For an `unavailable` card, assert the notice text occurs exactly once, is within
  `[data-testid="ask-iris-card"]`, the old static description is absent, and no
  `[data-variant="warning"]` banner element exists above the card.

`extension/test/react/AskIris.proactiveControl.test.tsx` (or the card-state file):
- Assert the disabled Ask carries the `unavailableAsk` class in `unavailable`
  (class-level check for the neutral restyle).

`extension/test/unit/…/proactiveControlCommands` (mocha; whichever existing file
covers this module, else a new one):
- With `context.proactiveControl` **absent**, a `requestProactiveControl` push
  under `.noai` posts `UpdateProactiveControl` with
  `cardState: 'unavailable', cardReason: 'noai', proactiveControlAvailable: false`.
- Same with Iris disabled → `iris-off`.
- With `courseProactiveEnabled === false` but no engine → `available`
  (proactive-only state masked off), `proactiveControlAvailable: false`.
- With the engine present, the full path still posts
  `proactiveControlAvailable: true` and the existing derived state (regression
  guard).
