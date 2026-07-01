import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@extension/domain';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import type { SlotState } from '@extension/services/struggleIntervention/slot/slotManager';
import { StaleWatchdog } from '@extension/services/struggleIntervention/slot/staleWatchdog';
import type { StruggleInterventionRequest } from '@extension/services/struggleIntervention/struggleContract';
import { type StruggleInterventionDeps, StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { IrisChatMessage } from '@extension/types';
import { emptyDecisionTrace } from '@test/__shared__/tickRecordFixture';

/**
 * Set up a synthetic in-flight 'decide' for testing inbound handlers (onServerAmbient/onServerActive).
 * In production these are set by _handleAlert before the async POST; tests call them directly.
 * Also sets a pre-allocated candidate so take-parked/take-delivered can proceed.
 */
function simulateDecidePending(svc: StruggleInterventionService, episodeId = 'ep-test', hardEvent = false): void {
    const gen = svc._slot.generation();
    const requestToken = 'test-request-token';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    // Also set the candidate so take-parked/take-delivered can proceed
    svc._candidate = { episodeId, isNew: true, hints: [], createdAtMs: 0 };
}

function fakeDeps(over: Partial<StruggleInterventionDeps> = {}): StruggleInterventionDeps {
    return {
        isEgressEnabled: () => true,
        hasNoaiMarker: () => false,
        getExerciseId: () => 42,
        getExerciseRoot: () => undefined,
        collectFiles: vi.fn(async () => ({ 'src/A.java': 'class A {}' })),
        postIntervention: vi.fn(async () => 'accepted' as const),
        openSession: vi.fn(async () => undefined),
        showAmbient: vi.fn(),
        showLamp: vi.fn(),
        clearLamp: vi.fn(),
        showInline: vi.fn(),
        showGutterOnly: vi.fn(),
        clearInline: vi.fn(),
        isAnchorLive: () => false,
        isStudentProactiveOn: () => true,
        softThreshold: 3,
        pauseStrikes: 5,
        setBadge: vi.fn(),
        showActiveNotification: vi.fn(),
        postBubble: vi.fn(),
        log: { record: vi.fn(async () => undefined) } as unknown as StruggleInterventionDeps['log'],
        setTimeoutFn: () => { /* never auto-clear in-flight in tests */ },
        // C2 reveal deps
        generateLocalId: () => 'test-local-id',
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        revealAmbient: vi.fn(async () => ({
            id: 7,
            sentAt: '2024-01-01T00:00:00Z',
            proactiveEpisodeId: 'server-ep-id',
        } as IrisChatMessage)),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        // C3 slot-continuity deps
        cancelOutstandingStruggleJob: vi.fn(async () => undefined),
        foldEpisode: vi.fn(),
        // C4: stale-row suppression
        postRemoveMessage: vi.fn(),
        deleteSupersededProactiveMessage: vi.fn(async () => undefined),
        postStaleAsk: vi.fn(),
        ...over,
    };
}
function alert(): AlertRecord {
    return { kind: 'edit', t: 530, ts: 530000, urgency: 0.72, v: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false };
}
function tick(t: number): TickRecord {
    return { t, ts: t * 1000, features: {} as TickRecord['features'], sBase: 0.5, s: 0.5, v: 0.5, fastDecay: false, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace };
}

describe('StruggleInterventionService', () => {
    it('discrete (test-stagnation) alert is fully skipped: no POST, no fallback surface (Phase 0 / G2)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        const discrete: AlertRecord = { kind: 'discrete', t: 530, ts: 530000, urgency: 0.72, v: 0.72, trigger: 'test-stagnation', inWarmup: false };
        svc.deliver(discrete);
        await Promise.resolve();
        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.showAmbient).not.toHaveBeenCalled();
        expect(deps.showActiveNotification).not.toHaveBeenCalled();
    });

    it('shouldSuppress (BackoffSource): true for non-edit + student-opt-out, false for a normal edit alert', () => {
        // This is what BackoffGate consults ABOVE the throttle, so a suppressed alert never burns delivery budget.
        const discrete: AlertRecord = { kind: 'discrete', t: 530, ts: 530000, urgency: 0.72, v: 0.72, trigger: 'test-stagnation', inWarmup: false };
        expect(new StruggleInterventionService(fakeDeps()).shouldSuppress(discrete)).toBe(true);                                    // non-edit → never surfaces
        expect(new StruggleInterventionService(fakeDeps({ isStudentProactiveOn: () => false })).shouldSuppress(alert())).toBe(true); // opted out
        expect(new StruggleInterventionService(fakeDeps()).shouldSuppress(alert())).toBe(false);                                   // normal edit alert passes
        // (course-off only latches after a POST → covered by the course-off latch test.)
    });

    it('not opted in → shows a local template on the lamp (opensChat=false), never POSTs', async () => {
        const deps = fakeDeps({ isEgressEnabled: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await Promise.resolve();
        expect(deps.showAmbient).toHaveBeenCalledWith(expect.any(String), false);
        expect(deps.postIntervention).not.toHaveBeenCalled();
    });

    it('opted in → collects files and POSTs exercise-keyed; a second immediate alert is skipped (in-flight)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        const [exId, body] = (deps.postIntervention as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(exId).toBe(42);
        expect(body.struggleSignal.alert.primaryBoundary).toBe('FM');
        expect(body.uncommittedFiles['src/A.java']).toContain('class A');
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
    });

    it('two alerts fired concurrently (before file collection resolves) still POST only once (in-flight TOCTOU)', async () => {
        // collectFiles is async; the in-flight slot must be claimed synchronously BEFORE that await so the
        // second alert, arriving while the first is still collecting, is skipped rather than racing a 2nd POST.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());   // suspends at await collectFiles, but has already set in-flight
        svc.deliver(alert());   // sees in-flight → skipped
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
    });

    it('.noai marker → shows a local template, never POSTs (spec §9)', async () => {
        const deps = fakeDeps({ hasNoaiMarker: () => true });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await Promise.resolve();
        expect(deps.showAmbient).toHaveBeenCalledWith(expect.any(String), false);
        expect(deps.postIntervention).not.toHaveBeenCalled();
    });

    it('server 404 → no-AI template now AND subsequent alerts stop POSTing (spec §9/§11)', async () => {
        const deps = fakeDeps({ postIntervention: vi.fn(async () => 'unavailable' as const) });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        expect(deps.showAmbient).toHaveBeenCalledWith(expect.any(String), false);
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
    });

    it("'failed' POST releases the in-flight slot so the next alert retries instead of wedging for 30s (silent, no lamp)", async () => {
        const post = vi.fn()
            .mockResolvedValueOnce('failed' as const)
            .mockResolvedValue('accepted' as const);
        const deps = fakeDeps({ postIntervention: post });   // setTimeoutFn is a no-op here, so ONLY the 'failed' fix can release in-flight
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());                                // first POST → 'failed'
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(1);
        expect(deps.showAmbient).not.toHaveBeenCalled();     // 'failed' is silent: no fallback lamp (per contract)
        svc.deliver(alert());                                // in-flight was released → this one POSTs again
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('isProactiveDegraded: true when egress consent is off (local-template fallback)', () => {
        const svc = new StruggleInterventionService(fakeDeps({ isEgressEnabled: () => false }));
        expect(svc.isProactiveDegraded()).toBe(true);
    });

    it('isProactiveDegraded: false when consent on and server up', () => {
        const svc = new StruggleInterventionService(fakeDeps({ isEgressEnabled: () => true }));
        expect(svc.isProactiveDegraded()).toBe(false);
    });

    it('isProactiveDegraded: true after a 404 latches the server unavailable', async () => {
        const svc = new StruggleInterventionService(fakeDeps({
            isEgressEnabled: () => true,
            postIntervention: vi.fn(async () => 'unavailable' as const),
        }));
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(svc.isProactiveDegraded()).toBe(true);   // _serverAvailable latched false by the 404
    });

    it('a 404 server-unavailable latch survives reset() (settings toggle) and clears only on resetSession() (new exercise)', async () => {
        const svc = new StruggleInterventionService(fakeDeps({ postIntervention: vi.fn(async () => 'unavailable' as const) }));
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(svc.isProactiveDegraded()).toBe(true);
        svc.reset();
        expect(svc.isProactiveDegraded()).toBe(true);   // settings-toggle clear KEEPS the per-session 404 latch
        svc.resetSession();
        expect(svc.isProactiveDegraded()).toBe(false);  // a new exercise re-probes the server
    });

    it('course-off latches (survives the in-flight watchdog + a settings-toggle reset): no re-POST until resetSession (spec §13)', async () => {
        // Capture the in-flight watchdog callback so we can fire it manually. This is the load-bearing part of the
        // test: course-off must RELEASE the in-flight slot, so the "no second POST" guarantee has to come from a
        // real per-session latch, NOT from a flag left stuck in-flight (which the watchdog would otherwise clear).
        let fireInflightWatchdog: (() => void) | undefined;
        const post = vi.fn(async () => 'course-off' as const);
        const deps = fakeDeps({ postIntervention: post, setTimeoutFn: (fn) => { fireInflightWatchdog = fn; } });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));

        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(1);
        expect(deps.showAmbient).not.toHaveBeenCalled();   // course-off => no no-AI lamp

        // The watchdog fires: without the latch this would un-wedge the session and let the next alert POST again.
        fireInflightWatchdog?.();
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(1);             // latched, not merely in-flight

        svc.reset();                                       // settings-toggle UI clear must NOT lift the per-session latch
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(1);             // still latched after reset()

        svc.resetSession();                                // a new exercise re-probes → clears the latch
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('student-off suppresses the proactive POST entirely', async () => {
        const post = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: post, isStudentProactiveOn: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(post).not.toHaveBeenCalled();
        expect(deps.showAmbient).not.toHaveBeenCalled();
    });

    it('inbound ambient/active are dropped when the student turned proactive off (mid-flight opt-out)', () => {
        const deps = fakeDeps({ isStudentProactiveOn: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onServerAmbient('hint', undefined, undefined, undefined);
        svc.onServerActive(99);
        expect(deps.showAmbient).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveNotification).not.toHaveBeenCalled();
    });

    it('setStudentProactive(active exercise, false) clears a standing inline cue + lamp + badge', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.setStudentProactive(42, false);   // 42 is fakeDeps' active exercise
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(false);
    });

    it('setStudentProactive on a NON-active exercise does not touch live surfaces (no cross-exercise clobber)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.setStudentProactive(999, false);   // active is 42, not 999
        expect(deps.clearInline).not.toHaveBeenCalled();
        expect(deps.clearLamp).not.toHaveBeenCalled();
        expect(deps.setBadge).not.toHaveBeenCalled();
    });

    it('resumeProactive clears an auto-pause for the active exercise, but not for another', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        for (let i = 0; i < 5; i++) { svc.recordChatDismiss(); }   // Slice 4b: drives the backoff to paused
        expect(svc.isProactivePaused(42)).toBe(true);              // 42 is fakeDeps' active exercise
        svc.resumeProactive(999);                                  // wrong exercise → no effect
        expect(svc.isProactivePaused(42)).toBe(true);
        svc.resumeProactive(42);                                   // active exercise → cleared
        expect(svc.isProactivePaused(42)).toBe(false);
    });

    // C1/C3: ambient = PARKED pointer only (badge + lamp always; gutter icon if anchor live). No inline text, no toast.
    // Note: C3 routes onServerAmbient through the slot guard; tests use simulateDecidePending to set up the in-flight state.
    it('inbound ambient event (no anchor) → badge + lamp (PARKED pointer); no showAmbient, no inline', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('Re-check the logic.', undefined, undefined, undefined);
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showAmbient).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
        expect(deps.showActiveNotification).not.toHaveBeenCalled();
        // Slot is now PARKED
        expect(svc._slot.snapshot().state.kind).toBe('parked');
    });

    it('inbound ambient event WITH a live anchor → badge + lamp + gutter icon; no inline text (spec §5 pull model)', () => {
        const deps = fakeDeps({ isAnchorLive: () => true });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('Re-check the logic.', 'src/A.java', 42, 'off-by-one?');
        expect(deps.showGutterOnly).toHaveBeenCalledWith('src/A.java', 42);
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        // Ambient must NOT render the inline after-line text or toast or bubble:
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showAmbient).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
        expect(deps.showActiveNotification).not.toHaveBeenCalled();
    });

    it('inbound ambient event with an anchor NOT live → badge + lamp only; clears any stale inline cue', () => {
        const deps = fakeDeps({ isAnchorLive: () => false });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('Re-check the logic.', 'src/A.java', 42, 'off-by-one?');
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.clearInline).toHaveBeenCalled();   // clears any stale cue from a previous active
        expect(deps.showGutterOnly).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showAmbient).not.toHaveBeenCalled();
    });

    it('hard-pauses after pauseStrikes dismisses; clicked + resetSession clear it; reset() (UI-only) does NOT', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        const surface = () => svc.onServerAmbient('hint', undefined, undefined, undefined); // sets _lastSurface (lamp)
        for (let i = 0; i < 5; i++) { surface(); svc.recordOutcome('dismissed'); }
        expect(svc.isPaused()).toBe(true);
        svc.reset();                                  // settings-toggle UI clear must NOT lift the per-exercise pause
        expect(svc.isPaused()).toBe(true);
        svc.resetSession();                           // a new exercise clears it
        expect(svc.isPaused()).toBe(false);
        for (let i = 0; i < 5; i++) { surface(); svc.recordOutcome('dismissed'); }
        surface(); svc.recordOutcome('clicked');      // engagement also clears
        expect(svc.isPaused()).toBe(false);
    });

    it('owes an escalating soft skip once annoyance crosses softThreshold (dismiss-driven)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        const surface = () => svc.onServerAmbient('hint', undefined, undefined, undefined);
        surface(); svc.recordOutcome('dismissed');   // annoyance 2 (< 3) -> no skip yet
        expect(svc.tryConsumeSoftSkip()).toBe(false);
        surface(); svc.recordOutcome('dismissed');   // annoyance 4 (>= 3) -> one skip owed
        expect(svc.tryConsumeSoftSkip()).toBe(true);  // consumed
        expect(svc.tryConsumeSoftSkip()).toBe(false); // none left
    });

    it('recordOutcome: each dismissed call increments the backoff counter (C3: episode-level single-shot tracking replaces surface-level guard)', () => {
        // C3 removed the _lastSurface single-shot guard; recordOutcome now counts every call.
        // Episode-level de-duplication (preventing double-close) is C8's responsibility.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.recordOutcome('dismissed');
        expect(svc.isPaused()).toBe(false);   // pauseStrikes=5; 1 strike is not enough
    });

    it('single-shot guard removed (C3): recordOutcome counts all calls (episode-level tracking is C8)', () => {
        // The _lastSurface single-shot guard is removed in C3; repeated recordOutcome calls all count.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        for (let i = 0; i < 5; i++) { svc.recordOutcome('dismissed'); } // 5 calls all count
        expect(svc.isPaused()).toBe(true);    // 5 dismisses >= pauseStrikes=5 -> paused
    });

    it('recordChatDismiss feeds the backoff even with no current surface (reloaded bubble)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        for (let i = 0; i < 5; i++) { svc.recordChatDismiss(); }   // no surface shown beforehand
        expect(svc.isPaused()).toBe(true);
    });

    // C3: active now routes through the slot guard; use simulateDecidePending for test setup.
    // The old 3/session cap is replaced by the slot (only one episode at a time). Only the first active
    // surface per episode is delivered; subsequent decides from a DELIVERED slot are suppressed unless
    // the slot is an escalation candidate (ambient+hardEvent).
    it('inbound active event (FREE slot) → opens session + badge + notification + inline if anchor live', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(7);
        expect(deps.clearInline).toHaveBeenCalled();   // active clears any stale inline cue
        expect(deps.openSession).toHaveBeenCalledWith(7);
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showActiveNotification).toHaveBeenCalled();
        // Slot is now DELIVERED
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
    });

    it('second active decide on an already-DELIVERED slot is suppressed by the slot (C3 blind-overwrite fix)', () => {
        // First active takes the slot (DELIVERED). A second decide from a different alert
        // returns 'suppress' (DELIVERED + active without hardEvent). The slot stays DELIVERED.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(7);
        expect(deps.openSession).toHaveBeenCalledTimes(1);

        // Simulate a second decide arriving (non-hard boundary -> no escalation)
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(7);
        expect(deps.openSession).toHaveBeenCalledTimes(1); // still 1, not 2 -- slot prevents overwrite
    });

    it('slot freed on resetSession() -> next active re-opens (new exercise)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.reset();                       // settings-toggle does NOT free the slot
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.resetSession();                // new exercise frees the slot
        expect(svc._slot.isFree()).toBe(true);

        // After resetSession a new active takes the slot again
        simulateDecidePending(svc, 'ep-2', false);
        svc.onServerActive(7);
        expect(deps.openSession).toHaveBeenCalledTimes(2);
    });

    it('inbound active event with a live anchor ALSO drops the inline breadcrumb (spec §6.1)', () => {
        const deps = fakeDeps({ isAnchorLive: () => true });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(8, 'src/B.java', 84, 'check punctuation', 0.9);
        // the bubble still opens (active surface)...
        expect(deps.openSession).toHaveBeenCalledWith(8);
        expect(deps.showActiveNotification).toHaveBeenCalled();
        // ...AND the inline breadcrumb is rendered at the anchor...
        expect(deps.showInline).toHaveBeenCalledWith('src/B.java', 84, 'check punctuation', 'Iris has a suggestion for you.');
        // ...and it clears any standing lamp (inline and lamp are exclusive surfaces, mirrors onServerAmbient).
        expect(deps.clearLamp).toHaveBeenCalled();
    });

    it('inbound active event without a live anchor renders no inline cue (clears any stale one)', () => {
        const deps = fakeDeps({ isAnchorLive: () => false });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(8, 'src/B.java', 84, 'check punctuation', 0.9);
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.openSession).toHaveBeenCalledWith(8);
    });

    // Terminal-cleanup: the inline cue is episode-scoped, so every terminal exit must retire it.
    // All terminal exits (RECOVERED close, watchdog/ABANDON force-free, dismiss, stale-ask
    // "something-else", new-exercise) funnel through _clearEpisodeRuntime(), so one representative
    // path (dismissEpisode) proves the shared seam clears the standing cue.
    it('a terminal episode exit retires the standing inline cue (no reliance on a later file edit)', () => {
        const deps = fakeDeps({ isAnchorLive: () => true });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(8, 'src/B.java', 84, 'check punctuation', 0.9);
        expect(deps.showInline).toHaveBeenCalled();     // an inline cue is standing on the DELIVERED slot
        vi.mocked(deps.clearInline).mockClear();        // ignore any setup stale-cue clear

        svc.dismissEpisode();                           // terminal exit -> _clearEpisodeRuntime()

        expect(deps.clearInline).toHaveBeenCalled();    // the standing cue is retired at the episode end
        expect(svc._slot.isFree()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// C2: hold-frozen ambient + reveal-on-click + episode-outcome API + back-fill
// ---------------------------------------------------------------------------

describe('StruggleInterventionService C2 reveal', () => {
    /** Puts the slot in PARKED state and sets the frozen session id. */
    function setupParked(svc: StruggleInterventionService, sessionId: number, hintText = 'Re-check the loop.', epId = 'ep-uuid'): void {
        const ep = newEpisode(1000, () => epId);
        svc._slot.takeParked(1000, ep, { level: 'ambient', text: hintText, atSessionS: 100 });
        svc._frozenSessionId = sessionId;
    }

    it('revealParkedHint: slot moves PARKED -> DELIVERED (generation bumps) on click', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        const genBefore = svc._slot.generation();
        setupParked(svc, 55);

        await svc.revealParkedHint();

        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        expect(svc._slot.generation()).toBeGreaterThan(genBefore + 1); // +1 from takeParked, +1 from revealParked
    });

    it('revealParkedHint: openSession called with the frozen sessionId', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55);

        await svc.revealParkedHint();

        expect(deps.openSession).toHaveBeenCalledWith(55);
    });

    it('revealParkedHint: postRevealBubble called with the frozen text and generated localId', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.');

        await svc.revealParkedHint();

        expect(deps.postRevealBubble).toHaveBeenCalledWith('Re-check the loop.', 'test-local-id');
    });

    it('revealParkedHint: revealAmbient called once with correct args incl. clientMessageId=localId', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        await svc.revealParkedHint();

        expect(deps.revealAmbient).toHaveBeenCalledTimes(1);
        expect(deps.revealAmbient).toHaveBeenCalledWith(42, 'ep-uuid', 'Re-check the loop.', 'ambient', 'test-local-id');
    });

    it('revealParkedHint: DTO from revealAmbient reconciles the optimistic bubble (id + proactiveEpisodeId + sentAt)', async () => {
        const deps = fakeDeps({
            revealAmbient: vi.fn(async () => ({
                id: 7,
                sentAt: '2024-01-01T00:00:00Z',
                proactiveEpisodeId: 'server-ep-id',
            } as IrisChatMessage)),
        });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55);

        await svc.revealParkedHint();

        expect(deps.reconcileOptimisticBubble).toHaveBeenCalledWith(
            'test-local-id', 7, 'server-ep-id', '2024-01-01T00:00:00Z',
        );
        // Only one reconcile call: no duplicate row
        expect(deps.reconcileOptimisticBubble).toHaveBeenCalledTimes(1);
    });

    it('revealParkedHint: a persist failure keeps the bubble (no reconcile), does NOT revert slot to PARKED, schedules retry with the SAME localId', async () => {
        let retryFn: (() => void) | undefined;
        const revealAmbient = vi.fn()
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValue({ id: 7, sentAt: '2024-01-01T00:00:00Z', proactiveEpisodeId: 'server-ep-id' } as IrisChatMessage);
        const deps = fakeDeps({
            revealAmbient,
            setTimeoutFn: (fn) => { retryFn = fn; },
        });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        await svc.revealParkedHint();

        // Bubble NOT reconciled yet (persist failed)
        expect(deps.reconcileOptimisticBubble).not.toHaveBeenCalled();
        // Slot stays DELIVERED (not reverted to PARKED)
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        // A retry was scheduled
        expect(retryFn).toBeDefined();

        // Fire the retry
        await (retryFn as () => void)();

        // Retry calls revealAmbient with the SAME localId
        expect(revealAmbient).toHaveBeenCalledTimes(2);
        expect(revealAmbient).toHaveBeenNthCalledWith(2, 42, 'ep-uuid', 'Re-check the loop.', 'ambient', 'test-local-id');
        // Reconcile fires after the retry succeeds
        expect(deps.reconcileOptimisticBubble).toHaveBeenCalledTimes(1);
    });

    it('revealParkedHint: no-op when slot is not PARKED (prevents double-reveal)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        // Slot is FREE (default)

        await svc.revealParkedHint();

        expect(deps.revealAmbient).not.toHaveBeenCalled();
        expect(deps.postRevealBubble).not.toHaveBeenCalled();
    });

    it('revealParkedHint: no-op when exerciseId is missing', async () => {
        const deps = fakeDeps({ getExerciseId: () => undefined });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55);

        await svc.revealParkedHint();

        expect(deps.revealAmbient).not.toHaveBeenCalled();
    });

    it('applyEpisodeOutcome: calls setEpisodeOutcome on the episode-scoped endpoint (exerciseId + episodeId)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        await svc.applyEpisodeOutcome('ep-uuid', 'DISMISSED');

        expect(deps.setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-uuid', 'DISMISSED');
    });

    it('applyEpisodeOutcome: applied=false records entry in _pendingOutcomes keyed by episodeId', async () => {
        const deps = fakeDeps({ setEpisodeOutcome: vi.fn(async () => ({ applied: false })) });
        const svc = new StruggleInterventionService(deps);

        await svc.applyEpisodeOutcome('ep-uuid', 'DISMISSED');

        expect(svc._pendingOutcomes.has('ep-uuid')).toBe(true);
        expect(svc._pendingOutcomes.get('ep-uuid')).toMatchObject({ outcome: 'DISMISSED' });
    });

    it('applyEpisodeOutcome: applied=true does NOT record a pending outcome', async () => {
        const deps = fakeDeps({ setEpisodeOutcome: vi.fn(async () => ({ applied: true })) });
        const svc = new StruggleInterventionService(deps);

        await svc.applyEpisodeOutcome('ep-uuid', 'DISMISSED');

        expect(svc._pendingOutcomes.has('ep-uuid')).toBe(false);
    });

    it('I1 click trigger: revealParkedHint is a safe no-op from FREE and transitions PARKED->DELIVERED when parked (unconditional click semantics)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // FREE slot: unconditional call on click is a no-op
        await svc.revealParkedHint();
        expect(deps.revealAmbient).not.toHaveBeenCalled();
        expect(deps.postRevealBubble).not.toHaveBeenCalled();

        // PARKED slot: click trigger causes PARKED->DELIVERED reveal
        setupParked(svc, 55, 'look at this line', 'ep-c1');
        await svc.revealParkedHint();
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        expect(deps.revealAmbient).toHaveBeenCalledOnce();
        expect(deps.postRevealBubble).toHaveBeenCalledWith('look at this line', 'test-local-id');
    });

    it('I2 back-fill: dismissEpisode (terminal write) records pending outcome when setEpisodeOutcome returns applied=false', async () => {
        const setEpisodeOutcome = vi.fn(async () => ({ applied: false }));
        const deps = fakeDeps({ setEpisodeOutcome });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-bf');
        svc.onServerActive(55);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.dismissEpisode('ep-bf');

        // Settle the async outcome write
        await Promise.resolve();
        await Promise.resolve();

        // Back-fill entry recorded -- outcome NOT silently dropped
        expect(setEpisodeOutcome).toHaveBeenCalledWith(42, 'ep-bf', 'DISMISSED');
        expect(svc._pendingOutcomes.has('ep-bf')).toBe(true);
        expect(svc._pendingOutcomes.get('ep-bf')).toMatchObject({ outcome: 'DISMISSED' });
    });

    it('back-fill: reveal retry success flushes the pending outcome and clears the map entry', async () => {
        let retryFn: (() => void) | undefined;
        const revealAmbient = vi.fn()
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValue({ id: 7, sentAt: '2024-01-01T00:00:00Z', proactiveEpisodeId: 'server-ep-id' } as IrisChatMessage);
        const setEpisodeOutcome = vi.fn()
            .mockResolvedValueOnce({ applied: false })  // dismiss before row exists
            .mockResolvedValue({ applied: true });        // flush after row created
        const deps = fakeDeps({
            revealAmbient,
            setEpisodeOutcome,
            setTimeoutFn: (fn) => { retryFn = fn; },
        });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        // Reveal fails -> bubble posted, slot delivered, retry scheduled
        await svc.revealParkedHint();
        expect(deps.reconcileOptimisticBubble).not.toHaveBeenCalled();

        // Student dismisses before the row exists
        await svc.applyEpisodeOutcome('ep-uuid', 'DISMISSED');
        expect(svc._pendingOutcomes.has('ep-uuid')).toBe(true);

        // Slot freed (e.g. C3 teardown) -> map SURVIVES
        svc._slot.free();
        expect(svc._pendingOutcomes.has('ep-uuid')).toBe(true);

        // Retry fires and succeeds
        await (retryFn as () => void)();

        // Row created -> pending DISMISSED is flushed
        expect(setEpisodeOutcome).toHaveBeenCalledTimes(2);
        expect(setEpisodeOutcome).toHaveBeenLastCalledWith(42, 'ep-uuid', 'DISMISSED');
        expect(svc._pendingOutcomes.has('ep-uuid')).toBe(false);
    });

    it('back-fill: _pendingOutcomes map survives a slot free (teardown) between dismiss and retry', async () => {
        const deps = fakeDeps({ setEpisodeOutcome: vi.fn(async () => ({ applied: false })) });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'hint', 'ep-uuid');

        await svc.applyEpisodeOutcome('ep-uuid', 'ABANDONED');
        expect(svc._pendingOutcomes.has('ep-uuid')).toBe(true);

        svc._slot.free();

        // Map entry still present after slot teardown
        expect(svc._pendingOutcomes.has('ep-uuid')).toBe(true);
    });

    it('reveal retry: stops after MAX_REVEAL_RETRIES transient failures (does not loop forever)', async () => {
        const firedFns: Array<() => void> = [];
        const revealAmbient = vi.fn(async () => { throw new Error('transient'); });
        const deps = fakeDeps({
            revealAmbient,
            setTimeoutFn: (fn) => { firedFns.push(fn); },
        });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        await svc.revealParkedHint();   // attempt 0 fails, schedules attempt 1

        // Fire all 12 retries (attempts 1..12); each fires, fails, schedules the next
        for (let i = 0; i < 12; i++) {
            const fn = firedFns[i];
            expect(fn, `retry fn ${i} should have been scheduled`).toBeDefined();
            await fn();
        }

        // After MAX_REVEAL_RETRIES (12) retries the cap is hit; no 13th timer is scheduled
        expect(firedFns.length).toBe(12);                  // only 12 retries were scheduled
        expect(revealAmbient).toHaveBeenCalledTimes(13);   // initial + 12 retries
    });

    it('reveal retry: a permanent 4xx is NOT retried', async () => {
        let retryFn: (() => void) | undefined;
        const revealAmbient = vi.fn(async () => { throw new ApiError('Not found', 404); });
        const deps = fakeDeps({
            revealAmbient,
            setTimeoutFn: (fn) => { retryFn = fn; },
        });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        await svc.revealParkedHint();

        expect(revealAmbient).toHaveBeenCalledTimes(1);
        expect(retryFn).toBeUndefined();   // no retry was scheduled
    });

    it('reveal retry: resetSession cancels an in-flight retry (no further revealAmbient after reset)', async () => {
        let retryFn: (() => void) | undefined;
        const revealAmbient = vi.fn()
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValue({ id: 7, sentAt: '2024-01-01T00:00:00Z', proactiveEpisodeId: 'server-ep-id' } as IrisChatMessage);
        const deps = fakeDeps({
            revealAmbient,
            setTimeoutFn: (fn) => { retryFn = fn; },
        });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        await svc.revealParkedHint();   // fails, schedules retry
        expect(retryFn).toBeDefined();
        expect(revealAmbient).toHaveBeenCalledTimes(1);

        svc.resetSession();             // student switches exercise: increments generation

        // Fire the stale retry closure; it should bail out without calling revealAmbient again
        await (retryFn as () => void)();

        expect(revealAmbient).toHaveBeenCalledTimes(1);   // no second call
    });

    it('resetSession clears slot, frozenSessionId, and pendingOutcomes (new exercise = clean state)', async () => {
        const deps = fakeDeps({ setEpisodeOutcome: vi.fn(async () => ({ applied: false })) });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'hint', 'ep-uuid');
        await svc.applyEpisodeOutcome('ep-uuid', 'DISMISSED');

        svc.resetSession();

        expect(svc._slot.isFree()).toBe(true);
        expect(svc._frozenSessionId).toBeUndefined();
        expect(svc._pendingOutcomes.size).toBe(0);
    });

    it('onServerAmbient with sessionId stores frozenSessionId for the reveal flow', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.onServerAmbient('hint', undefined, undefined, undefined, undefined, null, 99);

        expect(svc._frozenSessionId).toBe(99);
    });
});

// ---------------------------------------------------------------------------
// C3: Slot routing (Step-1 spec tests from the task brief)
// ---------------------------------------------------------------------------

describe('StruggleInterventionService C3 slot routing', () => {
    // -------------------------------------------------------------------------
    // Canonical §1 bug: active delivered, later ambient must NOT overwrite
    // -------------------------------------------------------------------------
    it('canonical §1 bug fixed: ambient after delivered-active is suppressed (no overwrite)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // First decide: active -> takes slot as DELIVERED
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive(7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        expect(deps.postBubble).toHaveBeenCalledTimes(1);

        // Second decide: ambient -> reconcile returns suppress (DELIVERED + ambient -> suppress)
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerAmbient('New hint', undefined, undefined, undefined);
        // Slot still DELIVERED (not overwritten)
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        // Badge/lamp NOT re-fired for the ambient (it was suppressed)
        expect(deps.showLamp).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Preallocated candidate: replace-parked uses the REQUEST's candidate id
    // -------------------------------------------------------------------------
    it('PARKED ambient + different-problem ambient -> replace-parked using the preallocated candidate id', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // First decide: ambient -> FREE slot -> take-parked (candidate ep-1)
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerAmbient('First hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');
        const gen1 = svc._slot.generation();

        // Second decide: ambient -> PARKED slot -> replace-parked (candidate ep-2)
        simulateDecidePending(svc, 'ep-2', false);
        svc.onServerAmbient('Second hint', undefined, undefined, undefined);

        const snap = svc._slot.snapshot();
        expect(snap.state.kind).toBe('parked');
        // The new episode uses the preallocated candidate id (ep-2), not the old parked id (ep-1)
        expect((snap.state as Extract<SlotState, { kind: 'parked' }>).episode.episodeId).toBe('ep-2');
        expect(svc._slot.generation()).toBeGreaterThan(gen1);
    });

    it('PARKED ambient + active decide -> replace-delivered using the preallocated candidate id (no split episode)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // First decide: ambient -> FREE -> take-parked (ep-1)
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerAmbient('Hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');

        // Second decide: active -> PARKED -> replace-delivered (candidate ep-2)
        simulateDecidePending(svc, 'ep-2', false);
        svc.onServerActive(8);

        const snap = svc._slot.snapshot();
        expect(snap.state.kind).toBe('delivered');
        expect((snap.state as Extract<SlotState, { kind: 'delivered' }>).episode.episodeId).toBe('ep-2');
        // Active surface fired
        expect(deps.postBubble).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // Stale generation: inbound reply dropped when slot moved on
    // -------------------------------------------------------------------------
    it('stale-generation reply is dropped by the guard (slot moved on between POST and reply)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up an in-flight decide at generation 0
        simulateDecidePending(svc, 'ep-stale', false);
        // Bump generation by doing a fresh take (simulate reveal)
        const ep = { episodeId: 'ep-stale', isNew: false, hints: [], createdAtMs: 0 };
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'h', atSessionS: 0 });
        // Now generation is 1 but in-flight marker still has generation 0 (from simulateDecidePending)
        // The accept() check: stamp.generation(0) !== snap.generation(1) -> null -> drop
        svc.onServerAmbient('New hint', undefined, undefined, undefined);

        // Slot still in the state set by takeParked (parked, not overwritten by new ambient)
        expect(svc._slot.snapshot().state.kind).toBe('parked');
        const st = svc._slot.snapshot().state as Extract<SlotState, { kind: 'parked' }>;
        expect(st.episode.episodeId).toBe('ep-stale'); // NOT replaced
    });

    // -------------------------------------------------------------------------
    // Escalation: ambient+hardEvent required
    // -------------------------------------------------------------------------
    it('escalation: delivered-ambient + active + hardEvent -> escalate', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set slot to DELIVERED ambient (via reveal: PARKED->DELIVERED)
        const ep = { episodeId: 'ep-escl', isNew: false, hints: [], createdAtMs: 0 };
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'h', atSessionS: 0 });
        const revealHint = { level: 'ambient' as const, text: 'h', atSessionS: 0 };
        svc._slot.revealParked(revealHint);
        const genAfterReveal = svc._slot.generation();

        // Simulate an in-flight decide with hardEvent=true at the new generation
        const requestToken = 'tok-escl';
        const stamp = { episodeId: 'ep-escl', generation: genAfterReveal, hardEvent: true, requestToken };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken, episodeId: 'ep-escl', generation: genAfterReveal, intent: 'decide', localToken };
        svc._candidate = undefined;

        svc.onServerActive(9);
        // Slot escalated: still DELIVERED but level changed to active
        const snap = svc._slot.snapshot();
        expect(snap.state.kind).toBe('delivered');
        expect((snap.state as Extract<SlotState, { kind: 'delivered' }>).level).toBe('active');
        expect(deps.postBubble).toHaveBeenCalledTimes(1);
    });

    it('setInSession(true): escalation is quiet (bubble only, no toast/inline); setInSession(false): loud (toast+inline)', () => {
        // Helper to set up a DELIVERED-ambient slot and run an escalating decide
        function runEscalation(inSession: boolean): StruggleInterventionDeps {
            const deps = fakeDeps({ isAnchorLive: () => true });
            const svc = new StruggleInterventionService(deps);

            // Set slot to DELIVERED ambient (parked then revealed)
            const ep = { episodeId: 'ep-esc', isNew: false, hints: [], createdAtMs: 0 };
            svc._slot.takeParked(0, ep, { level: 'ambient', text: 'h', atSessionS: 0 });
            svc._slot.revealParked({ level: 'ambient', text: 'h', atSessionS: 0 });
            const gen = svc._slot.generation();

            // Toggle in-session BEFORE the decide reply
            svc.setInSession(inSession);
            expect(svc._slot.snapshot().inSession).toBe(inSession);

            // Simulate a hardEvent decide
            const tok = `tok-esc-${inSession}`;
            const stamp = { episodeId: 'ep-esc', generation: gen, hardEvent: true, requestToken: tok };
            const localToken = svc._guard.issue('decide', stamp);
            svc._inFlightMarker = { requestToken: tok, episodeId: 'ep-esc', generation: gen, intent: 'decide', localToken };

            svc.onServerActive(9, 'src/A.java', 10, 'tip', 0.9, 'Hint text');
            return deps;
        }

        // In-session: bubble only, no notification or inline push
        const inSessionDeps = runEscalation(true);
        expect(inSessionDeps.postBubble).toHaveBeenCalledTimes(1);
        expect(inSessionDeps.showActiveNotification).not.toHaveBeenCalled();
        expect(inSessionDeps.showInline).not.toHaveBeenCalled();

        // Out-of-session (default): bubble + notification + inline
        const outSessionDeps = runEscalation(false);
        expect(outSessionDeps.postBubble).toHaveBeenCalledTimes(1);
        expect(outSessionDeps.showActiveNotification).toHaveBeenCalledTimes(1);
        expect(outSessionDeps.showInline).toHaveBeenCalledTimes(1);
    });

    it('escalation gated by hardEvent: delivered-ambient + active WITHOUT hardEvent -> suppress', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set slot to DELIVERED ambient
        const ep = { episodeId: 'ep-soft', isNew: false, hints: [], createdAtMs: 0 };
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'h', atSessionS: 0 });
        svc._slot.revealParked({ level: 'ambient', text: 'h', atSessionS: 0 });
        const genAfterReveal = svc._slot.generation();

        const requestToken = 'tok-soft';
        const stamp = { episodeId: 'ep-soft', generation: genAfterReveal, hardEvent: false, requestToken };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken, episodeId: 'ep-soft', generation: genAfterReveal, intent: 'decide', localToken };

        svc.onServerActive(9);
        // No escalation, slot stays at ambient level
        expect((svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).level).toBe('ambient');
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // isNew flip on first accepted request
    // -------------------------------------------------------------------------
    it('isNew=true on first POST; flips to false on the next POST to the same episode (after first accepted)', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.5, s: 0.5, v: 0.5, fastDecay: false, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });

        // First decide: FREE slot, preallocates a candidate, isNew=true
        svc.deliver({ kind: 'edit', t: 530, ts: 530000, urgency: 0.72, v: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);
        const firstBody = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(firstBody.episode.isNew).toBe(true);
        const episodeId = firstBody.episode.episodeId;

        // Server replies: active -> DELIVERED. The episode is now in _continuedEpisodeIds.
        svc.onServerActive(7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        postSpy.mockClear();

        // Second decide from the DELIVERED slot: same episodeId, isNew MUST be false now.
        svc.deliver({ kind: 'edit', t: 540, ts: 540000, urgency: 0.72, v: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);
        const secondBody = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(secondBody.episode.episodeId).toBe(episodeId); // same episode
        expect(secondBody.episode.isNew).toBe(false);         // flipped after first accepted POST
    });

    it('FREE-slot decide carries preallocated candidate (non-null episode, isNew=true); silent discards it', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // Deliver an alert -> will POST with a preallocated episode
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.5, s: 0.5, v: 0.5, fastDecay: false, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });
        svc.deliver({ kind: 'edit', t: 530, ts: 530000, urgency: 0.72, v: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
        await new Promise(r => setTimeout(r, 0));

        const body = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(body.intent).toBe('decide');
        expect(typeof body.episode.episodeId).toBe('string');
        expect(body.episode.episodeId.length).toBeGreaterThan(0);
        expect(body.episode.isNew).toBe(true);
        expect(body.episode.hints).toEqual([]);
        expect(typeof body.requestToken).toBe('string');

        // Receive 'silent' -> candidate discarded, slot stays FREE
        svc.onServerSilent(svc._inFlightMarker!.episodeId, undefined);
        expect(svc._slot.isFree()).toBe(true);
    });

    it('FREE-slot decide + ambient response -> candidate becomes the live PARKED episode', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.5, s: 0.5, v: 0.5, fastDecay: false, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });
        svc.deliver({ kind: 'edit', t: 530, ts: 530000, urgency: 0.72, v: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
        await new Promise(r => setTimeout(r, 0));

        const sentEpisodeId = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1].episode.episodeId;
        // Receive ambient -> candidate takes the slot
        svc.onServerAmbient('Hint text', undefined, undefined, undefined);
        const snap = svc._slot.snapshot();
        expect(snap.state.kind).toBe('parked');
        // The episodeId in the slot matches what was sent in the request
        const parked = snap.state as Extract<SlotState, { kind: 'parked' }>;
        expect(parked.episode.episodeId).toBe(sentEpisodeId);
    });

    // -------------------------------------------------------------------------
    // Progress confirmClose: DELIVERED -> progress, PARKED -> parked_progress
    // -------------------------------------------------------------------------
    it('newGreenTest while DELIVERED -> confirmClose POSTed with confirmReason=progress exactly once', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot + lastSignal
        simulateDecidePending(svc, 'ep-del', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 530 };
        svc.onServerActive(7);
        await new Promise(r => setTimeout(r, 0));

        // The decide POST was first call; clear it from spy for clarity
        postSpy.mockClear();

        // Green test: newGreenTest -> latch fires -> owed confirmClose
        svc.onNewBuildResult(true);
        // Latch should have fired (state = pending-post); drain owed
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);
        const confirmBody = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(confirmBody.intent).toBe('confirm_close');
        expect(confirmBody.confirmReason).toBe('progress');

        // Second green test before reply: no double-fire (latch in candidate-close)
        postSpy.mockClear();
        svc.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(0);
    });

    // -------------------------------------------------------------------------
    // Owed confirmClose: not lost while wire is busy with a decide
    // -------------------------------------------------------------------------
    it('owed confirmClose set while decide is in flight is NOT lost: POSTs when wire frees', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot with lastSignal
        simulateDecidePending(svc, 'ep-del', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 530 };
        svc.onServerActive(7);
        // Slot is DELIVERED, wire is free now; set up an artificial busy wire
        postSpy.mockClear();

        // Simulate wire busy with a decide
        const fakeToken = 'busy-tok';
        const stamp = { episodeId: 'ep-del', generation: svc._slot.generation(), hardEvent: false, requestToken: fakeToken };
        const lt = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: fakeToken, episodeId: 'ep-del', generation: svc._slot.generation(), intent: 'decide', localToken: lt };

        // Green test fires -> latch -> owed confirmClose queued (wire busy)
        svc.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).not.toHaveBeenCalled(); // wire was busy
        expect(svc._owedConfirmClose).toEqual({ confirmReason: 'progress' });

        // Wire frees (decide reply clears marker)
        svc._inFlightMarker = undefined;
        // Next drain: owed confirmClose should POST
        await svc['_drainOwed']();
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect((postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1].intent).toBe('confirm_close');
    });

    // -------------------------------------------------------------------------
    // PARKED confirmClose-reply (required test)
    // -------------------------------------------------------------------------
    it('PARKED: newGreenTest issues confirmClose with parked_progress; resolved=true frees silently (no fold, no outcome)', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // Set up PARKED slot + lastSignal
        simulateDecidePending(svc, 'ep-pcc', false);
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 100 };
        svc.onServerAmbient('Hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');
        postSpy.mockClear();

        // New green test while PARKED -> parked_progress confirmClose
        svc.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);
        const body = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(body.intent).toBe('confirm_close');
        expect(body.confirmReason).toBe('parked_progress');

        // Reply resolved=true: slot frees silently (no fold, no outcome)
        svc.onServerClose(svc._inFlightMarker!.episodeId, true, undefined, undefined, undefined);
        expect(svc._slot.isFree()).toBe(true);
        expect(deps.foldEpisode).not.toHaveBeenCalled();
        expect(deps.setEpisodeOutcome).not.toHaveBeenCalled();
    });

    it('PARKED: confirmClose resolved=false -> slot stays PARKED, fresh edge required to re-arm latch', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // Set up PARKED slot + lastSignal
        simulateDecidePending(svc, 'ep-pcc2', false);
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 100 };
        svc.onServerAmbient('Hint', undefined, undefined, undefined);
        postSpy.mockClear();

        // Trigger parked_progress confirmClose
        svc.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);

        // Reply resolved=false: slot stays PARKED, no fold
        svc.onServerClose(svc._inFlightMarker!.episodeId, false, undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');
        expect(deps.foldEpisode).not.toHaveBeenCalled();
        // Latch re-opened (back to 'open', _armed=false): a second green test fires but sBase
        // path requires a rise then re-drop before it can re-arm (spec §7.3).
        postSpy.mockClear();
        svc.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        // latch state was 'candidate-close' after onPosted; onConfirmResult(false) sets it back to 'open'.
        // A fresh newGreenTest fires a new pending-post -> parked_progress owed again.
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect((postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1].confirmReason).toBe('parked_progress');
    });

    // -------------------------------------------------------------------------
    // Scoped cancel: terminal via _clearEpisodeRuntime uses the LIVE in-flight token
    // -------------------------------------------------------------------------
    it('scoped-cancel: terminal via _clearEpisodeRuntime cancels with the LIVE in-flight token', () => {
        const cancelSpy = vi.fn(async () => undefined);
        const deps = fakeDeps({ cancelOutstandingStruggleJob: cancelSpy });
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot
        simulateDecidePending(svc, 'ep-sc', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 530 };
        svc.onServerActive(7); // wire cleared by _acceptDecide

        // A fresh request B is now in flight (e.g. a queued confirmClose)
        const tokenB = 'token-B';
        const ep = (svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).episode;
        const stamp = { episodeId: ep.episodeId, generation: svc._slot.generation(), hardEvent: false, requestToken: tokenB };
        const lt = svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken: tokenB, episodeId: ep.episodeId, generation: svc._slot.generation(), intent: 'confirm_close', localToken: lt };

        // resetSession is a terminal: calls _slot.free() + _clearEpisodeRuntime
        svc.resetSession();

        // The live B token was cancelled, not some stale one
        expect(cancelSpy).toHaveBeenCalledWith(42, tokenB);
        expect(cancelSpy).toHaveBeenCalledTimes(1);
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('replace-parked does NOT cancel: the in-flight decide is completing into the replacement', () => {
        const cancelSpy = vi.fn(async () => undefined);
        const deps = fakeDeps({ cancelOutstandingStruggleJob: cancelSpy });
        const svc = new StruggleInterventionService(deps);

        // First decide: FREE -> ambient -> PARKED
        simulateDecidePending(svc, 'ep-r1', false);
        svc.onServerAmbient('First hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');

        // Second decide in-flight (for replace-parked)
        simulateDecidePending(svc, 'ep-r2', false);

        // Reply: ambient on PARKED -> replace-parked (non-terminal, does NOT call _clearEpisodeRuntime)
        svc.onServerAmbient('Second hint', undefined, undefined, undefined);

        // No cancel (replace is non-terminal)
        expect(cancelSpy).not.toHaveBeenCalled();
        expect(svc._slot.snapshot().state.kind).toBe('parked');
    });

    // -------------------------------------------------------------------------
    // revealParkedHint: scoped cancel + re-owe under DELIVERED semantics
    // -------------------------------------------------------------------------
    it('reveal: scoped-cancels in-flight parked_progress confirmClose + re-owes as DELIVERED progress', async () => {
        const cancelSpy = vi.fn(async () => undefined);
        const deps = fakeDeps({ cancelOutstandingStruggleJob: cancelSpy });
        const svc = new StruggleInterventionService(deps);

        // Set up PARKED slot
        const ep = newEpisode(0, () => 'ep-rev');
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'STATE', boundaryTypes: ['STATE'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 100 };

        // Simulate an in-flight parked_progress confirmClose
        const reqToken = 'parked-tok';
        const stamp = { episodeId: 'ep-rev', generation: svc._slot.generation(), hardEvent: false, requestToken: reqToken };
        const lt = svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken: reqToken, episodeId: 'ep-rev', generation: svc._slot.generation(), intent: 'confirm_close', localToken: lt };

        // Reveal: should scoped-cancel the in-flight, re-owe as DELIVERED progress
        await svc.revealParkedHint();

        // Scoped cancel was called with the parked_progress token
        expect(cancelSpy).toHaveBeenCalledWith(42, reqToken);
        // Wire is now free (in-flight marker cleared)
        expect(svc._inFlightMarker).toBeUndefined();
        // Owed confirmClose re-issued as progress (DELIVERED)
        expect(svc._owedConfirmClose).toEqual({ confirmReason: 'progress' });
        // Slot transitioned to DELIVERED
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
    });

    it('reveal: wire re-opens so a subsequent request B (fresh token) is never hit by the cancel', async () => {
        const cancelSpy = vi.fn(async () => undefined);
        const deps = fakeDeps({ cancelOutstandingStruggleJob: cancelSpy });
        const svc = new StruggleInterventionService(deps);

        const ep = newEpisode(0, () => 'ep-rev2');
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'STATE', boundaryTypes: ['STATE'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 100 };

        const tokenA = 'token-A';
        const stampA = { episodeId: 'ep-rev2', generation: svc._slot.generation(), hardEvent: false, requestToken: tokenA };
        const ltA = svc._guard.issue('decide', stampA);
        svc._inFlightMarker = { requestToken: tokenA, episodeId: 'ep-rev2', generation: svc._slot.generation(), intent: 'decide', localToken: ltA };

        await svc.revealParkedHint();

        // Cancel was called with tokenA
        expect(cancelSpy).toHaveBeenCalledWith(42, tokenA);
        // Wire is free (tokenA cleared)
        expect(svc._inFlightMarker).toBeUndefined();
        // Only tokenA was cancelled; if a new tokenB were issued now, it would not be hit
        expect(cancelSpy).toHaveBeenCalledTimes(1); // no extra cancel calls
    });

    // -------------------------------------------------------------------------
    // clearEpisodeRuntime: comprehensive teardown
    // -------------------------------------------------------------------------
    it('clearEpisodeRuntime teardown: latch reset, watchdog disarmed, owed cleared, ask-binding cleared', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up some state
        simulateDecidePending(svc, 'ep-tear', false);
        svc._owedConfirmClose = { confirmReason: 'progress' };
        svc._owedStaleCheck = true;
        svc._liveAskBinding = { askId: 'ask-1', messageId: 42, episodeId: 'ep-tear' };
        // Arm watchdog
        svc._watchdog = new StaleWatchdog({ staleAfterMs: 45_000, staleWindowMax: 4, staleAskCap: 2 });
        svc._watchdog!.arm(Date.now(), false);

        // Free the slot to trigger clearEpisodeRuntime
        svc._slot.takeParked(0, { episodeId: 'ep-tear', isNew: false, hints: [], createdAtMs: 0 }, { level: 'ambient', text: 'h', atSessionS: 0 });
        svc._slot.free();
        svc['_clearEpisodeRuntime']();

        expect(svc._owedConfirmClose).toBeUndefined();
        expect(svc._owedStaleCheck).toBe(false);
        expect(svc._liveAskBinding).toBeUndefined();
        expect(svc._inFlightMarker).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // foldEpisode: DELIVERED terminals emit fold; PARKED terminals do not
    // -------------------------------------------------------------------------
    it('foldEpisode emitted on DELIVERED terminal (onServerClose resolved=true)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot
        simulateDecidePending(svc, 'ep-fold', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 530 };
        svc.onServerActive(7);
        const episodeId = (svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).episode.episodeId;

        // Simulate a confirmClose response: resolved=true -> free + foldEpisode
        // Set up a fake in-flight confirmClose marker
        const tok = 'fold-tok';
        const stamp = { episodeId, generation: svc._slot.generation(), hardEvent: false, requestToken: tok };
        svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken: tok, episodeId, generation: svc._slot.generation(), intent: 'confirm_close', localToken: 999 };
        svc.onServerClose(episodeId, true, undefined, undefined, undefined);

        expect(svc._slot.isFree()).toBe(true);
        expect(deps.foldEpisode).toHaveBeenCalledWith(episodeId, 'RECOVERED', undefined);
    });

    it('foldEpisode NOT emitted for PARKED terminal (silent discard, no visible artifact)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up PARKED slot
        simulateDecidePending(svc, 'ep-parked', false);
        svc.onServerAmbient('h', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');

        // Silent response -> discard-free
        simulateDecidePending(svc, 'ep-discard', false);
        svc.onServerSilent('ep-discard', undefined);
        expect(svc._slot.isFree()).toBe(true);
        expect(deps.foldEpisode).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Window count is wire-independent (§13 force-free bound)
    // -------------------------------------------------------------------------
    it('watchdog window increments on every tick fire (wire-independent): force-free fires after staleWindowMax', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot
        simulateDecidePending(svc, 'ep-wdog', false);
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 100 };
        svc.onServerActive(7);

        // Set up a watchdog with staleWindowMax=2 and staleAfterMs=0 (fires immediately)
        svc._watchdog = new StaleWatchdog({ staleAfterMs: 0, staleWindowMax: 2, staleAskCap: 0 });
        svc._watchdog!.arm(Date.now() - 1000, false);

        // Tick 1: fires -> windowCount=1 (< max=2), _owedStaleCheck not set (canPostAsk=false, cap=0)
        svc['_handleWatchdogTick'](Date.now());
        expect(svc._slot.snapshot().state.kind).toBe('delivered'); // not yet freed
        expect(svc._watchdog?.windowCount()).toBe(1);

        // Tick 2: fires -> windowCount=2 (>= max=2), force-free
        svc._watchdog!.arm(Date.now() - 1000, false); // re-arm clock so it fires again
        svc['_handleWatchdogTick'](Date.now());
        expect(svc._slot.isFree()).toBe(true);
        expect(deps.foldEpisode).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // watchdog.resetProgress: defers stale fire on hard progress
    // -------------------------------------------------------------------------
    it('onNewBuildResult(true) calls watchdog.resetProgress (defers next stale fire)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot + watchdog
        simulateDecidePending(svc, 'ep-wp', false);
        svc.onServerActive(7);
        expect(svc._watchdog).toBeDefined();
        const resetSpy = vi.spyOn(svc._watchdog!, 'resetProgress');

        svc.onNewBuildResult(true);

        expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    it('tick with sBase below reArmSBase calls watchdog.resetProgress (sustained sBase drop)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot + watchdog
        simulateDecidePending(svc, 'ep-wp2', false);
        svc.onServerActive(7);
        expect(svc._watchdog).toBeDefined();
        const resetSpy = vi.spyOn(svc._watchdog!, 'resetProgress');

        // DEFAULT_PROGRESS_CFG.reArmSBase = 0.6; feed sBase = 0.3 (below threshold)
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.3, s: 0.3, v: 0.5, fastDecay: false, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });

        expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    it('tick with sBase above reArmSBase does NOT call watchdog.resetProgress (no reset on high stress)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-wp3', false);
        svc.onServerActive(7);
        expect(svc._watchdog).toBeDefined();
        const resetSpy = vi.spyOn(svc._watchdog!, 'resetProgress');

        // sBase = 0.8 (above reArmSBase threshold of 0.6)
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.8, s: 0.8, v: 0.8, fastDecay: false, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });

        expect(resetSpy).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Coalescing: stale_solved supersedes progress when both owed
    // -------------------------------------------------------------------------
    it('coalescing: solved-click over an owed progress close -> ONE POST with stale_solved, latch.onPosted() called', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot + lastSignal
        simulateDecidePending(svc, 'ep-coal', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 530 };
        svc.onServerActive(7);
        postSpy.mockClear();

        // Busy the wire so the progress owed is queued (not yet posted)
        const fakeToken = 'busy-tok';
        const ep = (svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).episode;
        const fakeStamp = { episodeId: ep.episodeId, generation: svc._slot.generation(), hardEvent: false, requestToken: fakeToken };
        const lt = svc._guard.issue('decide', fakeStamp);
        svc._inFlightMarker = { requestToken: fakeToken, episodeId: ep.episodeId, generation: svc._slot.generation(), intent: 'decide', localToken: lt };

        // Drive progress owed through the REAL code path (onNewBuildResult -> latch -> _propagateLatchToOwed)
        svc.onNewBuildResult(true);
        expect(svc._owedConfirmClose).toEqual({ confirmReason: 'progress' });
        expect(postSpy).not.toHaveBeenCalled(); // wire still busy

        // Solved-click arrives (C8 stub) -> supersedes the owed progress close with stale_solved
        svc.recordSolvedClick();
        expect(svc._owedConfirmClose).toEqual({ confirmReason: 'stale_solved' });

        // Wire frees; spy on latch.onPosted before drain
        svc._inFlightMarker = undefined;
        const latchPostSpy = vi.spyOn(svc._latch, 'onPosted');

        // Drain: exactly ONE POST with stale_solved
        await svc['_drainOwed']();
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect((postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1].confirmReason).toBe('stale_solved');
        // Owed entry consumed
        expect(svc._owedConfirmClose).toBeUndefined();
        // latch.onPosted() was called on successful drain
        expect(latchPostSpy).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // Solved while confirmClose in flight: queue + drain correctly
    // -------------------------------------------------------------------------
    it('solved click while confirmClose in flight: queued as stale_solved; drains if resolved=false', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // DELIVERED slot with lastSignal
        simulateDecidePending(svc, 'ep-sol', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 530 };
        svc.onServerActive(7);
        postSpy.mockClear();

        // Simulate a confirmClose in flight
        const ep = (svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).episode;
        const tok = 'close-tok';
        const stamp = { episodeId: ep.episodeId, generation: svc._slot.generation(), hardEvent: false, requestToken: tok };
        svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken: tok, episodeId: ep.episodeId, generation: svc._slot.generation(), intent: 'confirm_close', localToken: 99 };

        // 'solved' click arrives while in-flight -> queue as stale_solved
        svc._owedConfirmClose = { confirmReason: 'stale_solved' };

        // Reply: resolved=false -> latch re-arms, slot stays; owed stale_solved should post next
        svc.onServerClose(ep.episodeId, false, undefined, undefined, undefined);

        // _drainOwed is called by onServerClose -> wait for it
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect((postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1].confirmReason).toBe('stale_solved');
    });

    it('solved click while confirmClose in flight: if resolved=true slot frees and queued entry is cleared (one CLOSE total)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-sol2', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], dominantComponents: [], sessionSeconds: 530 };
        svc.onServerActive(7);

        const ep = (svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).episode;
        const tok = 'close-tok2';
        const stamp = { episodeId: ep.episodeId, generation: svc._slot.generation(), hardEvent: false, requestToken: tok };
        svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken: tok, episodeId: ep.episodeId, generation: svc._slot.generation(), intent: 'confirm_close', localToken: 100 };

        // Queue a stale_solved
        svc._owedConfirmClose = { confirmReason: 'stale_solved' };

        // Reply: resolved=true -> slot frees, queued entry cleared
        svc.onServerClose(ep.episodeId, true, undefined, undefined, undefined);

        expect(svc._slot.isFree()).toBe(true);
        expect(svc._owedConfirmClose).toBeUndefined(); // cleared by slot-free
        // Only one close applied (the in-flight one)
    });
});
