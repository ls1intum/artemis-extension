# Consent-Forced-Off Proactive Level (#342) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the code-reading consent (`artemis.iris.proactiveCodeEgress` != `enabled`) is missing, the exercise view's proactive-help control shows a forced Off (segments visible but disabled, hint + "Enable in Settings" link) without ever overwriting the stored preference, and repaints live when the consent flips.

**Architecture:** The `isProactiveDegraded(): boolean` seam is replaced by `getProactiveGateState(): { consentMissing, serverUnavailable }` so the card derivation can split the two degraded causes into distinct reasons (`consent-missing` vs `limited`). The host masks the displayed level to `off` while consent is missing (orthogonal to reason precedence; store untouched). Live refresh mirrors the `.noai` pattern: a provider-side config listener posts a new payload-less `ExtensionMsg.UpdateProactiveConsent`, the exercise view re-requests its control.

**Tech Stack:** TypeScript, VS Code extension host + React webview, vitest (`test/logic`, `test/react`), mocha via vscode-test (`test/unit`), esbuild dual bundle (desktop + clean Open VSX).

**Spec:** `docs/superpowers/specs/2026-07-18-consent-forced-off-level-design.md` (codex-approved with amendments; the amendments are already folded in).

## Global Constraints

- The clean (Open VSX) bundle must not pull in `services/struggleIntervention`: the command module receives both gate flags exclusively through the `proactiveControl` seam; never import from `services/struggleIntervention/` in `controller/` or `provider/` code.
- The stored preference (`ProactivePreferenceService`) is NEVER written by the consent gate; masking is display-side only.
- Reason precedence: `unavailable` > `off-course` > `limited` > `consent-missing`. The effective-level mask (`consentMissing` → `off`) is orthogonal and always applies.
- The 404-latch gets NO live repaint (pre-existing staleness, out of scope).
- Setting id string everywhere: `artemis.iris.proactiveCodeEgress` (host-side via `VSCODE_CONFIG.IRIS.SECTION` + `VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY`).
- Commit messages: conventional style (`feat(struggle): ...`), NO AI/Claude attribution, no `Co-Authored-By` trailers, no robot emoji.
- Stage only the files the task touched (never `git add -A`).
- All commands run from `extension/` (the package.json lives there, not in the repo root).
- `test/unit` (mocha) runs stale `out/`: always `npm run compile-tests` before `npm run test:unit`.

---

### Task 1: Seam replacement — `getProactiveGateState`

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts:1796-1802` (replace `isProactiveDegraded`)
- Modify: `extension/src/extension/telemetry/contract.ts:225-231` (replace the optional member)
- Modify: `extension/src/extension/telemetry/index.ts:373` (re-wire)
- Modify: `extension/src/extension/telemetry/noop.ts:20` (comment mentions the old name)
- Modify: `extension/src/extension.ts:98,190-192` (destructure + capability assembly)
- Modify: `extension/src/extension/controller/commands/types.ts:54-58` (capability shape)
- Modify: `extension/src/extension/controller/commands/proactiveControlCommands.ts:70` (call site, behavior unchanged in this task)
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (~line 245), `extension/test/logic/proactiveControlCommands.test.ts` (harness)

**Interfaces:**
- Consumes: `StruggleInterventionService._deps.isEgressEnabled(): boolean`, `_serverAvailable: boolean` (both exist).
- Produces: `getProactiveGateState(): { consentMissing: boolean; serverUnavailable: boolean }` on the service, the telemetry seam (optional member), the `CommandContext.proactiveControl` capability, and the test-harness option names `consentMissing` / `serverUnavailable`. Tasks 2 and 4 rely on these exact names.

- [ ] **Step 1: Write the failing tests**

In `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`, replace the three `isProactiveDegraded:` tests and update the latch-survival test (all around line 245):

```ts
    it('getProactiveGateState: consentMissing when egress consent is off', () => {
        const svc = new StruggleInterventionService(fakeDeps({ isEgressEnabled: () => false }));
        expect(svc.getProactiveGateState()).toEqual({ consentMissing: true, serverUnavailable: false });
    });

    it('getProactiveGateState: all clear when consent on and server up', () => {
        const svc = new StruggleInterventionService(fakeDeps({ isEgressEnabled: () => true }));
        expect(svc.getProactiveGateState()).toEqual({ consentMissing: false, serverUnavailable: false });
    });

    it('getProactiveGateState: serverUnavailable after a 404 latches the server', async () => {
        const svc = new StruggleInterventionService(fakeDeps({
            isEgressEnabled: () => true,
            postIntervention: vi.fn(async () => 'unavailable' as const),
        }));
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(svc.getProactiveGateState()).toEqual({ consentMissing: false, serverUnavailable: true });
    });

    it('getProactiveGateState: consent off AND 404 latch → both flags set independently', async () => {
        // No POST leaves without consent, so latch first (consent on), THEN revoke via the mutable dep.
        let consentOn = true;
        const svc = new StruggleInterventionService(fakeDeps({
            isEgressEnabled: () => consentOn,
            postIntervention: vi.fn(async () => 'unavailable' as const),
        }));
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        consentOn = false;
        expect(svc.getProactiveGateState()).toEqual({ consentMissing: true, serverUnavailable: true });
        // resetSession (new exercise) clears ONLY the server latch; the consent flag is independent of it.
        svc.resetSession();
        expect(svc.getProactiveGateState()).toEqual({ consentMissing: true, serverUnavailable: false });
    });
```

In the existing test `a 404 server-unavailable latch survives reset() ...` replace every `svc.isProactiveDegraded()` assertion:

```ts
        expect(svc.getProactiveGateState().serverUnavailable).toBe(true);
        svc.reset();
        expect(svc.getProactiveGateState().serverUnavailable).toBe(true);   // settings-toggle clear KEEPS the per-session 404 latch
        svc.resetSession();
        expect(svc.getProactiveGateState()).toEqual({ consentMissing: false, serverUnavailable: false });  // a new exercise re-probes
```

In `extension/test/logic/proactiveControlCommands.test.ts`, update the harness (lines 7-32): replace the `degraded?: boolean` option with `consentMissing?: boolean; serverUnavailable?: boolean` and the control stub with:

```ts
    const control = {
        setStudentProactive: vi.fn(),
        getProactiveGateState: vi.fn(() => ({
            consentMissing: over.consentMissing ?? false,
            serverUnavailable: over.serverUnavailable ?? false,
        })),
    };
```

Update the `degraded seam → degraded` test (line 103) to use the new option:

```ts
    it('404-latched server → degraded/limited', async () => {
        const h = harness({ serverUnavailable: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'degraded', cardReason: 'limited' });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts test/logic/proactiveControlCommands.test.ts`
Expected: FAIL with `svc.getProactiveGateState is not a function` (and type errors on the harness).

- [ ] **Step 3: Implement the seam**

`struggleInterventionService.ts` — replace lines 1796-1802 (`isProactiveDegraded` incl. its doc comment) with:

```ts
    /**
     * The two §14 gate causes, independently (spec §14 cases 4-5): `consentMissing` = no proactive-egress
     * consent (student-fixable, drives the consent-missing card + the forced-Off level, #342);
     * `serverUnavailable` = 404-latched server (drives the limited card). Session-global, no exercise id.
     */
    getProactiveGateState(): { consentMissing: boolean; serverUnavailable: boolean } {
        return { consentMissing: !this._deps.isEgressEnabled(), serverUnavailable: !this._serverAvailable };
    }
```

`telemetry/contract.ts` — replace the `isProactiveDegraded?(): boolean;` member and its doc comment (lines 225-231) with:

```ts
    /**
     * The two §14 gate causes, independently (spec §14 cases 4-5): `consentMissing` = no proactive-egress
     * consent (student-fixable → consent-missing card + forced-Off level, #342), `serverUnavailable` =
     * 404-latched server (→ limited card). Session-global, no exercise id. ABSENT in the clean build
     * (like the members above), so extension.ts assembles no `proactiveControl` capability there.
     */
    getProactiveGateState?(): { consentMissing: boolean; serverUnavailable: boolean };
```

`telemetry/index.ts` line 373: replace with

```ts
        getProactiveGateState: () => orchestrator.getProactiveGateState(),
```

`telemetry/noop.ts` line 20: change the comment `// setStudentProactive / isProactiveDegraded are intentionally OMITTED:` to `// setStudentProactive / getProactiveGateState are intentionally OMITTED:` (keep the rest of that comment block).

`extension.ts` line 98: in the destructuring, replace `isProactiveDegraded` with `getProactiveGateState`. Lines 190-192:

```ts
	const proactiveControl = setStudentProactive && getProactiveGateState
		? { setStudentProactive, getProactiveGateState }
		: undefined;
```

`controller/commands/types.ts` lines 54-58:

```ts
    proactiveControl?: {
        setStudentProactive(exerciseId: number, on: boolean): void;
        /** The two §14 gate causes, independently (consent vs 404 latch). Session-global → no exercise id. */
        getProactiveGateState(): { consentMissing: boolean; serverUnavailable: boolean };
    };
```

`proactiveControlCommands.ts` line 70: replace

```ts
        const degraded = this.context.proactiveControl.isProactiveDegraded() ?? false;
```

with (behavior identical in this task; the split into two card reasons is Task 2):

```ts
        const gate = this.context.proactiveControl.getProactiveGateState();
        const degraded = gate.consentMissing || gate.serverUnavailable;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts test/logic/proactiveControlCommands.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Type-check and lint**

Run: `cd extension && npm run check-types && npm run lint`
Expected: clean. (`check-types` matters: eslint misses TS6133 unused-symbol errors.)

- [ ] **Step 6: Commit**

```bash
cd extension
git add src/extension/services/struggleIntervention/struggleInterventionService.ts src/extension/telemetry/contract.ts src/extension/telemetry/index.ts src/extension/telemetry/noop.ts src/extension.ts src/extension/controller/commands/types.ts src/extension/controller/commands/proactiveControlCommands.ts test/logic/struggleIntervention/struggleInterventionService.test.ts test/logic/proactiveControlCommands.test.ts
git commit -m "refactor(struggle): split the degraded seam into getProactiveGateState (#342)"
```

---

### Task 2: Card-reason split + effective-level mask + setLevel guard

**Files:**
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts:34` (`ProactiveCardReason`)
- Modify: `extension/src/extension/services/proactiveCardState.ts` (signals + derivation)
- Modify: `extension/src/extension/controller/commands/proactiveControlCommands.ts` (`_push` level mask + signal pass-through, `handleSetLevel` guard)
- Test: `extension/test/logic/proactiveCardState.test.ts`, `extension/test/logic/proactiveControlCommands.test.ts`

**Interfaces:**
- Consumes: `getProactiveGateState()` from Task 1 (exact shape `{ consentMissing, serverUnavailable }`); harness options `consentMissing`/`serverUnavailable`.
- Produces: `ProactiveCardReason` value `'consent-missing'` and `ProactiveCardSignals` fields `consentMissing`/`serverUnavailable` (Task 3's webview rendering keys off `reason === 'consent-missing'`).

- [ ] **Step 1: Write the failing tests**

`extension/test/logic/proactiveCardState.test.ts` — update the `base` fixture and the degraded tests:

```ts
const base: ProactiveCardSignals = {
    irisAvailability: 'enabled',
    noAi: false,
    courseProactiveEnabled: true,
    consentMissing: false,
    serverUnavailable: false,
};
```

Replace the `no consent / 404 → degraded` test with, and extend the noai-precedence test:

```ts
    it('missing consent → degraded/consent-missing (#342, student-fixable)', () => {
        expect(deriveProactiveCardState({ ...base, consentMissing: true }))
            .toEqual({ state: 'degraded', reason: 'consent-missing' });
    });

    it('404-latched server → degraded/limited (§14 case 5)', () => {
        expect(deriveProactiveCardState({ ...base, serverUnavailable: true }))
            .toEqual({ state: 'degraded', reason: 'limited' });
    });

    it('precedence: 404 beats missing consent (a consent hint must not promise an absent feature)', () => {
        expect(deriveProactiveCardState({ ...base, consentMissing: true, serverUnavailable: true }))
            .toEqual({ state: 'degraded', reason: 'limited' });
    });

    it('precedence: course-off beats missing consent (reason only; the level mask is orthogonal)', () => {
        expect(deriveProactiveCardState({ ...base, courseProactiveEnabled: false, consentMissing: true }))
            .toEqual({ state: 'off-course', reason: 'course-off' });
    });
```

In the existing `noai beats course-off and degraded too` test, replace `degraded: true` with `consentMissing: true, serverUnavailable: true`.

`extension/test/logic/proactiveControlCommands.test.ts` — add:

```ts
    it('missing consent → forced Off + consent-missing reason (stored preference untouched)', async () => {
        const h = harness({ level: 'more', consentMissing: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardState: 'degraded', cardReason: 'consent-missing' });
        expect(h.pref.setLevel).not.toHaveBeenCalled();
    });

    it('missing consent + 404 latch → limited reason wins, mask still forces Off (orthogonality end-to-end)', async () => {
        const h = harness({ level: 'more', consentMissing: true, serverUnavailable: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardState: 'degraded', cardReason: 'limited' });
    });

    it('course-off + missing consent → course reason wins, mask still forces Off', async () => {
        const h = harness({ level: 'more', consentMissing: true, settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardState: 'off-course', cardReason: 'course-off' });
    });

    it('setLevel while consent missing: dropped (no store write, no engine call, no collapse) but re-pushed', async () => {
        const h = harness({ level: 'more', consentMissing: true });
        await h.mod.getHandlers()[WebviewCmd.SetProactiveLevel](cmd('setProactiveLevel', { exerciseId: 42, level: 'off', courseId: 7 }));
        expect(h.pref.setLevel).not.toHaveBeenCalled();
        expect(h.control.setStudentProactive).not.toHaveBeenCalled();
        expect(h.collapse).not.toHaveBeenCalled();
        expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardReason: 'consent-missing' });
    });

    it('grant restores the remembered level (store was never overwritten)', async () => {
        const h = harness({ level: 'more', consentMissing: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off' });
        h.control.getProactiveGateState.mockReturnValue({ consentMissing: false, serverUnavailable: false });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'more', cardState: 'available' });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extension && npx vitest run test/logic/proactiveCardState.test.ts test/logic/proactiveControlCommands.test.ts`
Expected: FAIL (type error on the new signal fields; `consent-missing` not produced; forced-Off assertions fail).

- [ ] **Step 3: Implement**

`extensionMessages.ts` line 34:

```ts
export type ProactiveCardReason = 'noai' | 'iris-off' | 'course-off' | 'limited' | 'consent-missing';
```

`proactiveCardState.ts` — replace the `degraded` field of `ProactiveCardSignals` (lines 16-20) with:

```ts
    /** No proactive-egress consent (§14 case 4, #342): student-fixable → its own card reason with a settings link. */
    consentMissing: boolean;
    /** 404-latched server (§14 case 5): not student-fixable → the limited card. */
    serverUnavailable: boolean;
```

and replace the `if (s.degraded)` branch (lines 40-43) with:

```ts
    // §14 case 5: 404-latched server → proactive is off and nothing the student does changes that. Checked
    // BEFORE the consent case: a consent hint must not promise a feature the server does not have.
    if (s.serverUnavailable) {
        return { state: 'degraded', reason: 'limited' };
    }
    // §14 case 4 / #342: missing code-reading consent → forced-Off control with an enable path.
    if (s.consentMissing) {
        return { state: 'degraded', reason: 'consent-missing' };
    }
```

`proactiveControlCommands.ts`:

In `_push`, replace the Task-1 `gate`/`degraded` lines and the `level` line (currently `const level = this.context.proactivePreference?.getLevel(exerciseId) ?? 'more';`) with:

```ts
        const gate = this.context.proactiveControl.getProactiveGateState();
        const stored = this.context.proactivePreference?.getLevel(exerciseId) ?? 'more';
        // #342 effective-level mask: missing consent always forces the DISPLAYED level to Off, orthogonal to
        // which card reason wins precedence below. The stored preference is never written by this gate.
        const level = gate.consentMissing ? 'off' : stored;
```

and pass the split signals to the derivation (replace `degraded,` in the `deriveProactiveCardState` call):

```ts
        const { state: cardState, reason: cardReason } = deriveProactiveCardState({
            irisAvailability,
            noAi,
            courseProactiveEnabled,
            consentMissing: gate.consentMissing,
            serverUnavailable: gate.serverUnavailable,
        });
```

In `handleSetLevel`, insert the guard directly after the `getPayload` line:

```ts
        // #342: while the code-reading consent is missing the control is a forced Off — a level change must
        // neither touch the stored preference nor the engine; re-push so the webview repaints the forced state.
        if (this.context.proactiveControl?.getProactiveGateState().consentMissing) {
            await this._push(exerciseId, courseId);
            return;
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extension && npx vitest run test/logic/proactiveCardState.test.ts test/logic/proactiveControlCommands.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check and lint**

Run: `cd extension && npm run check-types && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd extension
git add src/shared/messageContracts/extensionMessages.ts src/extension/services/proactiveCardState.ts src/extension/controller/commands/proactiveControlCommands.ts test/logic/proactiveCardState.test.ts test/logic/proactiveControlCommands.test.ts
git commit -m "feat(struggle): force the proactive level to Off while the code-reading consent is missing (#342)"
```

---

### Task 3: Webview — consent-missing rendering + settings link

**Files:**
- Modify: `extension/src/webview/components/AskIris/AskIris.tsx`
- Modify: `extension/src/webview/components/AskIris/AskIris.module.css` (one new class)
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx:247-253` (VM)
- Test: `extension/test/react/AskIris.cardState.test.tsx`, `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`

**Interfaces:**
- Consumes: `reason === 'consent-missing'` on `cardState === 'degraded'` and the host-sent `level: 'off'` (Task 2).
- Produces: `ProactiveControlVM.onOpenConsentSettings?: () => void`; the view posts `openSettings` with `{ setting: 'artemis.iris.proactiveCodeEgress' }`.

- [ ] **Step 1: Write the failing tests**

`extension/test/react/AskIris.cardState.test.tsx` — add (import `fireEvent` from `@testing-library/react`):

```tsx
    it('degraded/consent-missing → disabled segments with Off active, hint + settings link, Ask enabled (#342)', () => {
        const onOpen = vi.fn();
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'consent-missing', level: 'off', onOpenConsentSettings: onOpen })} />);
        screen.getAllByRole('radio').forEach(seg => expect(seg).toBeDisabled());
        expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText(/needs your consent/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /enable in settings/i }));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: /ask/i })).not.toBeDisabled();
    });

    it('degraded/limited stays segment-free (only the consent case gets the forced-Off control)', () => {
        render(<AskIris {...base} proactiveControl={control({ cardState: 'degraded', reason: 'limited' })} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.getByText('Proactive help is unavailable right now.')).toBeInTheDocument();
    });
```

`extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` — add, following the file's existing helpers (`makeExerciseData`, `createMockVsCodeApi`, the render used by the `UpdateNoAiStatus` test at ~line 130; set the store's `proactiveControl` for exercise 42):

```tsx
	it('consent-missing settings link posts openSettings with the egress key (#342)', () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseData(),
			isLoading: false,
			proactiveControl: { exerciseId: 42, level: 'off', cardState: 'degraded', reason: 'consent-missing' },
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		fireEvent.click(screen.getByRole('button', { name: /enable in settings/i }));
		expect(vi.mocked(mockApi.postMessage)).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openSettings',
				payload: { setting: 'artemis.iris.proactiveCodeEgress' },
			})
		);
	});
```

(Adapt the render call to the file's local pattern if it differs; the assertion shape mirrors the existing `requestProactiveControl` assertion.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extension && npx vitest run test/react/AskIris.cardState.test.tsx test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`
Expected: FAIL (no radiogroup rendered for consent-missing; no settings-link button found).

- [ ] **Step 3: Implement**

`AskIris.tsx`:

Extend the VM interface:

```ts
interface ProactiveControlVM {
  level: ProactiveLevel;
  /** Which availability state to render (Available / Off-course / Unavailable / Degraded). */
  cardState: ProactiveCardState;
  /** Why a non-"available" card is in that state (host-derived). */
  reason?: ProactiveCardReason;
  onLevelChange: (level: ProactiveLevel) => void;
  /** #342: opens the settings UI at the code-reading consent; only used for reason `consent-missing`. */
  onOpenConsentSettings?: () => void;
}
```

Replace the `showSegments`/`segmentsDisabled` block (lines 40-43):

```ts
  // #342: missing code-reading consent renders as a forced Off — segments visible but disabled, with an
  // enable path below. The other degraded cause (404-latched server) keeps its segment-free note.
  const consentMissing = state === 'degraded' && proactiveControl?.reason === 'consent-missing';
  // The segments show where proactive can run (available) or where the OFF state itself is the message
  // (off-course, consent-missing); read-only in the latter two.
  const showSegments = state === 'available' || state === 'off-course' || consentMissing;
  const segmentsDisabled = state === 'off-course' || consentMissing;
```

Replace the note line (line 97, `{state && NOTE[state] && ...}`):

```tsx
            {consentMissing ? (
              <span className={styles.cardNote}>
                Proactive help needs your consent to let Iris read your code.{' '}
                <button type="button" className={styles.consentLink} onClick={() => proactiveControl.onOpenConsentSettings?.()}>
                  Enable in Settings
                </button>
              </span>
            ) : (state && NOTE[state] && <span className={styles.cardNote}>{NOTE[state]}</span>)}
```

`AskIris.module.css` — add (match the file's existing custom-property style; static camelCase lookup is mandatory, CSS modules are camelCaseOnly in the production build):

```css
.consentLink {
  background: none;
  border: none;
  padding: 0;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  text-decoration: underline;
  font-size: inherit;
}
```

`ExerciseDetailView.tsx` — extend the VM (lines 247-253):

```ts
    const proactiveVM = proactiveControl && proactiveControl.exerciseId === exercise.id ? {
        level: proactiveControl.level,
        cardState: proactiveControl.cardState,
        reason: proactiveControl.reason,
        onLevelChange: (level: ProactiveLevel) =>
            postCommand(vscodeApi, 'setProactiveLevel', { exerciseId: exercise.id!, level, courseId: exercise.course?.id }),
        // #342: the consent-missing hint's enable path; AskIris stays presentational.
        onOpenConsentSettings: () =>
            postCommand(vscodeApi, 'openSettings', { setting: 'artemis.iris.proactiveCodeEgress' }),
    } : undefined;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extension && npx vitest run test/react/AskIris.cardState.test.tsx test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx test/react/AskIris.proactiveControl.test.tsx test/react/components/AskIris/AskIris.test.tsx`
Expected: PASS (including the untouched AskIris suites).

- [ ] **Step 5: Type-check and lint**

Run: `cd extension && npm run check-types && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd extension
git add src/webview/components/AskIris/AskIris.tsx src/webview/components/AskIris/AskIris.module.css src/webview/views/ExerciseDetail/ExerciseDetailView.tsx test/react/AskIris.cardState.test.tsx test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx
git commit -m "feat(struggle): consent-missing card with a forced-Off control and a settings link (#342)"
```

---

### Task 4: Live refresh on a consent flip

**Files:**
- Modify: `extension/src/shared/messageContracts/extensionMessages.ts:265,467` (new `ExtensionMsg` + payload-map member)
- Modify: `extension/src/extension/provider/artemisWebviewProvider.ts:438-444` (config listener)
- Modify: `extension/src/webview/views/ExerciseDetail/ExerciseDetailView.tsx:145-153` (message handler)
- Test: `extension/test/unit/provider/artemisWebviewProvider.test.ts` (mocha), `extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`

**Interfaces:**
- Consumes: `_postMessageSafe(message: ExtensionToWebviewMessage)` (protected on the provider's own class hierarchy, `baseWebviewProvider.ts:103`); `VSCODE_CONFIG.IRIS.SECTION` (`'artemis.iris'`) + `VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY` (`'proactiveCodeEgress'`), already imported in the provider; `ExtensionMsg`, already imported in the provider.
- Produces: `ExtensionMsg.UpdateProactiveConsent = 'updateProactiveConsent'` (payload-less).

- [ ] **Step 1: Write the failing tests**

`extension/test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx` — add next to the `UpdateNoAiStatus` re-request test (~line 130), using the same `dispatchExtensionMessage` helper:

```tsx
	it('UpdateProactiveConsent re-requests the proactive control with the live exercise (#342)', () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		const post = vi.mocked(mockApi.postMessage);
		post.mockClear();
		act(() => {
			dispatchExtensionMessage({ type: ExtensionMsg.UpdateProactiveConsent });
		});
		expect(post).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'requestProactiveControl',
				payload: { exerciseId: 42, courseId: 1 },
			})
		);
	});
```

`extension/test/unit/provider/artemisWebviewProvider.test.ts` — add a mocha test INSIDE the existing suite whose setup already resolves the provider AND signals webview readiness (the suite containing the test at ~line 224). Do NOT call `resolveWebviewView` again inside the test: a second resolve resets `_webviewReady`, `_postMessageSafe` then queues instead of posting, and the poll would time out even with correct production code. The capture array is `spyWebview.sentMessages` (defined ~line 60). The test flips the REAL setting in the vscode-test host, deterministically in BOTH directions (spec acceptance criterion 4; the declared default is `ask`, so a single inversion would only ever test the grant direction):

```ts
    test('a proactiveCodeEgress change posts updateProactiveConsent to the webview (both directions)', async () => {
        const cfg = () => vscode.workspace.getConfiguration('artemis.iris');
        const prev = cfg().get('proactiveCodeEgress');
        const awaitConsentMsg = async () => {
            // Poll: the config event is async in the extension host.
            const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
                if (spyWebview.sentMessages.some(m => m.type === 'updateProactiveConsent')) { return true; }
                await new Promise(r => setTimeout(r, 50));
            }
            return false;
        };
        try {
            // Normalize first (no assertion): a leaked 'enabled' from another test would make the
            // grant-flip below a config no-op that fires no event.
            await cfg().update('proactiveCodeEgress', 'ask', vscode.ConfigurationTarget.Global);

            spyWebview.sentMessages.length = 0;
            await cfg().update('proactiveCodeEgress', 'enabled', vscode.ConfigurationTarget.Global);
            assert.ok(await awaitConsentMsg(), 'expected updateProactiveConsent after granting the consent');

            spyWebview.sentMessages.length = 0;
            await cfg().update('proactiveCodeEgress', 'disabled', vscode.ConfigurationTarget.Global);
            assert.ok(await awaitConsentMsg(), 'expected updateProactiveConsent after revoking the consent');
        } finally {
            await cfg().update('proactiveCodeEgress', prev, vscode.ConfigurationTarget.Global);
        }
    });
```

(Use the suite's actual spy-webview variable name if it differs; the load-bearing points are: no second resolve, clear `sentMessages` before each flip, assert one message per direction.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extension && npx vitest run test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`
Expected: FAIL (`ExtensionMsg.UpdateProactiveConsent` does not exist).
Run: `cd extension && npm run compile-tests && npm run test:unit`
Expected: the new provider test FAILS on the poll timeout (mocha tests old code without compile-tests, hence the compile first).

- [ ] **Step 3: Implement**

`extensionMessages.ts` — after line 265 (`UpdateProactiveControl: 'updateProactiveControl',`):

```ts
    UpdateProactiveConsent: 'updateProactiveConsent',
```

and in the payload map, after the `updateProactiveControl` member (line ~467):

```ts
    /** Posted when the proactive code-egress consent setting changes; the exercise view re-requests its control (#342). */
    updateProactiveConsent: undefined;
```

`artemisWebviewProvider.ts` — extend the config listener (lines 438-444) to:

```ts
        // Listen for configuration changes to re-render when settings change
        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.refreshTheme();
            }
            // #342: a consent flip must repaint the AskIris proactive card live (grant restores the remembered
            // level, revoke parks it at Off). Harmless in the clean build: the webview's re-request hits the
            // command module's early return (no proactive capability) and no card is sent.
            if (event.affectsConfiguration(`${VSCODE_CONFIG.IRIS.SECTION}.${VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY}`)) {
                this._postMessageSafe({ type: ExtensionMsg.UpdateProactiveConsent });
            }
        });
        this._viewDisposables.push(configListener);
```

`ExerciseDetailView.tsx` — after the `UpdateNoAiStatus` block (line 153):

```ts
        // Consent flip (#342): repaint the proactive card so a grant restores the remembered level and a
        // revoke parks the control at Off. Same live-store read as the .noai path above.
        if (msg.type === ExtensionMsg.UpdateProactiveConsent) {
            const current = useExerciseDetailStore.getState().exerciseData?.exercise;
            if (current?.id !== undefined) {
                postCommand(vscodeApi, 'requestProactiveControl', { exerciseId: current.id, courseId: current.course?.id });
            }
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extension && npx vitest run test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx`
Expected: PASS.
Run: `cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/342-task4-unit.txt | tail -20`
Expected: PASS (read `/tmp/342-task4-unit.txt` on failure instead of re-running; delete it afterwards).

- [ ] **Step 5: Type-check and lint**

Run: `cd extension && npm run check-types && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd extension
git add src/shared/messageContracts/extensionMessages.ts src/extension/provider/artemisWebviewProvider.ts src/webview/views/ExerciseDetail/ExerciseDetailView.tsx test/unit/provider/artemisWebviewProvider.test.ts test/react/views/ExerciseDetail/ExerciseDetailView.test.tsx
git commit -m "feat(struggle): repaint the proactive card live on a consent flip (#342)"
```

---

### Task 5: Full verification gates

**Files:** none modified (verification only; fix regressions if any gate fails, then re-run).

- [ ] **Step 1: Full vitest**

Run: `cd extension && npm run test:react 2>&1 | tee /tmp/342-vitest.txt | tail -15`
Expected: all files pass (~1650+ tests). On failure read `/tmp/342-vitest.txt`.

- [ ] **Step 2: Full mocha**

Run: `cd extension && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/342-mocha.txt | tail -15`
Expected: all passing (~1250 tests). On failure read `/tmp/342-mocha.txt`. Known machine-load flakes exist in unrelated timing tests; a failed test must be re-run in isolation before being called a flake.

- [ ] **Step 3: Types + lint**

Run: `cd extension && npm run check-types && npm run lint`
Expected: clean.

- [ ] **Step 4: Clean-bundle gate**

Run: `cd extension && npm run package:openvsx 2>&1 | tee /tmp/342-openvsx.txt | tail -15`
Expected: the build + its built-in clean-bundle verifier succeed (the verifier forbids `services/struggleIntervention` inputs in the clean bundle; the seam keeps them out).

- [ ] **Step 5: Clean up temp files**

Run: `rm -f /tmp/342-vitest.txt /tmp/342-mocha.txt /tmp/342-openvsx.txt /tmp/342-task4-unit.txt`

- [ ] **Step 6: No commit** (nothing changed; if fixes were needed, commit them with `fix(struggle): ...` and re-run all gates).
