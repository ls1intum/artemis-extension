# Consent-Gated Struggle Engine Start (Issue #349) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The struggle-detection engine observes nothing until the proactive-egress consent is explicitly `enabled`; mid-session grant starts it fresh, mid-session revoke aborts it immediately and clears all surfaces, and no POST or inbound surface can happen after a revoke.

**Architecture:** A new required `detectionConsent` dependency gates the engine inside `StruggleCoordinator` (bookkeeping always, engine only with consent, new `_engineRunning` state). Below it: a public no-drain `StruggleEngine.abort()`, a new `AlertSink.onConsentRevoked()` hook forwarded through both sink decorators into the orchestrator, and TOCTOU re-validation in the orchestrator's egress pipeline. Wiring builds the consent gate from the existing `ProactiveEgressConsent` plus a config listener.

**Tech Stack:** TypeScript VS Code extension. Tests: vitest (`test/logic/**`, run `npx vitest run <path>`) and mocha/vscode-test (`test/unit/**`, run `npm run compile-tests && npm run test:unit`). All commands run from `extension/`.

**Spec:** `docs/superpowers/specs/2026-07-17-consent-gated-engine-start-design.md` (approved). Branch: `feat/struggle-v3-integration`.

## Global Constraints

- "Granted" means exactly `proactiveCodeEgress === 'enabled'`; `ask` and `disabled` both mean the engine must not run.
- `detectionConsent` is a REQUIRED member of `StruggleCoordinatorDeps` (fail-closed; never optional, no default).
- Mid-session grant starts the engine with `sessionStartMs = clock.now()` at grant time (fresh D1 warmup).
- Mid-session revoke: set `_engineRunning = false` FIRST, then `engine.abort()` (never `stop()` - no final drain), then sink `onConsentRevoked` (fallback `reset`), then fire `onDidEndSession`.
- Consent flips must NEVER touch the delivery-throttle budget (`resetSession` is exercise-scoped only) and must NEVER lift the per-session latches (404/course-off).
- `onDidStartSession`/`onDidEndSession` fire only on real engine transitions; a session whose engine never ran ends without an end event.
- Exercise bookkeeping (`activeExerciseId`, `activeExerciseRoot`, throttle session reset, build baselines) happens on every exercise open regardless of consent.
- No POST after revocation: re-validate `isEgressEnabled()` AND the in-flight `requestToken` after the awaits, before `postIntervention`; inbound `onServerAmbient`/`onServerActive` drop when `!isEgressEnabled()`; `onServerSilent`/`onServerClose` stay ungated.
- The consent-prompt copy is exactly: "Allow Iris to detect when you might be stuck and proactively offer help? This enables local typing/pause analysis during programming exercises; your code is only sent to Iris when the detector triggers."
- Vitest tests go under `test/logic/**`; mocha tests under `test/unit/**`. After ANY `.ts` edit, mocha needs `npm run compile-tests` first or it silently tests stale `out/`.
- Never use `git add -A`/`git add .`; stage the exact files listed in each commit step.

---

### Task 1: `StruggleEngine.abort()` (public no-drain teardown)

**Files:**
- Modify: `extension/src/extension/services/struggle/struggleEngine.ts` (after `stop()`, ~line 119)
- Test: `extension/test/unit/services/struggle/struggleEngine.test.ts`

**Interfaces:**
- Consumes: existing private `_teardown()` (clears timer, disposes hub subscriptions, sets `_session = undefined`).
- Produces: `abort(): void` - public teardown WITHOUT the final drain. Task 5's coordinator calls it on revoke.

- [ ] **Step 1: Write the failing test** - append inside the existing `suite('StruggleEngine (tick contract end-to-end)')`. IMPORTANT: the suite's `setup()` uses the REAL clock with the historical `START`, so a buggy `abort() { this.stop(); }` would catch up across years of grid ticks. Rebuild with a pinned manual clock, exactly like the existing `stop() halts ticking` test (~line 143):

```ts
    test('abort() tears down WITHOUT the final drain (#349 revoke path)', () => {
        engine.dispose();
        hub = new TestSensorHub();
        let nowMs = START;
        engine = new StruggleEngine(hub, { now: () => nowMs, setInterval: () => 0, clearInterval: () => { /* manual */ } });
        ticks = [];
        engine.onDidTick(t => ticks.push(t));
        engine.start({ sessionStartMs: START });
        nowMs = START + 25_000;                  // grid ticks 10 s and 20 s are DUE but unprocessed
        engine.abort();                          // stop() would drain them; a consent revoke must not
        assert.deepStrictEqual(ticks, [], 'abort must not compute ticks from pending observations');
        engine.advanceTo(START + 60_000);        // torn down: no session survives an abort
        assert.deepStrictEqual(ticks, [], 'advanceTo after abort is a no-op');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile-tests 2>&1 | tail -10`
Expected: FAIL at compile time with `TS2339: Property 'abort' does not exist on type 'StruggleEngine'`

- [ ] **Step 3: Write minimal implementation** - in `struggleEngine.ts`, directly after `stop()`:

```ts
    /** Consent revoked mid-session (#349): teardown WITHOUT the final drain. stop()
     *  would still process every due tick (and could emit a final alert) from
     *  observations up to the revoke moment; a revoke must not compute anything.
     *  Same teardown dispose() uses, but without disposing the event emitters. */
    abort(): void {
        this._teardown();
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/t349-1.txt | tail -20`
Expected: PASS (whole unit suite green; read /tmp/t349-1.txt on failure)

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggle/struggleEngine.ts extension/test/unit/services/struggle/struggleEngine.test.ts
git commit -m "feat(struggle): public no-drain StruggleEngine.abort() for consent revocation (#349)"
```

---

### Task 2: `AlertSink.onConsentRevoked` + decorator forwarding

**Files:**
- Modify: `extension/src/extension/services/struggle/alerting/alertSink.ts`
- Modify: `extension/src/extension/services/struggle/alerting/throttledAlertSink.ts`
- Modify: `extension/src/extension/services/struggle/alerting/backoffGate.ts`
- Test: `extension/test/logic/struggle/throttledAlertSink.test.ts`, `extension/test/logic/struggle/backoffGate.test.ts`

**Interfaces:**
- Produces: `AlertSink.onConsentRevoked?(): void` - optional; decorators forward (fallback `reset?.()`); budget and rate history are preserved. Task 3 implements it in the orchestrator; Task 5's coordinator calls it.

- [ ] **Step 1: Write the failing tests.** In `throttledAlertSink.test.ts` append (match the file's existing construction helpers; a config of `{ maxAlertsPerSession: 2, minDeliveryGapS: 0 }` works):

```ts
describe('onConsentRevoked (#349)', () => {
    it('forwards to the inner sink and PRESERVES the delivery budget', () => {
        const revoked: string[] = [];
        const inner = {
            deliver: () => { /* noop */ },
            onConsentRevoked: () => revoked.push('inner'),
        };
        const sink = new ThrottledAlertSink(inner, () => ({ maxAlertsPerSession: 2, minDeliveryGapS: 0 }), () => 1000);
        sink.deliver(mkAlert(10));         // budget 1/2 (mkAlert is the file's existing fixture)
        sink.onConsentRevoked();
        expect(revoked).toEqual(['inner']);
        // Budget survived the revoke: one more delivery fits, the third is capped.
        sink.deliver(mkAlert(20));
        sink.deliver(mkAlert(30));
        expect(sink.getThrottleState().deliveredThisSession).toBe(2);
    });
    it('falls back to reset() when the inner sink lacks onConsentRevoked', () => {
        const calls: string[] = [];
        const sink = new ThrottledAlertSink({ deliver: () => { /* noop */ }, reset: () => calls.push('reset') }, () => ({ maxAlertsPerSession: 2, minDeliveryGapS: 0 }));
        sink.onConsentRevoked();
        expect(calls).toEqual(['reset']);
    });
});
```

In `backoffGate.test.ts` append:

```ts
describe('onConsentRevoked (#349)', () => {
    it('forwards to the inner sink', () => {
        const calls: string[] = [];
        const gate = new BackoffGate({ deliver: () => {}, onConsentRevoked: () => calls.push('inner') }, { shouldSuppress: () => false });
        gate.onConsentRevoked();
        expect(calls).toEqual(['inner']);
    });
    it('falls back to reset()', () => {
        const calls: string[] = [];
        const gate = new BackoffGate({ deliver: () => {}, reset: () => calls.push('reset') }, { shouldSuppress: () => false });
        gate.onConsentRevoked();
        expect(calls).toEqual(['reset']);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/logic/struggle/throttledAlertSink.test.ts test/logic/struggle/backoffGate.test.ts 2>&1 | tail -15`
Expected: FAIL with `onConsentRevoked is not a function`

- [ ] **Step 3: Implement.** In `alertSink.ts` add to the `AlertSink` interface after `resetSession?()`:

```ts
    /** Consent revoked mid-session (#349): clear visible surfaces AND terminate local
     *  episode/slot/in-flight state (no egress). PRESERVES the per-session delivery
     *  budget and the 404/course-off latches - revoke->regrant must not refill or lift
     *  anything. Decorator sinks forward; minimal sinks may omit it (callers fall back
     *  to reset). */
    onConsentRevoked?(): void;
```

In `throttledAlertSink.ts` add after `resetSession()`:

```ts
    /** Consent revoked (#349): forward. Budget/rate history are DELIBERATELY preserved. */
    onConsentRevoked(): void {
        if (this._inner.onConsentRevoked) {
            this._inner.onConsentRevoked();
        } else {
            this._inner.reset?.();
        }
    }
```

In `backoffGate.ts` add after `resetSession()`:

```ts
    /** Consent revoked (#349): forward (nothing to clear at this layer). */
    onConsentRevoked(): void {
        if (this.inner.onConsentRevoked) {
            this.inner.onConsentRevoked();
        } else {
            this.inner.reset?.();
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/logic/struggle/throttledAlertSink.test.ts test/logic/struggle/backoffGate.test.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggle/alerting/alertSink.ts extension/src/extension/services/struggle/alerting/throttledAlertSink.ts extension/src/extension/services/struggle/alerting/backoffGate.ts extension/test/logic/struggle/throttledAlertSink.test.ts extension/test/logic/struggle/backoffGate.test.ts
git commit -m "feat(struggle): AlertSink.onConsentRevoked hook, forwarded by both sink decorators (#349)"
```

---

### Task 3: Orchestrator `onConsentRevoked()` implementation

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` (next to `reset()`, ~line 1703)
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`

**Interfaces:**
- Consumes: existing privates `_slot`, `recordTerminalEpisode(episode, outcome)`, `_clearEpisodeRuntime()`, `_clearOutstandingOffer()`, `_setAwaitingEvidence(v, reason)`, `reset()`, `notifySlotDebugChanged()`, `_dbg()`. Outcome labels `'INTERRUPTED'` / `'DISCARDED'` exist (see `resetSession()`).
- Produces: `onConsentRevoked(): void` on `StruggleInterventionService` (satisfies Task 2's interface member).

- [ ] **Step 1: Write the failing tests** - append to `struggleInterventionService.test.ts` (reuse the file's `fakeDeps`, `simulateDecidePending`, `alert`, `tick` helpers):

```ts
describe('onConsentRevoked (#349)', () => {
    it('frees a PARKED slot, clears every surface, keeps the latches', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('hint', undefined, undefined, undefined);   // slot -> PARKED
        expect(svc._slot.isFree()).toBe(false);
        svc.onConsentRevoked();
        expect(svc._slot.isFree()).toBe(true);
        expect(deps.clearLamp).toHaveBeenCalled();
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(false);
        expect(deps.hideActiveBanner).toHaveBeenCalled();
        expect(svc._inFlightMarker).toBeUndefined();
    });
    it('is idempotent on a FREE slot', () => {
        const svc = new StruggleInterventionService(fakeDeps());
        svc.onConsentRevoked();
        svc.onConsentRevoked();
        expect(svc._slot.isFree()).toBe(true);
    });
    it('KEEPS the course-off latch across a revoke (only resetSession lifts latches)', async () => {
        const deps = fakeDeps({ postIntervention: vi.fn(async () => 'course-off' as const) });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());                                // POST -> 'course-off' latches
        await new Promise(r => setTimeout(r, 0));
        expect(svc.shouldSuppress(alert())).toBe(true);      // latched
        svc.onConsentRevoked();
        expect(svc.shouldSuppress(alert())).toBe(true);      // revoke did NOT lift the latch
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts 2>&1 | tail -10`
Expected: FAIL with `svc.onConsentRevoked is not a function`

- [ ] **Step 3: Implement** - in `struggleInterventionService.ts`, directly after `reset()`:

```ts
    /**
     * AlertSink.onConsentRevoked (#349) - the consent-revocation path. Terminates the
     * local episode/slot/in-flight state (no egress) and clears every visible surface,
     * but KEEPS the per-session latches (404 / course-off) and the delivery budget:
     * revoking and regranting must not refill the throttle or lift a latch. Compare
     * resetSession() (new exercise: latches + budget DO reset) and reset() (surfaces
     * only: a DELIVERED slot would survive and suppress fresh alerts after a regrant).
     */
    onConsentRevoked(): void {
        if (!this._slot.isFree()) {
            const st = this._slot.snapshot().state;
            if (st.kind === 'delivered') { this.recordTerminalEpisode(st.episode, 'INTERRUPTED'); }
            else if (st.kind === 'parked') { this.recordTerminalEpisode(st.episode, 'DISCARDED'); }
            this._dbg('  -> CONSENT REVOKED: slot -> FREE');
            this._slot.free();
        }
        this._clearEpisodeRuntime();
        this._clearOutstandingOffer();
        this._setAwaitingEvidence(false, 'consent revoked');
        this.reset();
        this.notifySlotDebugChanged();
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts 2>&1 | tail -10`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/test/logic/struggleIntervention/struggleInterventionService.test.ts
git commit -m "feat(struggle): consent-revocation reset in the orchestrator - slot/episode terminated, budget kept (#349)"
```

---

### Task 4: TOCTOU re-validation (ALL three POST paths) + inbound-frame consent guard

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` - there are exactly THREE `postIntervention` call sites, all get the guard: `_handleAlert` (~line 685, intent `decide`), `_sendHelpRequest` (~line 1343, intent `help_request`), `_drainOwed` (~line 1419, intent `confirm_close`). Plus `onServerAmbient` (~line 731) and `onServerActive`.
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`

**Interfaces:**
- Consumes: Task 3's `onConsentRevoked()` (clears `_inFlightMarker` via `reset()`); existing `_clearInFlight()` (used by the student-opt-out guard in `onServerAmbient`). `_lastSignal` and `_slot` are test-accessible (no `private` modifier); `_drainOwed` IS private - tests call it via a cast.
- Produces: the invariant "no POST and no new surface after revocation", on every egress path.

- [ ] **Step 1: Write the failing tests** - append inside the `describe('onConsentRevoked (#349)')` block from Task 3:

```ts
    it('TOCTOU (decide): consent revoked while collectFiles is in flight -> no POST', async () => {
        let egress = true;
        let resolveCollect!: (v: Record<string, string>) => void;
        const deps = fakeDeps({
            isEgressEnabled: () => egress,
            collectFiles: vi.fn(() => new Promise<Record<string, string>>(r => { resolveCollect = r; })),
        });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));       // reach the collectFiles await
        egress = false;                                  // revoke mid-collection...
        svc.onConsentRevoked();                          // ...as the coordinator would
        resolveCollect({ 'src/A.java': 'class A {}' });
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).not.toHaveBeenCalled();
    });
    it('TOCTOU (help_request): consent revoked while collecting -> no second POST', async () => {
        let egress = true;
        const pending: Array<(v: Record<string, string>) => void> = [];
        const deps = fakeDeps({
            isEgressEnabled: () => egress,
            collectFiles: vi.fn(() => new Promise<Record<string, string>>(r => { pending.push(r); })),
        });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());                            // decide path...
        await new Promise(r => setTimeout(r, 0));
        pending.shift()!({ 'src/A.java': 'x' });         // ...completes normally
        await new Promise(r => setTimeout(r, 0));
        svc.onServerActive(7, undefined, undefined, undefined, undefined, undefined, undefined);  // slot -> DELIVERED
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        void svc._sendHelpRequest();                     // help_request hangs in collectFiles
        await new Promise(r => setTimeout(r, 0));
        egress = false;
        svc.onConsentRevoked();                          // revoke mid-collection
        pending.shift()!({ 'src/A.java': 'x' });
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);   // no help_request POST
    });
    it('confirm_close drain: no consent at entry -> no collection, no POST', async () => {
        let egress = true;
        const deps = fakeDeps({ isEgressEnabled: () => egress });   // collectFiles resolves immediately
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('hint', undefined, undefined, undefined);   // slot -> PARKED (with consent)
        svc.onTick(tick(530));
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.8, path: 'armed' }, trajectory: [] } as never;
        const drainable = svc as unknown as { _owedConfirmClose?: { confirmReason: string }; _drainOwed(): Promise<void> };
        drainable._owedConfirmClose = { confirmReason: 'parked_progress' };
        (deps.collectFiles as ReturnType<typeof vi.fn>).mockClear();
        egress = false;                                  // consent gone at drain time
        await drainable._drainOwed();
        expect(deps.collectFiles).not.toHaveBeenCalled();    // entry gate: not even collected
        expect(deps.postIntervention).not.toHaveBeenCalled();
    });
    it('confirm_close drain: consent revoked mid-collection -> no POST', async () => {
        let egress = true;
        const pending: Array<(v: Record<string, string>) => void> = [];
        const deps = fakeDeps({
            isEgressEnabled: () => egress,
            collectFiles: vi.fn(() => new Promise<Record<string, string>>(r => { pending.push(r); })),
        });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('hint', undefined, undefined, undefined);   // slot -> PARKED
        svc.onTick(tick(530));
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.8, path: 'armed' }, trajectory: [] } as never;
        const drainable = svc as unknown as { _owedConfirmClose?: { confirmReason: string }; _drainOwed(): Promise<void> };
        drainable._owedConfirmClose = { confirmReason: 'parked_progress' };
        const p = drainable._drainOwed();                // hangs in collectFiles
        await new Promise(r => setTimeout(r, 0));
        egress = false;
        svc.onConsentRevoked();                          // revoke mid-collection
        pending.shift()?.({ 'src/A.java': 'x' });        // collection completes anyway
        await p;
        expect(deps.postIntervention).not.toHaveBeenCalled();
    });
    it('an inbound ambient frame after revocation surfaces nothing', () => {
        let egress = true;
        const deps = fakeDeps({ isEgressEnabled: () => egress });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        egress = false;
        svc.onServerAmbient('late hint', undefined, undefined, undefined);
        expect(deps.showLamp).not.toHaveBeenCalled();
        expect(svc._slot.isFree()).toBe(true);
    });
    it('an inbound ACTIVE frame after revocation surfaces nothing', () => {
        let egress = true;
        const deps = fakeDeps({ isEgressEnabled: () => egress });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        egress = false;
        svc.onServerActive(7, undefined, undefined, undefined, undefined, undefined, undefined);
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
        expect(svc._slot.isFree()).toBe(true);
    });
```

(If `svc._lastSignal`'s inline literal does not satisfy the `StruggleSignal` type, build it with the real `buildStruggleSignal(alert(), svc['_buffer'].snapshot())` instead - import it from `@extension/services/struggleIntervention/buildStruggleSignal` like `buildStruggleSignal.test.ts` does.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts 2>&1 | tail -20`
Expected: the six new tests FAIL (POSTs happened / files collected / surfaces shown) - none may hang: every pending collector is resolved by the test itself

- [ ] **Step 3: Implement.** (a) In `_handleAlert`, after the `await this._deps.log.record(...)` line and immediately before `const result = await this._deps.postIntervention(...)` (~line 685):

```ts
            // #349 TOCTOU (spec 3.5): consent may have been revoked while awaiting the
            // file collection - nothing may leave the machine after a revoke. A revoke
            // clears the in-flight marker (onConsentRevoked -> reset), so a token
            // mismatch equally means this request was superseded. A POST already on
            // the wire below cannot be recalled; that residual window is accepted.
            if (!this._deps.isEgressEnabled() || this._inFlightMarker?.requestToken !== requestToken) {
                this._dbg('  -> ABORT (consent revoked or request superseded during collection)');
                return;
            }
```

(b) In `_sendHelpRequest`, after the `collectFiles` await + baseline stash and immediately before its `postIntervention` (~line 1343) - same guard, same comment style:

```ts
            // #349 TOCTOU: re-validate consent + in-flight ownership after the await.
            if (!this._deps.isEgressEnabled() || this._inFlightMarker?.requestToken !== requestToken) {
                return;
            }
```

(c) In `_drainOwed`: add the entry gate next to the existing `isIrisEnabled` gate (~line 1386):

```ts
        // Defense-in-depth (#349): confirm_close carries uncommitted files - never egress
        // without the proactive consent (mirrors the isIrisEnabled gate above).
        if (!this._deps.isEgressEnabled()) { return; }
```

and the same pre-POST guard after its `collectFiles` await, immediately before its `postIntervention` (~line 1419):

```ts
                // #349 TOCTOU: re-validate consent + in-flight ownership after the await.
                if (!this._deps.isEgressEnabled() || this._inFlightMarker?.requestToken !== requestToken) {
                    return;
                }
```

(d) At the very top of `onServerAmbient(...)` and `onServerActive(...)` (before `_setServerAvailable(true)`):

```ts
        // #349: after a consent revoke, a reply to a pre-revoke POST must not open any
        // surface (mirrors the student-opt-out guard). Silent/Close stay ungated - they
        // only finalize state and never open a surface.
        if (!this._deps.isEgressEnabled()) {
            this._clearInFlight();
            return;
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/logic/struggleIntervention/ 2>&1 | tail -10`
Expected: PASS (the whole struggleIntervention logic suite - the guards must not break existing tests, which run with `isEgressEnabled: () => true` from `fakeDeps`)

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/struggleIntervention/struggleInterventionService.ts extension/test/logic/struggleIntervention/struggleInterventionService.test.ts
git commit -m "fix(struggle): revalidate consent on every intervention POST path and drop post-revoke inbound frames (#349)"
```

---

### Task 5: Coordinator consent gate + wiring + test sweep

**Files:**
- Modify: `extension/src/extension/services/struggle/struggleCoordinator.ts`
- Modify: `extension/src/extension/telemetry/index.ts` (~lines 20, 63, 195)
- Modify: `extension/test/unit/services/struggle/struggleCoordinator.test.ts` (sweep + new suite)
- Modify: `extension/test/unit/provider/artemisWebviewProvider.test.ts` (~line 138, construction sweep)
- Modify: `extension/test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts` (vi.mock config)

**Interfaces:**
- Consumes: Task 1's `engine.abort()`; Task 2's `alertSink.onConsentRevoked?.()`.
- Produces:
  - `export interface DetectionConsent { isGranted(): boolean; onDidChange: vscode.Event<void>; }` in `struggleCoordinator.ts`.
  - `StruggleCoordinatorDeps` gains REQUIRED `detectionConsent: DetectionConsent`.
  - Behavior: bookkeeping always; engine + `onDidStartSession` only with consent; `onDidEndSession` only if the engine ran; snapshots and `onNewResult` keyed on `_engineRunning`.

- [ ] **Step 1: Write the failing tests.** In `struggleCoordinator.test.ts` add at top level (after the imports):

```ts
/** Always-granted detection consent for tests that are not about the gate (#349). */
function grantedConsent() {
    return { isGranted: () => true, onDidChange: new vscode.EventEmitter<void>().event };
}

/** Flippable consent whose set() also fires the change event (#349 gate tests). */
class TestConsent {
    private readonly _em = new vscode.EventEmitter<void>();
    private _granted: boolean;
    readonly consent: { isGranted: () => boolean; onDidChange: vscode.Event<void> };
    constructor(granted: boolean) {
        this._granted = granted;
        this.consent = { isGranted: () => this._granted, onDidChange: this._em.event };
    }
    set(granted: boolean): void { this._granted = granted; this._em.fire(); }
}
```

Sweep EVERY existing `new StruggleCoordinator({...})` in this file: add `detectionConsent: grantedConsent(),` to the deps object (the `setup()` construction plus each inline construction).

Then append the new suite:

```ts
suite('StruggleCoordinator consent gate (#349)', () => {
    /** Manual clock: engine timer is inert; tests drive via coordinator.advanceTo. */
    function manualClock(startMs: number) {
        let now = startMs;
        return {
            clock: { now: () => now, setInterval: () => 0, clearInterval: () => { /* manual */ } },
            advance: (ms: number) => { now += ms; },
        };
    }

    /** 1-char-insert text change for the hub (mirrors the engine test's fakeTextChange). */
    function oneCharInsert(uri: string, ts: number): { ts: number; event: unknown } {
        return {
            ts,
            event: {
                document: { uri: vscode.Uri.parse(uri), getText: () => 'x' },
                contentChanges: [{ text: 'a', rangeLength: 0, range: { start: { line: 0 }, isEmpty: true, isSingleLine: true } }],
            },
        };
    }

    test('no consent: no engine, no ticks, no start event, inactive snapshots, onNewResult inert', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(false);
        const hub = new TestSensorHub();
        const latch: boolean[] = [];
        const seen: unknown[] = [];
        const ticks: number[] = [];
        let started = 0;
        const c = new StruggleCoordinator({
            hub,
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: v => latch.push(v) },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidStartSession(() => started++);
            c.onDidTick(t => ticks.push(t.t));
            const sub = hub.onBuildResult(s => seen.push(s));
            c.startExerciseSession(1);
            // The engine never started: editor activity + time produce NO ticks.
            hub.emit.textChange.fire(oneCharInsert('file:///work/ex1/src/A.java', T0 + 1_000) as never);
            advance(30_000);
            c.advanceTo(T0 + 30_000);
            assert.deepStrictEqual(ticks, [], 'no engine ticks without consent');
            assert.strictEqual(started, 0, 'no start event without consent');
            assert.strictEqual(c.activeExerciseId, 1, 'bookkeeping still records the exercise');
            assert.strictEqual(c.getSnapshot().isStruggling, false);
            assert.strictEqual(c.getDebugSnapshot().sessionActive, false, 'debug snapshot reports no live session');
            c.onNewResult({ id: 1, passedTestCaseCount: 3, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(seen, [], 'no hub emit without consent');
            assert.deepStrictEqual(latch, [], 'no progress-latch signal without consent');
            sub.dispose();
        } finally { c.dispose(); }
    });

    test('mid-session grant: engine starts NOW (fresh sessionStartMs), start event fires once', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(false);
        let started = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidStartSession(() => started++);
            c.startExerciseSession(1);
            advance(600_000);                       // student worked 10 min unconsented
            tc.set(true);                           // grant
            assert.strictEqual(started, 1, 'start event fires on grant');
            assert.strictEqual(c.sessionStartMs, T0 + 600_000, 'fresh session start = grant time (fresh warmup)');
            assert.strictEqual(c.getDebugSnapshot().sessionActive, true);
            tc.set(true);                           // duplicate event: reconciliation is idempotent
            assert.strictEqual(started, 1);
        } finally { c.dispose(); }
    });

    test('mid-session revoke: abort without drain, end event, onConsentRevoked on the sink', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(true);
        const sinkCalls: string[] = [];
        const ticks: number[] = [];
        let ended = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: {
                deliver: () => { /* noop */ },
                reset: () => sinkCalls.push('reset'),
                onConsentRevoked: () => sinkCalls.push('onConsentRevoked'),
            },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidTick(t => ticks.push(t.t));
            c.onDidEndSession(() => ended++);
            c.startExerciseSession(1);
            advance(25_000);                        // two grid ticks are DUE but unprocessed
            tc.set(false);                          // revoke
            assert.deepStrictEqual(ticks, [], 'no final drain: due ticks are not computed on revoke');
            assert.strictEqual(ended, 1, 'end event fires on revoke');
            assert.ok(sinkCalls.includes('onConsentRevoked'), 'consent-revocation reset reaches the sink');
            assert.strictEqual(c.getDebugSnapshot().sessionActive, false);
            assert.strictEqual(c.activeExerciseId, 1, 'bookkeeping survives the revoke');
        } finally { c.dispose(); }
    });

    test('revoke -> regrant: engine restarts fresh; throttle budget is never touched by flips', () => {
        const T0 = 1_000_000_000_000;
        const { clock, advance } = manualClock(T0);
        const tc = new TestConsent(true);
        let sessionResets = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, resetSession: () => sessionResets++ },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.startExerciseSession(1);
            assert.strictEqual(sessionResets, 1, 'exercise open resets the throttle session');
            advance(60_000);
            tc.set(false);
            advance(60_000);
            tc.set(true);
            assert.strictEqual(sessionResets, 1, 'consent flips never reset the throttle session');
            assert.strictEqual(c.sessionStartMs, T0 + 120_000, 'regrant restarts the engine fresh');
        } finally { c.dispose(); }
    });

    test('same-exercise call while consent pending updates the root the ENGINE starts with', () => {
        const T0 = 1_000_000_000_000;
        const { clock } = manualClock(T0);
        const tc = new TestConsent(false);
        const hub = new TestSensorHub();
        const ticks: Array<{ n: number }> = [];
        const c = new StruggleCoordinator({
            hub,
            alertSink: { deliver: () => { /* noop */ } },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
            clock,
        });
        try {
            c.onDidTick(t => ticks.push({ n: t.features.nOneCharInserts }));
            c.startExerciseSession(1);                                       // no root known yet
            c.startExerciseSession(1, vscode.Uri.parse('file:///work/ex1')); // repeat call carries the root
            tc.set(true);                                                    // engine starts NOW with that root
            assert.strictEqual(c.activeExerciseRoot?.path, '/work/ex1');
            // Prove the ENGINE received the root: its URI filter keeps the in-root edit
            // and drops the out-of-root one (2 fired, 1 counted).
            hub.emit.textChange.fire(oneCharInsert('file:///work/ex1/src/A.java', T0 + 1_000) as never);
            hub.emit.textChange.fire(oneCharInsert('file:///elsewhere/B.java', T0 + 2_000) as never);
            c.advanceTo(T0 + 10_000);
            assert.strictEqual(ticks.length, 1, 'the engine runs after the grant');
            assert.strictEqual(ticks[0].n, 1, 'URI filter uses the updated root (in-root counted, out-of-root dropped)');
        } finally { c.dispose(); }
    });

    test('exercise end while the engine never ran fires no end event', () => {
        const tc = new TestConsent(false);
        let ended = 0;
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ } },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
        });
        try {
            c.onDidEndSession(() => ended++);
            c.startExerciseSession(1);
            c.endExerciseSession();
            assert.strictEqual(ended, 0, 'no unmatched engine-end event');
            assert.strictEqual(c.activeExerciseId, undefined, 'bookkeeping cleared');
        } finally { c.dispose(); }
    });

    test('baseline asymmetry: denied builds never enter the coordinator baseline; the engine tracker restarts', () => {
        // DEFAULT clock deliberately: TestSensorHub stamps build events with the real
        // Date.now(), and they only enter the engine's stagnation tracker when a grid
        // tick drains the queue - so the session must live in real time and be drained
        // with advanceTo. (The engine's live interval is irrelevant at test speed.)
        const tc = new TestConsent(true);
        const latch: boolean[] = [];
        const c = new StruggleCoordinator({
            hub: new TestSensorHub(),
            alertSink: { deliver: () => { /* noop */ }, onNewBuildResult: v => latch.push(v) },
            detectionConsent: tc.consent,
            exerciseRegistry: undefined,
        });
        try {
            c.startExerciseSession(1);
            c.onNewResult({ id: 1, passedTestCaseCount: 3, testCaseCount: 10 } as ResultDTO);
            c.onNewResult({ id: 2, passedTestCaseCount: 3, testCaseCount: 10 } as ResultDTO);  // no new high
            assert.deepStrictEqual(latch, [true, false], 'consented builds set the baseline (max=3)');
            c.advanceTo(c.sessionStartMs + 10_000);    // tick 10 drains both queued builds
            // Tracker semantics: the first build establishes the streak at 1, the equal
            // second increments it (see testStagnation.ts).
            assert.strictEqual(c.getDebugSnapshot().testStagnation?.streak, 2, 'engine stagnation streak grew');
            tc.set(false);
            c.onNewResult({ id: 3, passedTestCaseCount: 5, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(latch, [true, false], 'denied-period build is fully ignored');
            tc.set(true);
            // The intentional asymmetry (spec 6.4): the coordinator baseline is SESSION-scoped
            // and survives the flip; the engine's own test-stagnation tracker is ENGINE-scoped
            // and restarts fresh with the new engine.
            assert.strictEqual(c.getDebugSnapshot().testStagnation?.streak, 0, 'engine tracker restarted on regrant');
            c.onNewResult({ id: 4, passedTestCaseCount: 4, testCaseCount: 10 } as ResultDTO);
            assert.deepStrictEqual(latch, [true, false, true], '4 > retained max 3 is a new high; the denied 5 never counted');
        } finally { c.dispose(); }
    });
});
```

- [ ] **Step 2: Compile to see the red state, then continue**

Run: `npm run compile-tests 2>&1 | tail -15`
Expected: excess-property errors (`TS2353: 'detectionConsent' does not exist in type 'StruggleCoordinatorDeps'`) in `struggleCoordinator.test.ts` - the dep does not exist yet. After Step 3 lands the REQUIRED dep, re-compiling flips the errors to missing-property (`TS2345`) in `telemetry/index.ts` and `artemisWebviewProvider.test.ts` until Steps 4-5 wire and sweep them; that flip is the proof the dep is required and every construction site is caught.

- [ ] **Step 3: Implement the coordinator.** In `struggleCoordinator.ts`:

(a) Add the interface + extend deps (replace the current `StruggleCoordinatorDeps`):

```ts
/** #349: the coordinator's detection-consent gate. isGranted() is true exactly while
 *  the proactive-egress consent is 'enabled'; onDidChange fires on any change of the
 *  underlying setting. REQUIRED (fail-closed): detection must never run unconsented
 *  because a construction site forgot the gate. */
export interface DetectionConsent {
    isGranted(): boolean;
    onDidChange: vscode.Event<void>;
}

export interface StruggleCoordinatorDeps {
    hub: SensorHub;
    alertSink: AlertSink;
    detectionConsent: DetectionConsent;
    exerciseRegistry?: ExerciseRegistry;
    clock?: EngineClock;
}
```

(b) New fields + constructor additions (next to the existing field block / after the config listener push):

```ts
    private readonly _detectionConsent: DetectionConsent;
    /** #349: true only while the engine observes (started under consent). Exercise
     *  bookkeeping (_activeExerciseId/_activeExerciseRoot) exists independently. */
    private _engineRunning = false;
```

```ts
        this._detectionConsent = deps.detectionConsent;
        this._disposables.push(this._detectionConsent.onDidChange(() => this._reconcileConsent()));
```

(c) Replace `startExerciseSession` and `endExerciseSession`, add `_startEngine` and `_reconcileConsent`:

```ts
    // ── Session lifecycle ──────────────────────────────────────────────
    startExerciseSession(exerciseId: number, exerciseRoot?: vscode.Uri): void {
        if (this._activeExerciseId === exerciseId) {
            // #349: while consent is pending the engine has not started, so a repeat
            // call may carry a better root - remember it for the eventual start.
            if (!this._engineRunning && exerciseRoot !== undefined) {
                this._activeExerciseRoot = exerciseRoot;
            }
            return;
        }
        if (this._activeExerciseId !== undefined) { this.endExerciseSession(); }
        this._activeExerciseId = exerciseId;
        this._activeExerciseRoot = exerciseRoot;
        this._maxPassedTestCount = -1;  // reset per-exercise baseline
        this._refTestCaseCount = -1;
        // New exercise session: reset the sink's per-session throttle budget AND clear
        // any stale intervention (resetSession falls back to reset when unsupported).
        // The budget is exercise-scoped: consent flips (below) never touch it.
        if (this._alertSink.resetSession) {
            this._alertSink.resetSession();
        } else {
            this._alertSink.reset?.();
        }
        if (this._detectionConsent.isGranted()) {
            this._startEngine();
        }
        // #349: without consent this is bookkeeping only - the engine (and the start
        // event) waits for _reconcileConsent. Nothing is observed before opt-in.
    }

    /** Start the engine for the already-recorded exercise. sessionStartMs is the
     *  ACTUAL engine start (= grant time on a mid-session grant), so D1 warmup and
     *  all session-relative timing restart fresh - nothing was observed before. */
    private _startEngine(): void {
        this._sessionStartMs = this._clock.now();
        this._engine.start({ sessionStartMs: this._sessionStartMs, exerciseRoot: this._activeExerciseRoot });
        this._engineRunning = true;
        this._lastTick = undefined;
        this._lastAlert = undefined;
        // Session is live: notify activation so the live-feed buffer clears
        // (fired last so the clear lands once the new session is fully started).
        this._onDidStartSession.fire();
    }

    /** #349: idempotent consent reconciliation (subscribed to detectionConsent.onDidChange). */
    private _reconcileConsent(): void {
        if (this._detectionConsent.isGranted()) {
            // Mid-session grant: start now, fresh. No exercise open -> nothing to do.
            if (this._activeExerciseId !== undefined && !this._engineRunning) {
                this._startEngine();
            }
            return;
        }
        // Mid-session revoke: fail closed FIRST, then abort WITHOUT the final drain
        // (stop() would still compute due ticks from just-revoked observations).
        if (this._engineRunning) {
            this._engineRunning = false;
            this._engine.abort();
            if (this._alertSink.onConsentRevoked) {
                this._alertSink.onConsentRevoked();
            } else {
                this._alertSink.reset?.();
            }
            this._onDidEndSession.fire();
        }
    }

    endExerciseSession(): void {
        if (this._activeExerciseId === undefined) { return; }
        const engineRan = this._engineRunning;
        if (engineRan) {
            // Normal end keeps the final-drain semantics. stop() BEFORE flipping
            // _engineRunning: the drain can synchronously emit ticks/alerts, and
            // consumers reading the snapshot inside those events must still see a
            // live session. (Revocation is the opposite: fail closed first, abort.)
            this._engine.stop();
            this._engineRunning = false;
        }
        this._activeExerciseId = undefined;
        this._activeExerciseRoot = undefined;
        // #349: the session events mean ENGINE transitions (status bar, live feed,
        // Iris cache). A session whose engine never ran ends without an end event.
        if (engineRan) { this._onDidEndSession.fire(); }
    }
```

(d) Gate `onNewResult` - insert as the second line:

```ts
    onNewResult(result: ResultDTO): void {
        if (!this._isEnabled) { return; }
        // #349: without a running (= consented) engine a build result must not be
        // observed - no hub emit, no baseline mutation, no progress-latch signal.
        if (!this._engineRunning) { return; }
```

(e) Re-key the snapshots on `_engineRunning`:
- `getSnapshot()`: change the guard `if (this._activeExerciseId === undefined)` to `if (!this._engineRunning)` (update the comment: "no running engine" instead of "no active session").
- `getDebugSnapshot()`: `sessionActive: this._engineRunning`, `decisionTrace: (this._engineRunning && tick) ? ... : null`, `testStagnation: this._engineRunning ? ... : null`.

- [ ] **Step 4: Wire it in `telemetry/index.ts`:**

(a) Add the import: `import { VSCODE_CONFIG } from '@extension/utils';`

(b) After `const consent = new ProactiveEgressConsent();` (~line 63):

```ts
    // #349: the coordinator's detection-consent gate. Detection observes only while
    // the egress consent is explicitly 'enabled'; the emitter relays every change of
    // the underlying setting so grant/revoke reconcile mid-session.
    const consentChanged = new vscode.EventEmitter<void>();
    deps.context.subscriptions.push(consentChanged);
    deps.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`${VSCODE_CONFIG.IRIS.SECTION}.${VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY}`)) {
            consentChanged.fire();
        }
    }));
```

(c) Extend the coordinator construction (~line 195):

```ts
    coordinator = new StruggleCoordinator({
        hub: deps.hub,
        alertSink: backoffGate,
        detectionConsent: { isGranted: () => consent.isEnabled, onDidChange: consentChanged.event },
        exerciseRegistry: deps.exerciseRegistry,
    });
```

- [ ] **Step 5: Sweep the two remaining constructions:**

(a) `test/unit/provider/artemisWebviewProvider.test.ts`: the file constructs `StruggleCoordinator` THREE times (~lines 138, 204, 353) - add to EVERY deps object (or hoist a shared `grantedConsent()` helper like the coordinator test's):

```ts
            detectionConsent: { isGranted: () => true, onDidChange: new vscode.EventEmitter<void>().event },
```

Verify completeness with `grep -n "new StruggleCoordinator(" test/unit/provider/artemisWebviewProvider.test.ts` - every hit needs the member.

(b) `test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts`: the `vi.mock('vscode')` config returns defaults, which would leave the consent at `'ask'` and gate the engine off. Change the `workspace.getConfiguration` line to grant consent (prod-equivalent behavior for these tests):

```ts
            getConfiguration: () => ({ get: (key: string, def: unknown) => key === 'proactiveCodeEgress' ? 'enabled' : def }),
```

- [ ] **Step 6: Run everything**

Run: `npm run check-types && npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/t349-5.txt | tail -15`
Expected: type-check clean, unit suite PASS (incl. the 7 new gate tests)

Run: `npx vitest run 2>&1 | tail -8`
Expected: full vitest suite PASS

- [ ] **Step 7: Commit**

```bash
git add extension/src/extension/services/struggle/struggleCoordinator.ts extension/src/extension/telemetry/index.ts extension/test/unit/services/struggle/struggleCoordinator.test.ts extension/test/unit/provider/artemisWebviewProvider.test.ts extension/test/logic/telemetry/createStruggleEngine.proactiveLevel.test.ts
git commit -m "feat(struggle): consent-gate the engine in the coordinator - nothing observed before opt-in (#349)"
```

---

### Task 6: `IrisEnabledCache` handler split

**Files:**
- Modify: `extension/src/extension/services/iris/irisEnabledCache.ts` (constructor + `_onSessionChange`, ~lines 38-40 and 68-77)
- Test: `extension/test/logic/iris/irisEnabledCache.test.ts`

**Interfaces:**
- Consumes: the coordinator's session events, which after Task 5 mean engine transitions. On a consent revoke, `getActiveExerciseId()` stays defined (bookkeeping survives), so the old identical handler would re-kick a pointless classify.
- Produces: `onSessionEnd` resets WITHOUT re-kicking; `onSessionStart` resets and classifies. Public API unchanged.

- [ ] **Step 1: Write the failing test** - append to `irisEnabledCache.test.ts` (reuse the file's existing deps-builder pattern; the deps are fully injectable):

```ts
describe('engine-keyed session events (#349)', () => {
    it('onSessionEnd resets WITHOUT re-kicking a classify even while an exercise is still active', async () => {
        const classify = vi.fn(async () => 'enabled' as const);
        let fireStart: () => void = () => {};
        let fireEnd: () => void = () => {};
        const cache = new IrisEnabledCache({
            classify,
            onSessionStart: l => { fireStart = l; return { dispose: () => {} }; },
            onSessionEnd: l => { fireEnd = l; return { dispose: () => {} }; },
            onReconnect: () => ({ dispose: () => {} }),
            getActiveExerciseId: () => 42,           // bookkeeping survives a revoke
            schedule: (fn) => { fn(); return () => {}; },
        });
        await Promise.resolve();                     // constructor backstop classify settles
        const callsAfterConstruction = classify.mock.calls.length;
        fireEnd();                                   // consent revoke: engine ended, exercise still open
        await Promise.resolve();
        expect(classify.mock.calls.length).toBe(callsAfterConstruction);  // no re-kick
        expect(cache.isEnabled()).toBe(false);       // reset fail-closed
        fireStart();                                 // regrant: engine session starts
        await Promise.resolve();
        expect(classify.mock.calls.length).toBe(callsAfterConstruction + 1);  // start classifies
        cache.dispose();
    });
});
```

(Adapt the deps literal to the file's existing builder if one exists - keep the assertions identical.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/logic/iris/irisEnabledCache.test.ts 2>&1 | tail -10`
Expected: FAIL - the identical end handler re-kicks (`classify` called again after `fireEnd`)

- [ ] **Step 3: Implement** - in `irisEnabledCache.ts`, replace the two constructor subscriptions and split `_onSessionChange`:

```ts
        this._subs.push(_deps.onSessionStart(() => this._onSessionStart()));
        this._subs.push(_deps.onSessionEnd(() => this._onSessionEnd()));
```

```ts
    /** Engine session started: invalidate in-flight work, reset fail-closed, classify. */
    private _onSessionStart(): void {
        this._resetForTransition();
        if (this._deps.getActiveExerciseId() !== undefined) {
            this._refresh(this._token);
        }
    }

    /** Engine session ended (exercise end OR consent revoke, #349): reset WITHOUT
     *  re-kicking - on a revoke the exercise bookkeeping stays active, but Iris
     *  availability is only needed again once an engine session starts. */
    private _onSessionEnd(): void {
        this._resetForTransition();
    }

    /** Any session transition: invalidate in-flight work and reset fail-closed. */
    private _resetForTransition(): void {
        this._token++;
        this._state = 'unknown';
        this._retryIndex = 0;
        this._cancelRetry?.();
        this._cancelRetry = undefined;
    }
```

Delete the old `_onSessionChange` and update the constructor backstop to call `this._onSessionStart()` (same behavior as before).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/logic/iris/irisEnabledCache.test.ts 2>&1 | tail -8`
Expected: PASS (whole file)

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension/services/iris/irisEnabledCache.ts extension/test/logic/iris/irisEnabledCache.test.ts
git commit -m "refactor(iris): split IrisEnabledCache session handlers - end resets without re-kick (#349)"
```

---

### Task 7: Informed-consent copy + changelog + full verification

**Files:**
- Modify: `extension/package.json` (`artemis.iris.proactiveCodeEgress` block, ~line 191)
- Modify: `extension/src/extension/services/struggleIntervention/proactiveEgressConsent.ts` (~line 35)
- Modify: `extension/src/extension.ts` (~line 422, stale comment) and `extension/src/extension/telemetry/contract.ts` (~line 208, stale doc line)
- Modify: `CHANGELOG.md` (repo root, `## [Unreleased]` → `### Changed`)

**Interfaces:** none (copy + verification only).

- [ ] **Step 1: Update the setting copy** in `extension/package.json` - replace the `artemis.iris.proactiveCodeEgress` block's `enumDescriptions` and `markdownDescription`:

```json
          "enumDescriptions": [
            "Ask once whether to enable proactive help (local struggle detection plus code reading when it triggers)",
            "Enable proactive help: local typing/pause analysis runs during programming exercises, and Iris may read your current code when the detector triggers",
            "No proactive help: no local struggle detection runs and no code is ever sent proactively"
          ],
          "default": "ask",
          "markdownDescription": "Controls proactive help. When **enabled**, the extension runs local struggle detection (typing/pause analysis) during programming exercises and may send your current exercise code to Iris **only** when the detector flags that you may be stuck. When **disabled** (or while undecided), no local detection runs and nothing is sent. Separate from `artemis.dataCollectionConsent`."
```

- [ ] **Step 2: Update the prompt copy** in `proactiveEgressConsent.ts` - replace the `showInformationMessage` text with exactly:

```ts
        const choice = await vscode.window.showInformationMessage(
            'Allow Iris to detect when you might be stuck and proactively offer help? This enables local typing/pause analysis during programming exercises; your code is only sent to Iris when the detector triggers.',
            'Enable', 'Not now', 'Settings',
        );
```

- [ ] **Step 3: Update the two stale internal descriptions** that still say the consent only covers proactive code READING:

(a) `extension/src/extension.ts` (~line 422), replace the comment above `void promptConsentIfAsk();`:

```ts
			// Ask once (only while undecided) whether to enable proactive help: local
			// struggle detection plus code reading when it triggers (#349). No-op in
			// the clean build.
```

(b) `extension/src/extension/telemetry/contract.ts` (~line 208), replace the `promptConsentIfAsk` doc line:

```ts
    /** Ask once, post-auth, whether to enable proactive help (local struggle detection +
     *  trigger-gated code reading, #349); no-op once decided. */
```

- [ ] **Step 4: Changelog** - add to `CHANGELOG.md` under `## [Unreleased]` → `### Changed` (create the subsection position after the existing entries):

```markdown
- **Proactive help consent:** Struggle detection now starts only after the proactive-help consent (`artemis.iris.proactiveCodeEgress`) is explicitly enabled. Without consent nothing is observed or computed locally (previously only sending was blocked); granting mid-session starts detection fresh, and revoking stops it immediately and clears any visible hint.
```

- [ ] **Step 5: Full gates**

Run (from `extension/`): `npm run check-types && npm run lint && npm run knip 2>&1 | tail -5`
Expected: all clean

Run: `npx vitest run 2>&1 | tail -6`
Expected: PASS

Run: `npm run compile-tests && npm run test:unit 2>&1 | tee /tmp/t349-7.txt | tail -8`
Expected: PASS (`failures="0"` also visible in `reports/mocha-results.xml`)

Run: `npm run package:vsix 2>&1 | grep -E "OK \(desktop\)|DONE"` and `npm run package:openvsx 2>&1 | grep -E "OK \(openvsx\)|DONE"` and `npm run package:rec 2>&1 | grep -E "variant|DONE"`
Expected: both verifiers `OK`, three VSIXs packaged. Then `rm -f *.vsix`.

- [ ] **Step 6: Commit**

```bash
git add extension/package.json extension/src/extension/services/struggleIntervention/proactiveEgressConsent.ts extension/src/extension.ts extension/src/extension/telemetry/contract.ts CHANGELOG.md
git commit -m "docs(struggle): informed-consent copy for the detection gate + changelog (#349)"
```
