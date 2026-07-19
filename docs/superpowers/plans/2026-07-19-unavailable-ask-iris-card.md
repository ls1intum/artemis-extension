# Honest "Ask Iris" card for the chat-off state (#334) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the manual Iris chat is off for an exercise (`.noai` or Iris-off), the "Ask Iris" card honestly shows an in-card neutral notice, a truthful description, a dimmed row and a clearly-inactive Ask button — in every build — and live-refreshes on `.noai` toggles.

**Architecture:** Decouple chat-availability from the struggle engine so the card renders in the clean/Open VSX build too (the command module already ships there; only the engine seam is absent). The card push carries a `proactiveControlAvailable` flag; `AskIris` renders the off-card and gates the proactive control on that flag. The standalone §14 banner moves into the card. A latent #342 live-refresh gap is closed by wiring the shared `NoAiDetectionService` to the sidebar provider and each fullscreen exercise panel.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), React (webview), VS Code extension host, Vitest (`test/react` + `test/logic`) and Mocha via vscode-test (`test/unit`), CSS Modules.

## Global Constraints

- **Exact copy (verbatim):** noai notice = `A .noai file disables Iris for this repository, including the chat.`; generic/iris-off notice = `Iris is not available for this exercise.`; unavailable description = `The Iris chat is turned off here.`
- **Neutral, not yellow:** the in-card notice uses a neutral/info style (subtle all-around border, info glyph, NO colored accent line, NO warning-yellow).
- **`proactiveControlAvailable` is a required field** on the `updateProactiveControl` payload, the store `ProactiveControlState`, and (as `controlAvailable`) the AskIris VM. All existing fixtures must set it; `check-types` enforces.
- **Strict TS:** `noUnusedLocals`/`noUnusedParameters` are on — never leave a declared-but-unread private property or local (prefix genuinely-unused ctor params with `_`).
- **Clean-bundle boundary:** add NO import from `services/struggleIntervention/` into clean-bundle-reachable code; `npm run package:openvsx` must stay green.
- **Test runners:** `test/react` + `test/logic` → Vitest (`npm run test:react`); `test/unit` → Mocha, which does NOT pre-compile — run `npm run compile-tests` before `npm run test:unit`, and read results from `extension/reports/mocha-results.xml` (console summary is swallowed by the socket-path quirk).
- **Masking, not a new derive input:** in the clean build (no engine) pass `courseProactiveEnabled: undefined` and both gate flags `false` so `deriveProactiveCardState` can only yield `noai`/`iris-off`/`available`. Do NOT add an `enginePresent` input.
- **Commit safety:** Task 1 lands the host flag AND the UI gating together (one commit), so no intermediate state ever ships a control-less card with dead segments.

---

### Task 1: Honest availability card in every build

The host decoupling and the webview UI land as ONE commit so every build stays consistent. Types land first (so the required-field tests compile), then red tests, then behaviour.

**Files:**
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts` (payload field `:461-468`; stale comments `:27-31`, `:33`)
- Modify: `extension/src/extension/controller/commands/proactiveControlCommands.ts:45-105` (`_push`) + comment `:46-47`
- Modify: `extension/src/extension/services/proactiveCardState.ts` (comments `:3-7`, `:27`)
- Modify: `extension/src/extension/telemetry/noop.ts:20-22` (comment)
- Modify: `extension/src/webview/stores/useExerciseDetailStore.ts:20-25` (state type)
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx` (`:138-143` handler, `:255-264` VM, delete `:661-668` banner)
- Modify: `extension/src/webview/components/AskIris/AskIris.tsx` (VM, off-card, gating, testId, comments `:32`, `:69`) + `AskIris.module.css`
- Test: `extension/test/logic/proactiveControlCommands.test.ts`, `extension/test/react/AskIris.cardState.test.tsx`, `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`
- Fixtures: `extension/test/react/AskIris.proactiveControl.test.tsx`, `extension/test/react/useExerciseDetailStore.proactiveControl.test.ts`

- [ ] **Step 1: Land the types + the minimal `_push` flag (keeps existing behaviour, so it compiles).**
  - `extensionMessages.ts` — in the `updateProactiveControl` payload (after `cardReason`):
    ```ts
        /** False in the clean/no-engine build: the card is a chat-availability reflection with no level control. */
        proactiveControlAvailable: boolean;
    ```
  - `proactiveControlCommands.ts` — add `proactiveControlAvailable: !!this.context.proactiveControl,` to the `msg` literal (`:97-103`). (Past the current early return `control` is truthy, so this is `true` for now; the clean-build path is enabled in Step 5.)
  - `useExerciseDetailStore.ts` — add `proactiveControlAvailable: boolean;` to `ProactiveControlState` (`:20-25`).
  - `AskIris.tsx` — add `controlAvailable: boolean;` to `ProactiveControlVM` (`:15-24`). (Rendering unchanged this step.)

- [ ] **Step 2: Migrate every existing fixture to the required fields** (so the suites still compile and pass):
  - `AskIris.cardState.test.tsx` — add `controlAvailable: true as const` to the `control()` helper defaults; add `import styles from '@webview/components/AskIris/AskIris.module.css';` at the top.
  - `AskIris.proactiveControl.test.tsx` — add `controlAvailable: true` to ALL THREE direct VM literals (`:11`, `:20`, `:26`).
  - `useExerciseDetailStore.proactiveControl.test.ts:8` — add `proactiveControlAvailable: true` to the state literal.
  - `ExerciseDetailView.test.tsx:168` — add `proactiveControlAvailable: true` to the existing proactive/consent seed (a `false` there would hide the consent control and break that test).

- [ ] **Step 3: Add the failing tests.**
  - Vitest `extension/test/logic/proactiveControlCommands.test.ts` — extend the `harness` `over` type with `noEngine?: boolean` and set `proactiveControl: over.noEngine ? undefined : control` in the `ctx`. **Rewrite** the existing test at `:73-80` (`'pushes nothing when there is no proactive engine …'`) — the clean build now sends a card:
    ```ts
    it('no proactive engine (clean build) → still sends an availability card, control-less', async () => {
        const h = harness({ noEngine: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'available', proactiveControlAvailable: false });
    });
    ```
    Then append:
    ```ts
    it('clean build: .noai → unavailable/noai, proactiveControlAvailable false', async () => {
        const h = harness({ noEngine: true, noAi: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'noai', proactiveControlAvailable: false });
    });
    it('clean build: Iris disabled → unavailable/iris-off', async () => {
        const h = harness({ noEngine: true, settings: { settings: { enabled: false, proactiveStruggleEnabled: true } } });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'iris-off', proactiveControlAvailable: false });
    });
    it('clean build: course-proactive-off is masked → available', async () => {
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
  - Vitest `extension/test/react/AskIris.cardState.test.tsx` — add:
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
    ])('chat-active $cardState/$reason keeps the passed description and renders no notice', ({ cardState, reason }) => {
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
  - Vitest `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` — import `within` from `@testing-library/react` if needed; seed a NEW `unavailable/noai` card with `proactiveControlAvailable: false` and assert:
    ```ts
    const card = screen.getByTestId('ask-iris-card');
    const notice = 'A .noai file disables Iris for this repository, including the chat.';
    expect(screen.getAllByText(notice)).toHaveLength(1);
    expect(within(card).getByText(notice)).toBeInTheDocument();
    expect(screen.queryByText(/Open the Iris chat/i)).toBeNull();
    expect(document.querySelector('[data-variant="warning"]')).toBeNull();
    ```

- [ ] **Step 4: Run the tests, verify they fail**

Run: `cd extension && npx vitest run test/logic/proactiveControlCommands.test.ts test/react/AskIris.cardState.test.tsx test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`
Expected: the clean-build `_push` cases FAIL (early return still sends nothing); the AskIris off-card / gating cases FAIL (rendering not implemented). The full-build `_push` true case already PASSES.

- [ ] **Step 5: Rewrite `_push`** in `proactiveControlCommands.ts` (replace the body from the early return through `sendMessage`):

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

- [ ] **Step 6: Comment sweep** (each now describes the removed early-return behaviour):
  - `proactiveCardState.ts:3-7` header — replace the "clean build never reaches this function" sentence with: the clean build DOES reach it now (its chat-availability card renders), but `_push` masks the proactive-only inputs, so only `noai`/`iris-off`/`available` can result; still no `enginePresent` input.
  - `proactiveCardState.ts:27` — the §14 case-3 note: change "→ Unavailable + banner" to "→ Unavailable (in-card notice)".
  - `extensionMessages.ts:27-31` — reword "the clean (no-engine) build never sends a card at all" to: the clean build sends a chat-availability card with `proactiveControlAvailable: false` (no level control).
  - `extensionMessages.ts:33` (the `cardReason` comment) — change "drives the §14 banner / note copy" to "…notice / note copy".
  - `telemetry/noop.ts:20-22` — reword "the 'hidden' case is 'no card sent'" to: the clean build sends a control-less availability card (the `proactiveControl` seam is omitted, so the AskIris level control stays hidden).

- [ ] **Step 7: Thread the store + view.** `ExerciseDetailView.tsx`: in the `UpdateProactiveControl` handler (`:138-143`) add `proactiveControlAvailable: msg.proactiveControlAvailable,`; in `proactiveVM` (`:255-264`) add `controlAvailable: proactiveControl.proactiveControlAvailable,`; delete the standalone banner block at `:661-668` (comment + the `{proactiveControl && … cardState === 'unavailable' && (<div className={styles.banner} …>…</div>)}`).

- [ ] **Step 8: Rewrite `AskIris.tsx`.** Add `import clsx from 'clsx';`. Replace the derivation block:

```tsx
  const state = proactiveControl?.cardState;
  const unavailable = state === 'unavailable';
  const askDisabled = unavailable;
  const consentMissing = state === 'degraded' && proactiveControl?.reason === 'consent-missing';
  const showSegments = state === 'available' || state === 'off-course' || consentMissing;
  const segmentsDisabled = state === 'off-course' || consentMissing;
  const showProactive = Boolean(proactiveControl?.controlAvailable) && !unavailable;
  const noticeText = unavailable
    ? (proactiveControl?.reason === 'noai'
        ? 'A .noai file disables Iris for this repository, including the chat.'
        : 'Iris is not available for this exercise.')
    : undefined;
  const shownDescription = unavailable ? 'The Iris chat is turned off here.' : description;
```

JSX — `Container` gets the testId; notice before `.main`; `.main` gains `mainMuted`; the Ask button gets the neutral class; the proactive block is gated on `showProactive && proactiveControl` (the explicit `&& proactiveControl` is REQUIRED — `Boolean(proactiveControl?.controlAvailable)` does not narrow `proactiveControl` non-null for the `.level`/`.onLevelChange`/`.onOpenConsentSettings` dereferences inside):

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
          {/* the existing proactive block, unchanged — only the guard changes from
              `proactiveControl && state !== 'unavailable'` to `showProactive && proactiveControl` */}
        </>
      )}
    </Container>
```

Also update the two stale comments: the `NOTE`/section comment near `:32` ("the full §14 banner for `unavailable` lives in the exercise view") and the proactive-block comment near `:69` ("Hidden on the full shut-off (unavailable), which the exercise view's §14 banner already explains") — both now: the notice lives in-card; the block is hidden when `unavailable` OR the engine is absent.

- [ ] **Step 9: Add the CSS** to `AskIris.module.css`:

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
.noticeIcon { flex: none; opacity: 0.8; }

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

- [ ] **Step 10: Run tests + types**

Run: `cd extension && npx vitest run test/logic/proactiveControlCommands.test.ts test/react/AskIris.cardState.test.tsx test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx test/react/AskIris.proactiveControl.test.tsx test/react/useExerciseDetailStore.proactiveControl.test.ts && npm run check-types`
Expected: all PASS; no type errors.

- [ ] **Step 11: Commit**

```bash
git add extension/src/shared/messageContracts/extensionMessages.ts extension/src/extension/controller/commands/proactiveControlCommands.ts extension/src/extension/services/proactiveCardState.ts extension/src/extension/telemetry/noop.ts extension/src/webview/stores/useExerciseDetailStore.ts extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx extension/src/webview/components/AskIris/AskIris.tsx extension/src/webview/components/AskIris/AskIris.module.css extension/test/logic/proactiveControlCommands.test.ts extension/test/react/AskIris.cardState.test.tsx extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx extension/test/react/AskIris.proactiveControl.test.tsx extension/test/react/useExerciseDetailStore.proactiveControl.test.ts
git commit -m "feat(struggle): honest AskIris off-card in every build (#334)"
```

---

### Task 2: Live `.noai` refresh — sidebar provider + fullscreen panel

Closes the latent #342 gap: `ExerciseDetailView` re-requests the card on `UpdateNoAiStatus`, but the only producer posts it to the chat webview, so neither exercise surface ever receives it. Mirror #342's consent live-refresh (both surfaces).

**Files:**
- Modify: `extension/src/extension/provider/artemisWebviewProviderDeps.ts` (dep)
- Modify: `extension/src/extension/provider/artemisWebviewProvider.ts` (import, field, pass-to-manager, subscription, comment `:444-445`)
- Modify: `extension/src/extension.ts:243` (wire the dep)
- Modify: `extension/src/extension/services/ui/fullscreenPanelManager.ts` (import, ctor param, `noAiSub`)
- Test: `extension/test/unit/provider/artemisWebviewProvider.test.ts`, `extension/test/unit/services/ui/fullscreenPanelManager.test.ts`

**Interfaces:** Consumes the shared `NoAiDetectionService` (`extension.ts:214`).

**Ordering note:** the dep/ctor arg is required, and strict `noUnusedLocals`/`noUnusedParameters` forbid an unread field. So: scaffold the types + migrate every constructor fixture first (green baseline), then red behavioural tests, then the subscriptions. In the fullscreen scaffold the param is unused until the last step, so introduce it as a `_`-prefixed plain param (ignored by `noUnusedParameters`) and promote it to `private readonly` when the subscription uses it.

- [ ] **Step 1: Add the dep to the interface** — `artemisWebviewProviderDeps.ts`: add `import type { NoAiDetectionService } from '@extension/services/workspace';` and `noAiDetectionService: NoAiDetectionService;`.

- [ ] **Step 2: Provider scaffolding** — `artemisWebviewProvider.ts`: add `import type { NoAiDetectionService } from '@extension/services/workspace';` (the provider file needs its OWN import); add field `private readonly _noAiDetectionService: NoAiDetectionService;`; assign `this._noAiDetectionService = deps.noAiDetectionService;` in the constructor BEFORE the `FullscreenPanelManager` construction (`:189`); pass it as the 4th arg: `new FullscreenPanelManager(this._extensionUri, this._extensionContext, () => this._messageHandler, this._noAiDetectionService)`. (The field is read here — passed to the manager — so it is not "unused".)

- [ ] **Step 3: Fullscreen scaffolding** — `fullscreenPanelManager.ts`: add `import type { NoAiDetectionService } from '@extension/services/workspace';` and a 4th ctor param as a `_`-prefixed PLAIN param (not `private readonly` yet, since it is unused until Step 10): `_noAiDetectionService: NoAiDetectionService`.

- [ ] **Step 4: Wire extension.ts** — add `noAiDetectionService,` to the `new ArtemisWebviewProvider({ … })` deps object at `extension.ts:243`.

- [ ] **Step 5: Migrate ALL constructor fixtures (non-capturing fakes, so nothing is unread at baseline)** —
  - `artemisWebviewProvider.test.ts`: add `noAiDetectionService: fakeNoAi` to every `new ArtemisWebviewProvider({ … })` (`:141`, `:207`, `:385`), with a simple non-capturing fake: `const fakeNoAi = { onNoAiStatusChanged: () => ({ dispose() {} }), dispose() {} } as any;`.
  - `fullscreenPanelManager.test.ts`: add a 4th arg — the same simple fake — to both existing `new FullscreenPanelManager(...)` constructions (`:35` and `:109`).

- [ ] **Step 6: Compile + green baseline** — `cd extension && npm run compile-tests && npm run test:unit` (read `extension/reports/mocha-results.xml`) and `npm run check-types`. Expected: compiles, existing tests pass (no behaviour added, no unused symbols).

- [ ] **Step 7: Add the failing behavioural tests** (introduce the controllable fakes HERE, where they are read):
  - Provider (`artemisWebviewProvider.test.ts`, in the suite whose setup resolves the view — mirror the `updateProactiveConsent` test at `:332`): replace that suite's `fakeNoAi` with a capturing one — suite-scoped `let noAiCb: (v: boolean) => void = () => {};` and `onNoAiStatusChanged: (cb) => { noAiCb = cb; return { dispose() {} }; }`. Then:
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
  - Fullscreen (`fullscreenPanelManager.test.ts`, NEW suite with its OWN `exerciseData` fixture — the consent suite's is local to `:132`). Its fake captures the callback and returns a `dispose` spy (so a missing `noAiSub.dispose()` is caught rather than masked by the panel's `disposed` guard at `:181`):
    ```ts
    suite('FullscreenPanelManager.openExerciseFullscreen - #334 .noai flip', () => {
        const exerciseData = { exercise: { id: 1, title: 'X', studentParticipations: [] } };
        let noAiCb: (v: boolean) => void = () => {};
        const disposeSpy = sinon.spy();
        // makeManager()'s 4th arg here: { onNoAiStatusChanged: (cb) => { noAiCb = cb; return { dispose: disposeSpy }; } }
        const awaitNoAiMsg = async (deadlineMs: number): Promise<boolean> => {
            const start = Date.now();
            while (Date.now() - start < deadlineMs) {
                if (postMessage.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'updateNoAiStatus')) { return true; }
                await new Promise(r => setTimeout(r, 20));
            }
            return false;
        };
        test('a .noai flip posts updateNoAiStatus (both directions), and the subscription is disposed once with the panel', async () => {
            makeManager().openExerciseFullscreen(exerciseData as never);
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

- [ ] **Step 8: Run, verify failure** — `cd extension && npm run compile-tests && npm run test:unit`; read `extension/reports/mocha-results.xml`. Expected: the new provider + fullscreen tests FAIL (nothing subscribes yet; `disposeSpy` never called).

- [ ] **Step 9: Implement the sidebar subscription** — in `resolveWebviewView`, right after `this._viewDisposables.push(configListener);` (`:450`):

```ts
        // #334: a .noai create/delete must live-refresh the exercise card (the view re-requests on this message).
        const noAiListener = this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
            this._postMessageSafe({ type: ExtensionMsg.UpdateNoAiStatus, isNoAiDetected });
        });
        this._viewDisposables.push(noAiListener);
```

Also fix the now-wrong consent comment at `artemisWebviewProvider.ts:444-445` (the clean build no longer early-returns; the re-request now yields a card).

- [ ] **Step 10: Implement the fullscreen subscription** — in `fullscreenPanelManager.ts`, promote the ctor param to `private readonly _noAiDetectionService: NoAiDetectionService`. In `openExerciseFullscreen`, add `let noAiSub: vscode.Disposable | undefined;` beside `consentSub`; inside `onReady`, after the `consentSub` guard:

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
