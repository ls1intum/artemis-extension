# Honest "Ask Iris" card for the chat-off state (#334) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the manual Iris chat is off for an exercise (`.noai` or Iris-off), the "Ask Iris" card honestly shows an in-card neutral notice, a truthful description, a dimmed row and a clearly-inactive Ask button — in every build — and live-refreshes on `.noai` toggles.

**Architecture:** Decouple chat-availability from the struggle engine so the card renders in the clean/Open VSX build too (the command module already ships there; only the engine seam is absent). The card push carries a `proactiveControlAvailable` flag; `AskIris` renders the off-card and gates the proactive control on that flag. The standalone §14 banner moves into the card. A latent #342 live-refresh gap is closed by wiring the shared `NoAiDetectionService` to the sidebar provider and each fullscreen exercise panel.

**Tech Stack:** TypeScript, React (webview), VS Code extension host, Vitest (`test/react` + `test/logic`) and Mocha via vscode-test (`test/unit`), CSS Modules.

## Global Constraints

- **Exact copy (verbatim):** noai notice = `A .noai file disables Iris for this repository, including the chat.`; generic/iris-off notice = `Iris is not available for this exercise.`; unavailable description = `The Iris chat is turned off here.`
- **Neutral, not yellow:** the in-card notice uses a neutral/info style (subtle all-around border, info glyph, NO colored accent line, NO warning-yellow).
- **`proactiveControlAvailable` is a required field** on the `updateProactiveControl` payload, the store `ProactiveControlState`, and the AskIris VM. All existing fixtures must set it (`check-types` enforces).
- **Clean-bundle boundary:** add NO import from `services/struggleIntervention/` into any code reachable by the clean bundle; `npm run package:openvsx` must stay green.
- **Test runners:** `test/react` + `test/logic` → Vitest (`npm run test:react`); `test/unit` → Mocha, and it does NOT pre-compile — run `npm run compile-tests` before `npm run test:unit`.
- **Masking, not a new derive input:** in the clean build (no engine) pass `courseProactiveEnabled: undefined` and both gate flags `false` so `deriveProactiveCardState` can only yield `noai`/`iris-off`/`available`. Do NOT add an `enginePresent` input.

---

### Task 1: Decouple `_push` from the engine + carry `proactiveControlAvailable`

**Files:**
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts:461-468` (payload) + stale comment `:27-31`
- Modify: `extension/src/extension/controller/commands/proactiveControlCommands.ts:45-105` (`_push`) + comment `:46-47`
- Modify: `extension/src/extension/services/proactiveCardState.ts` (stale comments `:3-7` and `:27`)
- Modify: `extension/src/extension/telemetry/noop.ts:20-22` (stale comment)
- Test: `extension/test/logic/proactiveControlCommands.test.ts`

**Interfaces:**
- Produces: `updateProactiveControl` payload gains `proactiveControlAvailable: boolean`; `_push` sends it (`!!control`). Consumed by Task 2 (store/VM).

- [ ] **Step 1: Update the existing no-engine test + add the failing tests** in `extension/test/logic/proactiveControlCommands.test.ts`. Extend the `harness` `over` type with `noEngine?: boolean` and set `proactiveControl: over.noEngine ? undefined : control` in the `ctx`. First **rewrite** the existing test at `:73-80` (`'pushes nothing when there is no proactive engine …'`) — the clean build now sends a chat-availability card, so it must use the full harness and assert the new behaviour:

```ts
it('no proactive engine (clean build) → still sends an availability card, control-less', async () => {
    const h = harness({ noEngine: true });
    await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
    expect(h.sent.at(-1)).toMatchObject({ cardState: 'available', proactiveControlAvailable: false });
});
```

Then append inside the same `describe`:

```ts
it('clean build (no engine): .noai → unavailable/noai, proactiveControlAvailable false', async () => {
    const h = harness({ noEngine: true, noAi: true });
    await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
    expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'noai', proactiveControlAvailable: false });
});

it('clean build (no engine): Iris disabled → unavailable/iris-off', async () => {
    const h = harness({ noEngine: true, settings: { settings: { enabled: false, proactiveStruggleEnabled: true } } });
    await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
    expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'iris-off', proactiveControlAvailable: false });
});

it('clean build (no engine): course-proactive-off is masked → available', async () => {
    const h = harness({ noEngine: true, settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } });
    await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
    expect(h.sent.at(-1)).toMatchObject({ cardState: 'available', proactiveControlAvailable: false });
});

it('full build: sends proactiveControlAvailable true', async () => {
    const h = harness({});
    await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
    expect(h.sent.at(-1)).toMatchObject({ cardState: 'available', proactiveControlAvailable: true });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd extension && npx vitest run test/logic/proactiveControlCommands.test.ts`
Expected: the 4 new tests FAIL (`proactiveControlAvailable` undefined / early-return sends nothing when `noEngine`).

- [ ] **Step 3: Add the payload field** in `extension/src/shared/messageContracts/extensionMessages.ts` (inside `updateProactiveControl`, after `cardReason`):

```ts
    /** False in the clean/no-engine build: the card is a chat-availability reflection with no level control. */
    proactiveControlAvailable: boolean;
```

- [ ] **Step 4: Rewrite `_push`** in `extension/src/extension/controller/commands/proactiveControlCommands.ts` (replace the body from the early return through the `sendMessage` call):

```ts
    private async _push(exerciseId: number, courseId?: number): Promise<void> {
        const seq = ++this._pushSeq;
        // Chat-availability (.noai / iris-off) is engine-independent, so the card renders in every build. The
        // proactive control (segments/level) needs the engine seam; when it is absent (clean/Open VSX build) we
        // mask the proactive-only inputs so derive can only yield noai/iris-off/available, and flag the card as
        // control-less so the webview hides the level control.
        const control = this.context.proactiveControl;
        const gate = control?.getProactiveGateState() ?? { consentMissing: false, serverUnavailable: false };
        const stored = this.context.proactivePreference?.getLevel(exerciseId) ?? 'more';

        let irisAvailability: 'enabled' | 'disabled' | 'unavailable' = 'enabled';
        let courseProactiveEnabled: boolean | undefined;
        if (courseId !== undefined) {
            try {
                const { availability, settings } = await classifyIrisCourseAvailability(
                    this.context.artemisApi, async () => courseId);
                irisAvailability = availability.kind;
                courseProactiveEnabled = settings?.settings?.proactiveStruggleEnabled;
            } catch {
                irisAvailability = 'unavailable';
            }
        }

        const chat = this.context.providerRegistry.getChatWebviewProvider();
        await chat?.whenNoAiReady();
        const noAi = chat?.isNoAiEnabled() ?? false;

        const { state: cardState, reason: cardReason } = deriveProactiveCardState({
            irisAvailability,
            noAi,
            courseProactiveEnabled: control ? courseProactiveEnabled : undefined,
            consentMissing: gate.consentMissing,
            serverUnavailable: gate.serverUnavailable,
        });

        const level = cardState === 'available' ? stored : 'off';

        if (seq !== this._pushSeq) {
            return;
        }

        const msg: ExtensionToWebviewMessage = {
            type: ExtensionMsg.UpdateProactiveControl,
            exerciseId,
            level,
            cardState,
            cardReason,
            proactiveControlAvailable: !!control,
        };
        this.context.sendMessage(msg);
    }
```

- [ ] **Step 5: Comment sweep** — four spots now describe the removed early-return behaviour:
  - `proactiveControl​Commands.ts:46-47` is already replaced by the Step 4 rewrite.
  - `proactiveCardState.ts:3-7` header — replace the "clean build never reaches this function" sentence:
    ```ts
     * {@link ProactiveControlCommandModule}. There is no `enginePresent` input: the clean (no-engine) build DOES
     * reach this function now (so its chat-availability card renders), but its `_push` masks the proactive-only
     * inputs (courseProactiveEnabled undefined, both gates false), so only noai/iris-off/available can result.
    ```
  - `proactiveCardState.ts:27` — the §14 case-3 note says "→ Unavailable + banner"; change "banner" to "in-card notice".
  - `extensionMessages.ts:27-31` — the block comment says the clean build "never sends a card at all"; reword to: the clean build DOES send a chat-availability card, but with `proactiveControlAvailable: false` (no level control).
  - `telemetry/noop.ts:20-22` — the OMITTED-methods comment says "no card sent"; reword to: the clean build sends a control-less availability card (the `proactiveControl` seam is omitted, so the AskIris level control stays hidden).

- [ ] **Step 6: Run the tests, verify they pass**

Run: `cd extension && npx vitest run test/logic/proactiveControlCommands.test.ts`
Expected: all PASS (new + existing).

- [ ] **Step 7: Verify types**

Run: `cd extension && npm run check-types`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add extension/src/shared/messageContracts/extensionMessages.ts extension/src/extension/controller/commands/proactiveControlCommands.ts extension/src/extension/services/proactiveCardState.ts extension/src/extension/telemetry/noop.ts extension/test/logic/proactiveControlCommands.test.ts
git commit -m "feat(struggle): render the AskIris availability card without the engine (#334)"
```

---

### Task 2: AskIris honest off-card + store/VM plumbing + banner removal

**Files:**
- Modify: `extension/src/webview/stores/useExerciseDetailStore.ts:20-25` (state type)
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx` (`:138-143` handler, `:255-264` VM, delete `:661-668` banner)
- Modify: `extension/src/webview/components/AskIris/AskIris.tsx` (VM, off-card, gating, testId, comment `:32`)
- Modify: `extension/src/webview/components/AskIris/AskIris.module.css`
- Test: `extension/test/react/AskIris.cardState.test.tsx`, `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`
- Fixture migration: `extension/test/react/AskIris.proactiveControl.test.tsx:11`, `extension/test/react/useExerciseDetailStore.proactiveControl.test.ts:8`

**Interfaces:**
- Consumes: `proactiveControlAvailable` from Task 1's payload.
- Produces: AskIris VM field `controlAvailable: boolean`; `Container` gets `data-testid="ask-iris-card"`.

- [ ] **Step 1: Migrate the shared fixture + add failing tests** in `extension/test/react/AskIris.cardState.test.tsx`. Add the CSS-module import at the top (`import styles from '@webview/components/AskIris/AskIris.module.css';`) for the class assertion. Add `controlAvailable: true as const` to the `control()` helper's defaults. Then add:

```ts
it('unavailable/iris-off → neutral notice, honest description, no proactive section, Ask disabled', () => {
    render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'iris-off' })} />);
    expect(screen.getByText('Iris is not available for this exercise.')).toBeInTheDocument();
    expect(screen.getByText('The Iris chat is turned off here.')).toBeInTheDocument();
    expect(screen.queryByText(/Open the Iris chat/i)).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
});

it('unavailable/noai → the .noai notice', () => {
    render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'noai' })} />);
    expect(screen.getByText('A .noai file disables Iris for this repository, including the chat.')).toBeInTheDocument();
});

it('unavailable with no reason → generic notice fallback', () => {
    render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: undefined })} />);
    expect(screen.getByText('Iris is not available for this exercise.')).toBeInTheDocument();
});

it.each([
    { cardState: 'available' as const, reason: undefined },
    { cardState: 'off-course' as const, reason: 'course-off' as const },
    { cardState: 'degraded' as const, reason: 'limited' as const },
    { cardState: 'degraded' as const, reason: 'consent-missing' as const },
])('chat-active state $cardState/$reason keeps the passed description and renders no notice', ({ cardState, reason }) => {
    render(<AskIris {...base} proactiveControl={control({ cardState, reason, level: reason === 'consent-missing' ? 'off' : 'more', onOpenConsentSettings: vi.fn() })} />);
    expect(screen.getByText('d')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
});

it('unavailable → the disabled Ask carries the neutral unavailableAsk class', () => {
    render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'noai' })} />);
    expect(screen.getByRole('button', { name: /ask/i })).toHaveClass(styles.unavailableAsk);
});

it('clean build (controlAvailable false) + available → bare card, no segments, Ask enabled', () => {
    render(<AskIris {...base} proactiveControl={control({ cardState: 'available', controlAvailable: false })} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText('Proactive help')).toBeNull();
    expect(screen.getByText('d')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
});

it('clean build (controlAvailable false) + unavailable/noai → off-card still renders', () => {
    render(<AskIris {...base} proactiveControl={control({ cardState: 'unavailable', reason: 'noai', controlAvailable: false })} />);
    expect(screen.getByText('A .noai file disables Iris for this repository, including the chat.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd extension && npx vitest run test/react/AskIris.cardState.test.tsx`
Expected: new tests FAIL (notice/description not rendered; segments still shown when `controlAvailable` false).

- [ ] **Step 3: Add `controlAvailable` to the store state** in `extension/src/webview/stores/useExerciseDetailStore.ts` (inside `ProactiveControlState`):

```ts
    proactiveControlAvailable: boolean;
```

- [ ] **Step 4: Thread it through `ExerciseDetailView.tsx`.** In the `UpdateProactiveControl` handler (`:138-143`) add `proactiveControlAvailable: msg.proactiveControlAvailable,`. In `proactiveVM` (`:255-264`) add `controlAvailable: proactiveControl.proactiveControlAvailable,`. Delete the standalone banner block at `:661-668` (the comment line plus the `{proactiveControl && … cardState === 'unavailable' && (<div className={styles.banner} …>…</div>)}`).

- [ ] **Step 5: Rewrite `AskIris.tsx`.** Add `import clsx from 'clsx';`. Add `controlAvailable: boolean;` to `ProactiveControlVM`. Replace the derivation block and the JSX so it reads:

```tsx
  const state = proactiveControl?.cardState;
  const unavailable = state === 'unavailable';
  const askDisabled = unavailable;
  const consentMissing = state === 'degraded' && proactiveControl?.reason === 'consent-missing';
  const showSegments = state === 'available' || state === 'off-course' || consentMissing;
  const segmentsDisabled = state === 'off-course' || consentMissing;
  // Proactive control only when the engine supplied it AND the chat is not fully off.
  const showProactive = Boolean(proactiveControl?.controlAvailable) && !unavailable;

  // §14 chat-off copy: notice = cause (noai vs generic), description = one consistent effect line.
  const noticeText = unavailable
    ? (proactiveControl?.reason === 'noai'
        ? 'A .noai file disables Iris for this repository, including the chat.'
        : 'Iris is not available for this exercise.')
    : undefined;
  const shownDescription = unavailable ? 'The Iris chat is turned off here.' : description;
```

JSX (Container gets the testId; notice before `.main`; `.main` gains `mainMuted`; Ask button gains the neutral class; the proactive block is gated on `showProactive`):

```tsx
    <Container padding="cozy" testId="ask-iris-card">
      {noticeText && (
        <div className={styles.notice} role="status">
          <svg className={styles.noticeIcon} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 118 2.5a5.5 5.5 0 010 11zM7.25 7h1.5v4.5h-1.5V7zm0-2.5h1.5V6h-1.5V4.5z"/>
          </svg>
          <span>{noticeText}</span>
        </div>
      )}
      <div className={clsx(styles.main, unavailable && styles.mainMuted)}>
        <div className={styles.logoCol}>
          <img className={styles.logo} src={document.getElementById('root')?.dataset.irisLogoUri} alt="" />
        </div>
        <div className={styles.textCol}>
          <h3 className={styles.title}>Ask Iris</h3>
          <p className={styles.description}>{shownDescription}</p>
        </div>
        <div className={styles.buttonCol}>
          <Button variant="primary" onClick={onClick} disabled={askDisabled} className={unavailable ? styles.unavailableAsk : undefined}>Ask</Button>
        </div>
      </div>

      {showProactive && proactiveControl && (
        <>
          {/* …the existing proactive block, unchanged (only the guard condition changes from
              `proactiveControl && state !== 'unavailable'` to `showProactive && proactiveControl`)… */}
        </>
      )}
    </Container>
```

The explicit `&& proactiveControl` is required — `Boolean(proactiveControl?.controlAvailable)` does not narrow `proactiveControl` non-null for the dereferences inside the block (`proactiveControl.level`, `.onLevelChange`, `.onOpenConsentSettings`).

Also update **two** stale comments in `AskIris.tsx`: the `NOTE`/section comment near `:32` ("the full §14 banner for `unavailable` lives in the exercise view") and the proactive-block comment near `:69` ("Hidden on the full shut-off (unavailable), which the exercise view's §14 banner already explains") — both must reflect that the notice now lives in-card and the block is hidden when `unavailable` OR the engine is absent.

- [ ] **Step 6: Add the CSS** to `extension/src/webview/components/AskIris/AskIris.module.css`:

```css
/* §14 chat-off notice, neutral (no warning colour, no accent line). Spaced from .main by Container's flex gap. */
.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--theme-border);
  background: var(--vscode-editorWidget-background, transparent);
  border-radius: 5px;
  color: var(--vscode-descriptionForeground);
  font-size: 0.9em;
}

.noticeIcon {
  flex: none;
  opacity: 0.8;
}

/* Chat-off: dim the row, leaving the notice sharp. */
.mainMuted .logo { filter: grayscale(0.6); opacity: 0.7; }
.mainMuted .title { color: var(--vscode-descriptionForeground); }
.mainMuted .description { color: var(--vscode-descriptionForeground); opacity: 0.85; }

/* Neutral disabled Ask — higher specificity than the shared .btn:disabled so it reads as a deliberate off-state. */
.buttonCol .unavailableAsk:disabled {
  background: transparent;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--theme-border);
  opacity: 1;
}
```

- [ ] **Step 7: Add the containment test** in `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` (import `within` from `@testing-library/react` if not already imported). The EXISTING proactive-card/consent seed at `:168` must get `proactiveControlAvailable: true` (a `false` there would hide the consent control and break that test). Then add a NEW test that seeds an `unavailable/noai` card with `proactiveControlAvailable: false` and asserts:

```ts
const card = screen.getByTestId('ask-iris-card');
const notice = 'A .noai file disables Iris for this repository, including the chat.';
expect(screen.getAllByText(notice)).toHaveLength(1);
expect(within(card).getByText(notice)).toBeInTheDocument();
expect(screen.queryByText(/Open the Iris chat/i)).toBeNull();
expect(document.querySelector('[data-variant="warning"]')).toBeNull();
```

- [ ] **Step 8: Migrate the remaining fixtures** (all set to `true` so they keep exercising the full-build path; `check-types` enforces): `extension/test/react/AskIris.proactiveControl.test.tsx` — add `controlAvailable: true` to ALL THREE direct VM literals (`:11`, `:20`, `:26`); `extension/test/react/useExerciseDetailStore.proactiveControl.test.ts:8` — add `proactiveControlAvailable: true` to the state literal.

- [ ] **Step 9: Run tests + types**

Run: `cd extension && npx vitest run test/react/AskIris.cardState.test.tsx test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx test/react/AskIris.proactiveControl.test.tsx test/react/useExerciseDetailStore.proactiveControl.test.ts && npm run check-types`
Expected: all PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add extension/src/webview/stores/useExerciseDetailStore.ts extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx extension/src/webview/components/AskIris/AskIris.tsx extension/src/webview/components/AskIris/AskIris.module.css extension/test/react/AskIris.cardState.test.tsx extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx extension/test/react/AskIris.proactiveControl.test.tsx extension/test/react/useExerciseDetailStore.proactiveControl.test.ts
git commit -m "feat(struggle): honest in-card off-state for the AskIris card (#334)"
```

---

### Task 3: Live `.noai` refresh — sidebar provider + fullscreen panel

**Files:**
- Modify: `extension/src/extension/provider/artemisWebviewProviderDeps.ts` (deps)
- Modify: `extension/src/extension/provider/artemisWebviewProvider.ts` (field, subscription, pass to manager, comment `:444-445`)
- Modify: `extension/src/extension.ts:243` (wire the dep)
- Modify: `extension/src/extension/services/ui/fullscreenPanelManager.ts` (ctor param + `noAiSub`)
- Test: `extension/test/unit/provider/artemisWebviewProvider.test.ts`, `extension/test/unit/services/ui/fullscreenPanelManager.test.ts`

**Interfaces:**
- Consumes: the shared `NoAiDetectionService` (`extension.ts:214`).

**Ordering note:** `noAiDetectionService` is a REQUIRED dep + ctor arg, so the type scaffolding and every constructor fixture must land before any test compiles. This task therefore scaffolds types + migrates fixtures FIRST (green baseline), then does red→green on the behaviour.

- [ ] **Step 1: Add the dep to the interface** — `extension/src/extension/provider/artemisWebviewProviderDeps.ts`: add `import type { NoAiDetectionService } from '@extension/services/workspace';` and `noAiDetectionService: NoAiDetectionService;`.

- [ ] **Step 2: Provider scaffolding (no subscription yet)** — `extension/src/extension/provider/artemisWebviewProvider.ts`: add `import type { NoAiDetectionService } from '@extension/services/workspace';` (the provider file needs its OWN import, not just the deps file); add field `private readonly _noAiDetectionService: NoAiDetectionService;`; assign `this._noAiDetectionService = deps.noAiDetectionService;` in the constructor BEFORE the `FullscreenPanelManager` construction (`:189`); pass it as the 4th arg: `new FullscreenPanelManager(this._extensionUri, this._extensionContext, () => this._messageHandler, this._noAiDetectionService)`.

- [ ] **Step 3: Fullscreen scaffolding (param stored, unused yet)** — `extension/src/extension/services/ui/fullscreenPanelManager.ts`: add `import type { NoAiDetectionService } from '@extension/services/workspace';` and a 4th ctor param `private readonly _noAiDetectionService: NoAiDetectionService`.

- [ ] **Step 4: Wire extension.ts** — add `noAiDetectionService,` to the `new ArtemisWebviewProvider({ … })` deps object at `extension/src/extension.ts:243`.

- [ ] **Step 5: Migrate ALL constructor fixtures so the suites compile** —
  - `extension/test/unit/provider/artemisWebviewProvider.test.ts`: every `new ArtemisWebviewProvider({ … })` deps object (`:141`, `:207`, `:385`) gets `noAiDetectionService: fakeNoAi`. Define a suite-scoped fake: `let noAiCb: (v: boolean) => void = () => {}; const fakeNoAi = { onNoAiStatusChanged: (cb: (v: boolean) => void) => { noAiCb = cb; return { dispose() {} }; }, dispose() {} } as any;` (the `() => {}` default keeps `noAiCb(true)` a safe no-op before any subscription exists).
  - `extension/test/unit/services/ui/fullscreenPanelManager.test.ts`: every `new FullscreenPanelManager(...)` construction (`:35`, and the `openStruggleFullscreen` suite at `:109`) gets a 4th arg — a fake `noAiDetectionService` of the same shape. The `.noai` suite (Step 7) needs its fake to expose a suite-scoped `noAiCb` and a `dispose` spy.

- [ ] **Step 6: Compile + green baseline** — `cd extension && npm run compile-tests && npm run test:unit` (read `extension/reports/mocha-results.xml`) and `npm run check-types`. Expected: everything compiles, existing tests still pass (no behaviour added yet).

- [ ] **Step 7: Add the failing behavioural tests**
  - Provider (`artemisWebviewProvider.test.ts`, in the suite whose setup already resolves the view — mirror the `updateProactiveConsent` test at `:332`):
    ```ts
    test('a .noai status change posts updateNoAiStatus to the webview (both directions)', async () => {
        spyWebview.sentMessages.length = 0;
        noAiCb(true);
        assert.ok(spyWebview.sentMessages.some(m => m.type === 'updateNoAiStatus'), 'expected updateNoAiStatus after .noai appears');
        spyWebview.sentMessages.length = 0;
        noAiCb(false);
        assert.ok(spyWebview.sentMessages.some(m => m.type === 'updateNoAiStatus'), 'expected updateNoAiStatus after .noai disappears');
    });
    ```
  - Fullscreen (`fullscreenPanelManager.test.ts`, NEW suite with its OWN `exerciseData` fixture — the consent suite's `exerciseData` is local to its test at `:132` and cannot be reused). The fake returns a `dispose` spy so disposal is provable (the panel's own `disposed` guard at `:181` would otherwise let a missing `noAiSub.dispose()` pass silently):
    ```ts
    suite('FullscreenPanelManager.openExerciseFullscreen - #334 .noai flip', () => {
        const exerciseData = { exercise: { id: 1, title: 'X', studentParticipations: [] } };
        let noAiCb: (v: boolean) => void = () => {};
        let disposeSpy: sinon.SinonSpy;
        // makeManager()'s fake noAiDetectionService: { onNoAiStatusChanged: (cb) => { noAiCb = cb; return { dispose: disposeSpy }; } }
        const awaitNoAiMsg = async (deadlineMs: number): Promise<boolean> => {
            const start = Date.now();
            while (Date.now() - start < deadlineMs) {
                if (postMessage.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'updateNoAiStatus')) { return true; }
                await new Promise(r => setTimeout(r, 20));
            }
            return false;
        };

        test('a .noai flip posts updateNoAiStatus (both directions), and the subscription is disposed once with the panel', async () => {
            const manager = makeManager();
            manager.openExerciseFullscreen(exerciseData as never);
            // …await the panel's onReady as the consent suite does…
            postMessage.resetHistory();
            noAiCb(true);
            assert.ok(await awaitNoAiMsg(2000), 'expected updateNoAiStatus after .noai appears');
            postMessage.resetHistory();
            noAiCb(false);
            assert.ok(await awaitNoAiMsg(2000), 'expected updateNoAiStatus after .noai disappears');
            // …dispose the panel as the consent suite's dispose case does (:144)…
            assert.ok(disposeSpy.calledOnce, 'the .noai subscription must be disposed exactly once with the panel');
        });
    });
    ```
    `sinon` is already imported in this file for the consent coverage.

- [ ] **Step 8: Run, verify failure** — `cd extension && npm run compile-tests && npm run test:unit`; read `extension/reports/mocha-results.xml`. Expected: the new provider + fullscreen tests FAIL (nothing subscribes yet, so `noAiCb` stays the no-op default → no message; `disposeSpy` never called).

- [ ] **Step 9: Implement the sidebar subscription** — in `resolveWebviewView`, right after `this._viewDisposables.push(configListener);` (`:450`):

```ts
        // #334: a .noai create/delete must live-refresh the exercise card (the view re-requests on this message).
        const noAiListener = this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
            this._postMessageSafe({ type: ExtensionMsg.UpdateNoAiStatus, isNoAiDetected });
        });
        this._viewDisposables.push(noAiListener);
```

Also fix the now-wrong consent comment at `artemisWebviewProvider.ts:444-445` (the clean build no longer early-returns; the re-request now yields a card).

- [ ] **Step 10: Implement the fullscreen subscription** — in `openExerciseFullscreen`, add `let noAiSub: vscode.Disposable | undefined;` beside `consentSub`; inside `onReady`, after the `consentSub` guard:

```ts
                if (!noAiSub) {
                    noAiSub = this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                        postSafe({ type: ExtensionMsg.UpdateNoAiStatus, isNoAiDetected });
                    });
                }
```

and extend `onDispose` to `{ consentSub?.dispose(); consentSub = undefined; noAiSub?.dispose(); noAiSub = undefined; }`.

- [ ] **Step 11: Run tests + types** — `cd extension && npm run compile-tests && npm run test:unit` (read `extension/reports/mocha-results.xml`); `npm run check-types`. Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add extension/src/extension/provider/artemisWebviewProviderDeps.ts extension/src/extension/provider/artemisWebviewProvider.ts extension/src/extension.ts extension/src/extension/services/ui/fullscreenPanelManager.ts extension/test/unit/provider/artemisWebviewProvider.test.ts extension/test/unit/services/ui/fullscreenPanelManager.test.ts
git commit -m "fix(struggle): live-refresh the AskIris card on .noai toggles, both surfaces (#334)"
```

---

### Final verification (after all tasks)

- [ ] `cd extension && npm run lint && npm run check-types`
- [ ] `cd extension && npm run test:react`
- [ ] `cd extension && npm run compile-tests && npm run test:unit` (read `extension/reports/mocha-results.xml`)
- [ ] `cd extension && npm run package:openvsx` — clean-bundle verifier green; confirm no `services/struggleIntervention/` import entered the bundle.
