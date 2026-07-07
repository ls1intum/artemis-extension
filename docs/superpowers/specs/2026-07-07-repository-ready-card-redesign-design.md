# Repository-Ready Card Redesign — Design

**Date:** 2026-07-07
**Status:** Design approved (brainstormed via the visual companion), revised after a codex
spec review. Not yet planned/implemented.
**Area:** `extension/src/webview` — Exercise Detail view, participation + build-status surface.

## Goal

Declutter the "Repository Ready" card in the Exercise Detail view. Today one `Container`
stacks a participation headline, a redundant sub-sentence, a workspace-status row, a
Submit control, a "More options" menu, and a full build-status block (label + badge +
score + link) — seven vertical blocks in one box. The redesign keeps everything in **one
card** but collapses it to a tight header + a single state-aware action + a one-line build
row, and reworks how each state is shown.

This is a **presentational restructure**. All data already flows into the two components;
no new props, messages, or server fields are introduced.

## Scope

**In scope** — the participated **programming** state only:
- `ParticipationActions.tsx` — the `isProgramming && hasParticipation` branch
  (participation info + workspace status + submit group + more menu).
- `SubmissionStatus.tsx` — the `exerciseType === 'programming'` build-status rendering
  (building / finished / failed / no-submission).
- The two matching `.module.css` files.

**Out of scope (unchanged):**
- Non-programming exercises (quiz/text/modeling/file-upload) rendering.
- The not-started / practice-available branches (Start Exercise / Practice buttons). Only
  the participated card is redesigned.
- The **contents** of the "More options" dropdown (Clone Repository, Check workspace
  status, Open Repository, Pull Changes, Copy Clone URL / with token, Open in browser).
  Only its trigger placement moves.
- The commit-message input (the ✉ toggle target), the cloned-repo notice.
- `BuildStatusStrip` (the sticky #280 strip shown while scrolled away). Deferred follow-up:
  align it to the new build vocabulary later; unchanged for now.
- `ExerciseDetailView.tsx` wiring — it already passes every prop the redesign needs
  (`workspaceStatus`, `hasUnsavedChanges`, `canSubmit`, `score`, `maxScore`,
  `scorePercentage`, `totalTests`, `passedTests`, `hasTestInfo`, `buildFailed`,
  `estimatedCompletionDate`, `buildStartDate`, `onOpenTestResults`, `onViewBuildLog`,
  `onGoToSource`). No changes expected there.

## Card anatomy (top → bottom)

```
┌────────────────────────────────────────────┐
│ Repository Ready                    More ▾  │   ← header row (title + menu trigger)
│ ● Up to date                                │   ← workspace hint  (or auto-save warning)
│ [ Submit ............... ] [ ✉ ]           │   ← state-aware action row
│ ────────────────────────────────────────── │   ← divider
│ [8/35 tests]   23.1/101 p (22.9%)  Results ›│   ← build row (varies by build state)
└────────────────────────────────────────────┘
```

1. **Header row** — a persistent title `Repository Ready` on the left; a labeled link
   `More ▾` on the right (top-right). Decision: the title is **kept** — it anchors `More ▾`
   on a stable line and lets the hint/warning below own a full-width line. (Dropping the
   title crowds `More ▾` once the hint grows into the multi-line auto-save warning.)
   `More ▾` opens the existing dropdown, unchanged.

2. **Hint line** — one line that reflects the workspace state (see State matrix), or is
   taken over by the auto-save warning when files are unsaved (see Auto-save priority).

3. **Action row** — `Submit` (primary) + `✉` (commit-message toggle), OR `Clone Repository`
   (primary, full width) when the repo is not in the workspace. The ✉ button and the
   commit-message input behave exactly as today.

4. **Divider** — thin `--vscode-panel-border` rule.

5. **Build row** — one row (occasionally a second line) that varies by build state
   (see Build display).

**Retained conditional rows** (currently in this branch, kept — codex flagged they were
unspecified). Order within the card, when present:
- **Practice-mode indicator** (`isPracticeMode`): the existing small "🧪 Practice Mode" chip,
  at the very top of the card (above the header row / title).
- **Cloned-repo notice** (`showClonedNotice`): the existing "Repository recently cloned —
  Open now" notice, kept as-is, sitting just above the action row.
- These are independent of the hint/warning slot and stack in the order: practice chip →
  header → hint/warning → cloned notice → action row → (commit-message input) → divider →
  build row.

## State matrix — workspace hint + action

The hint is a small colored line above the action; the action button changes with the
state. Colours reuse existing theme vars.

| Workspace state | Hint (dot + text) | Action |
|---|---|---|
| `clean` | green `● Up to date` (small, dimmed) | `Submit` **disabled** + `✉` disabled |
| `dirty` | amber `● Uncommitted changes ready to submit` | `Submit` enabled (blue) + `✉` |
| `disconnected` | red `● Repository not in your workspace` | `Clone Repository` (blue, full width); no Submit |
| `checking` | muted pulsing `● Checking workspace…` | `Submit` disabled + `✉` disabled |

Notes:
- The green clean hint is deliberately small/quiet (the earlier "Workspace is up to date"
  full row was the clutter being removed). It confirms "you're set up" without shouting.
- `Submit` disabled on `clean` preserves today's behaviour (nothing new to submit). Submit
  is enabled only when `workspaceStatus === 'dirty'` (matches today's `canSubmit && !clean`).
- **`wrong-repo` is intentionally omitted.** `ParticipationActions`'s prop type allows it,
  but the current wiring never produces it — `ExerciseDetailView` derives only
  `checking | disconnected | dirty | clean` from `repoStatus`, and a wrong repo already
  collapses to `disconnected` upstream in `workspaceDetectionService`. Treating it as a
  distinct card state would need new plumbing, which is out of scope. If the prop ever
  arrives as `wrong-repo`, it falls through to the `disconnected` treatment.
- In the **managed (EduIDE) environment** the `disconnected` action is `Open in Artemis`
  instead of `Clone Repository`, per the existing `isManagedEnvironment` logic.
- Colour map: green `--vscode-testing-iconPassed` (#73c991); amber
  `--vscode-editorWarning-foreground` (#cca700); red `--vscode-errorForeground` (#f48771);
  the pulsing checking dot reuses the existing `changesPulse` animation.

## Auto-save / unsaved-files warning (priority over the hint)

`hasUnsavedChanges` is an **independent** signal (editor has unsaved files AND autosave is
off), derived separately from the git/repo state — so it can co-occur with any workspace
state. The warning takes the hint slot **only when the repo is connected** (`clean` or
`dirty`), i.e. exactly the states whose action is Submit:

```
⚠ Unsaved files. Save before submitting.  [Configure auto-save]
```

- **Connected (`clean`/`dirty`) + unsaved:** the amber warning block replaces the workspace
  hint for that render (unsaved > "ready to submit" / "up to date"). One hint line at a time.
- **Not connected (`disconnected`/`checking`) + unsaved:** the **workspace hint wins** and
  the auto-save warning is suppressed. Rationale (codex): the workspace hint explains why
  the action is Clone / why Submit is absent; hiding it behind "save before submitting"
  would strand the user (and you cannot submit in these states anyway).
- **The warning never changes Submit's enabled/disabled state.** Submit's gating is purely
  the workspace state (disabled on `clean`, enabled on `dirty`). Note `clean + unsaved` is a
  real transient (you typed but have not saved, so git is still clean → Submit stays
  disabled); once you save, git flips to `dirty` and Submit enables. The warning informs,
  it does not gate.
- Same amber styling family as the `dirty` hint but as a bordered block (higher weight) with
  the existing `Configure auto-save` link (`onConfigureAutoSave`).

## Build display (SubmissionStatus, programming)

Rule of thumb agreed: **a bar only while building**; every finished result is
**badge/text**, no bar.

### Building / pending — progress bar is the anchor
- **Determinate** (`useBuildProgress` returns `progressPercent !== null`): a bar that fills
  toward completion, with label `Building your submission…` and a trailing `ETA {etaSeconds}s`
  (only when `etaSeconds !== null`). The bar and ETA update live via the existing hook.
- **Indeterminate** (`progressPercent === null` — no timing info, or the timing window is
  invalid/already elapsed): the existing shimmering indeterminate bar, label
  `Building your submission…` (no ETA suffix).
- **Pending / queued**: indeterminate bar, label `Build queued, waiting for resources…`.

(Reuses the existing `.buildProgressTrack` / `.buildProgressBar` +
`buildProgressBarIndeterminate` machinery and `useBuildProgress`.)

### Finished with tests — badge + points + link (one row, wraps honestly)
```
[8/35 tests]        23.1/101 p (22.9%)        Results ›
```
- **Badge** — outlined (border + coloured text, transparent fill), not the current filled
  pill, to lower visual weight. Text = `passed/total tests`. Colour tiers preserved from
  today: pass% ≥ 80 → green, ≥ 40 → amber, else red.
- **Score** — `earned/max p (pct%)`, where **`p` abbreviates "points"** and the percent is
  in parens and dimmed. The number is coloured by the same tier thresholds
  (`scoreSuccess/Warning/Error`). Examples: `23.1/101 p (22.9%)` (red),
  `101/101 p (100%)` (green).
- **Fallback when the exercise has no points** (`maxPoints === 0`): show just the percent
  (`22.9%`) in place of the points expression.
- **Link** — `Results ›` → `onOpenTestResults` (opens the existing `TestResultsOverlay`).
- The row is allowed to **wrap** (flex-wrap): on a narrow sidebar the score or the link
  drops to a second line rather than truncating; on a wide sidebar it stays one line.

### Finished without test info (completed, not failed) — status badge + points
When the build completed and did not fail but there is no test-case info (`!hasTestInfo`,
`!buildFailed`), mirror today's behaviour: an outlined status badge —
`Build Success` (green) when `status === 'success'`, else `Tests Failed` (red) — followed by
the same points/percent expression. **No `Results ›` link** (there is nothing to open;
`onOpenTestResults`/`See test results` was already gated on `hasTestInfo` today).

### Build failed — text + actions
```
✕ Build failed
[ Go to source ]   Open log        (Results ›)
```
- Status line: red `✕ Build failed` (takes precedence over any test badge).
- Action row = **layout C without icons**: a filled **primary** `Go to source` button
  (fixing the code is the real next step) + a quiet secondary `Open log` **link**. No
  icons/glyphs on either.
- Wiring: `Go to source` → `onGoToSource`; `Open log` → `onViewBuildLog`.
- **Edge case `buildFailed && hasTestInfo`** (both true, as the current code handles):
  keep the failed treatment above and additionally append a quiet `Results ›` link
  (→ `onOpenTestResults`) after `Open log`, since test results do exist. When
  `!hasTestInfo` (the usual compile-failure case) there is no `Results ›`.

### No submission yet
- A single muted placeholder line `No builds yet — submit to see results` in place of the
  build row. (Minimal; not a focus of the redesign.)

## Behaviour / wiring (unchanged)
- `Submit` → `onSubmit`; `✉` → `onToggleCommitMessage`; commit-message input →
  `onCommitMessageChange` (appears below the action row when toggled), exactly as today.
- `Clone Repository` → `onClone`; in a managed (EduIDE) environment the primary becomes
  `Open in Artemis` per the existing `isManagedEnvironment` logic.
- `More ▾` dropdown content and all its callbacks are untouched.

## Accessibility
- The `✉` commit-message toggle is icon-only and currently has **no accessible name**; in
  the tighter card the plan must add an `aria-label` (e.g. "Add a commit message"). Same for
  any other icon-only control introduced (none planned beyond `✉`).
- Status is not signalled by colour alone: each hint keeps its text ("Up to date",
  "Uncommitted changes…", "Not in your workspace", "Build failed", etc.) alongside the colour.

## Files
- `extension/src/webview/components/exercise/ParticipationActions.tsx` (+ `.module.css`)
  — participated-programming branch: header (title + `More ▾`), workspace hint / auto-save
  warning, state-aware action row, retained practice/cloned rows.
- `extension/src/webview/components/exercise/SubmissionStatus.tsx` (+ `.module.css`)
  — building bar (determinate/indeterminate), finished badge + points + `Results ›`,
  finished-without-test-info status badge, build-failed text + `Go to source` / `Open log`.

## Testing impact (existing React tests to update)
The redesign changes visible copy/labels, so these vitest React tests (which assert on the
old strings) must be updated as part of the same change — not left failing:
- `extension/test/react/views/ExerciseDetail/components/SubmissionStatus.test.tsx` — asserts
  `Latest Build Status`, `Build in Progress`, `See test results`.
- `extension/test/react/components/exercise/ParticipationActions.test.tsx` — asserts
  `Workspace is up to date`, `Uncommitted changes detected`, `Checking workspace status...`,
  and the `More options ▾` trigger label.
Update assertions to the new copy; add cases for the new/edge build states
(`buildFailed && hasTestInfo`, finished-without-test-info, determinate vs indeterminate
building) and the auto-save-vs-workspace-hint priority. No telemetry is coupled to these
labels (tracked events are callback-based in `ExerciseDetailView`), so no telemetry changes.

## Deferred / follow-up
- `BuildStatusStrip` (#280) later adopts the same building-bar / badge vocabulary for
  visual consistency. Not in this change.

## Open questions
None — all decisions locked during brainstorming (direction A; `More ▾` labeled header
link; bar only while building with determinate+shimmer; finished = badge/text; workspace
hint + state-aware button; auto-save takes the hint slot; points as `x/y p (z%)`; keep the
title).
