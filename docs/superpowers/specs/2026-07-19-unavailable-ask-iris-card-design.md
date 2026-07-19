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

Two triggers put the chat in exactly this state, and today only one is even named
in the banner:

- **`.noai` file** in the workspace (`cardState === 'unavailable'`, `reason === 'noai'`).
- **Iris off for the course/user** — profile off, no LLM opt-in, settings 403,
  etc. (`cardState === 'unavailable'`, `reason === 'iris-off'`).

Both derive to `cardState === 'unavailable'` and both turn the manual chat off.
The original issue named only `.noai`; the fix applies to the whole `unavailable`
branch.

## Decisions taken during brainstorming

1. **Scope = the `unavailable` branch only** (`noai` + `iris-off`), i.e. exactly
   the states where the *manual chat* is off. The chat-active states
   (`available`, `off-course`, `degraded/limited`, `degraded/consent-missing`)
   are untouched — they were built by #342 and their "Open the Iris chat…"
   description is still correct there (only proactivity is affected, and that is
   already shown by the proactive sub-section's note/segments).
2. **The banner moves into the card.** Instead of a separate bar floating above
   the card, the notice becomes the top element *inside* the Ask Iris card
   container, so the card explains itself.
3. **Neutral, not yellow.** The in-card notice uses a neutral/informational style
   (subtle border all around, info glyph, no colored accent line), not the
   warning-yellow bar. "Off" is a state, not an error; yellow stays reserved for
   real problems.
4. **The Ask row is muted and the description is honest.** In the `unavailable`
   state the logo/title/description dim, the description is replaced with a
   truthful line, and the `Ask` button reads clearly as inactive (outline, not a
   faded solid primary).
5. **The proactive sub-section stays hidden** in `unavailable` (unchanged from
   #342 — no Iris means no proactive control).

## Design

### 1. Ownership: `AskIris` renders the notice (host stops rendering the banner)

`AskIris` already owns all per-card-state copy (the `NOTE` map for `off-course`
/`degraded`, the consent-missing hint). The §14 notice joins that: `AskIris`
derives the notice text and the honest description from
`proactiveControl.reason` when `cardState === 'unavailable'`, and
`ExerciseDetailView` deletes its standalone banner block. This keeps all card
copy in one component and removes the "banner here, card there" split.

`AskIris` already receives everything it needs: when the card is `unavailable`
and matches the exercise, `ExerciseDetailView` passes a `proactiveControl` VM
carrying `cardState` and `reason` (unchanged). No new props.

### 2. `AskIris.tsx` (`extension/src/webview/components/AskIris/AskIris.tsx`)

Add an `unavailable` branch alongside the existing state handling:

- `const unavailable = state === 'unavailable';`
- **Notice** (new, rendered at the top of the card, above `.main`, only when
  `unavailable`): a neutral box with an info glyph and text by reason:
  - `reason === 'noai'` → `"A .noai file disables Iris for this repository, including the chat."`
  - else (`iris-off`) → `"Iris is not available for this exercise right now."`
- **Honest description**: the rendered description is
  `unavailable ? honestDescription(reason) : description` where
  - `reason === 'noai'` → `"A .noai file turns Iris off for this repository."`
  - else → `"Iris chat is turned off for this exercise."`

  The `description` prop stays the source for every chat-active state.
- **Muted row**: apply a `mainMuted` class to `.main` when `unavailable` (dims
  logo/title/description).
- **Disabled Ask, clearly inactive**: keep `askDisabled = state === 'unavailable'`
  (unchanged), but in the `unavailable` state render the button with the
  `secondary` (outline) variant instead of `primary`, so a disabled outline
  control reads as "off" rather than a faded blue CTA.
  `variant={unavailable ? 'secondary' : 'primary'}`.
- The proactive sub-section is already gated by `state !== 'unavailable'` — no
  change; the notice + muted row + disabled Ask are the entire `unavailable`
  card.

The two reason→text mappings (notice and description) live in small local
`Partial<Record<…>>`-style maps or a helper, mirroring the existing `NOTE` map;
`noai` is the only special case, everything else falls back to the `iris-off`
copy (matching today's `reason === 'noai' ? … : …` banner logic, so a defensive
`undefined` reason renders the generic copy).

### 3. `AskIris.module.css`

- `.notice` — the neutral in-card box: flex row with an info glyph and text,
  `padding: 8px 12px`, `border: 1px solid var(--theme-border)`, subtle
  `background: var(--vscode-editorWidget-background, transparent)`,
  `border-radius: 5px`, `color: var(--vscode-descriptionForeground)`,
  `font-size: 0.9em`, `margin-bottom` matching the card's internal spacing.
  **No** colored left border. The glyph is a small inline SVG info icon
  (14px, `currentColor`, `opacity: 0.8`); no codicon dependency (components use
  none today).
- `.mainMuted` — dims the top row without touching the notice:
  logo `filter: grayscale(0.6); opacity: 0.7`, title
  `color: var(--vscode-descriptionForeground)`, description a shade dimmer
  (e.g. `opacity: 0.85` on the already-muted description, or
  `var(--vscode-disabledForeground)`). Exact values finalized in the plan.

If the disabled `secondary` button still reads too "blue/active" in practice, the
plan may add a one-line neutral override class on the button; the default is to
reuse the existing `secondary` variant and add no new button CSS.

### 4. `ExerciseDetailView.tsx`

- Delete the standalone §14 banner block (`ExerciseDetailView.tsx:661-668`,
  the `.banner` rendered when `cardState === 'unavailable'`). Its text now lives
  inside the card via `AskIris`.
- The `<AskIris description="Open the Iris chat to discuss this exercise or get
  guidance." … />` call is unchanged; `AskIris` overrides that description in the
  `unavailable` state.
- Leave the `.banner` CSS class in `ExerciseDetailView.module.css` — it is still
  used by other banners (repository-cloned, rebuild, build-status). Only the §14
  usage is removed.

## Out of scope

- The chat-active card states (`available`, `off-course`, `degraded/limited`,
  `degraded/consent-missing`) — untouched (built by #342).
- The banner text/style of the *other* `.banner` usages (cloned/rebuild/etc.).
- Any change to `deriveProactiveCardState`, the card-state signals, or the level
  control.

## Acceptance criteria

1. In the `unavailable` state (both `noai` and `iris-off`), the "Ask Iris" card
   shows a neutral in-card notice at the top (info glyph, no yellow, no colored
   accent line), a truthful description, a dimmed logo/title/description, and a
   disabled `Ask` button that reads as an inactive outline control.
2. The reason-specific copy matches: `noai` → the `.noai` notice + `.noai`
   description; `iris-off` (or any other unavailable reason) → the generic notice
   + generic description.
3. `ExerciseDetailView` no longer renders a standalone banner above the card for
   the `unavailable` state; the §14 text appears exactly once, inside the card.
4. The chat-active states render exactly as before #334 (description "Open the
   Iris chat…", `Ask` enabled, proactive sub-section per #342).
5. The proactive sub-section remains absent in the `unavailable` state.
6. Lint, `check-types`, and vitest (`npm run test:react`) are green.

## Tests

`extension/test/react/AskIris.cardState.test.tsx`:
- Extend the existing `unavailable → …` test (currently `iris-off`) to also
  assert: the neutral notice text is present, the description is the honest line
  (NOT "Open the Iris chat…"), and the `Ask` button is disabled. Keep the
  existing "no proactive section" assertions.
- Add a sibling `unavailable / noai` test asserting the `.noai` notice text and
  the `.noai` description.

`extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`:
- Add an assertion that for an `unavailable` card the §14 notice text renders
  once, within the Ask Iris card, and there is no separate banner element above
  it (guards the banner-relocation so a future refactor can't silently restore
  the duplicate). Use the existing proactive-card test harness in this file.
