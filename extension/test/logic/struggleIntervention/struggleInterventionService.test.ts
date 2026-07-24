import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@extension/domain';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import { newEpisode } from '@extension/services/struggleIntervention/slot/episode';
import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import type { SlotState } from '@extension/services/struggleIntervention/slot/slotManager';
import { StaleWatchdog } from '@extension/services/struggleIntervention/slot/staleWatchdog';
import type { StruggleEgressResult, StruggleInterventionRequest } from '@extension/services/struggleIntervention/struggleContract';
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
    svc._candidate = { episodeId, hints: [], createdAtMs: 0 };
}

function fakeDeps(over: Partial<StruggleInterventionDeps> = {}): StruggleInterventionDeps {
    return {
        isIrisEnabled: () => true,
        isEgressEnabled: () => true,
        hasNoaiMarker: () => false,
        getExerciseId: () => 42,
        getExerciseRoot: () => undefined,
        collectFiles: vi.fn(async () => ({ 'src/A.java': 'class A {}' })),
        readFileContent: vi.fn(() => undefined),
        postIntervention: vi.fn(async () => 'accepted' as const),
        openSession: vi.fn(async () => undefined),
        showLamp: vi.fn(),
        clearLamp: vi.fn(),
        showActiveJump: vi.fn(),
        clearEpisodeLamp: vi.fn(),
        showInline: vi.fn(),
        showGutterOnly: vi.fn(),
        clearInline: vi.fn(),
        isStudentProactiveOn: () => true,
        getProactiveLevel: () => 'more',
        setBadge: vi.fn(),
        showActiveBanner: vi.fn(),
        hideActiveBanner: vi.fn(),
        postOfferBubble: vi.fn(),
        resolveOfferBubble: vi.fn(),
        showOfferBanner: vi.fn(),
        postBubble: vi.fn(),
        setChatLiveEpisode: vi.fn(),
        log: { record: vi.fn(async () => undefined) } as unknown as StruggleInterventionDeps['log'],
        setTimeoutFn: () => { /* never auto-clear in-flight in tests */ },
        // C2 reveal deps
        generateLocalId: () => 'test-local-id',
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        // #364: reveal-into-exercise navigation. Behavior-preserving defaults (valid target, stable
        // nav token, navigation succeeds) so existing reveal tests never abort through the new guard.
        // Spies so tests can assert call order / not-called.
        resolveRevealTarget: vi.fn(() => ({ courseId: 100, title: 'Fake Exercise' })),
        currentNavToken: vi.fn(() => 1),
        openRevealSession: vi.fn(async () => true),
        notifyRevealUnavailable: vi.fn(),
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
        ...over,
    };
}
function alert(): AlertRecord {
    return { kind: 'edit', t: 530, ts: 530000, urgency: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false };
}
function discreteAlert(): AlertRecord {
    return { kind: 'discrete', t: 530, ts: 530000, urgency: 0.72, trigger: 'test-stagnation', inWarmup: false };
}
function tick(t: number): TickRecord {
    return { t, ts: t * 1000, features: {} as TickRecord['features'], sBase: 0.5, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace };
}

describe('StruggleInterventionService', () => {
    it('discrete (test-stagnation) alert POSTs a decide with the TPS wire signal', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(discreteAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        const [exId, body] = (deps.postIntervention as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(exId).toBe(42);
        expect(body.intent).toBe('decide');
        expect(body.struggleSignal.alert.primaryBoundary).toBe('TPS');
        expect(body.struggleSignal.alert.boundaryTypes).toEqual(['TPS']);
        expect(body.struggleSignal.alert.path).toBe('discrete');
    });

    it('shouldSuppress (BackoffSource): discrete passes by default, both kinds suppressed on student-opt-out', () => {
        // This is what BackoffGate consults ABOVE the throttle, so a suppressed alert never burns delivery budget.
        expect(new StruggleInterventionService(fakeDeps()).shouldSuppress(discreteAlert())).toBe(false);                            // TPS intervenes now
        expect(new StruggleInterventionService(fakeDeps({ isStudentProactiveOn: () => false })).shouldSuppress(discreteAlert())).toBe(true); // opted out (discrete)
        expect(new StruggleInterventionService(fakeDeps({ isStudentProactiveOn: () => false })).shouldSuppress(alert())).toBe(true); // opted out (edit)
        expect(new StruggleInterventionService(fakeDeps()).shouldSuppress(alert())).toBe(false);                                   // normal edit alert passes
        // (course-off only latches after a POST → covered by the course-off latch test.)
    });

    it('suppresses every alert (no POST, no surface) while Iris is not enabled', async () => {
        const deps = fakeDeps({ isIrisEnabled: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(discreteAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.showLamp).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
    });

    it('proceeds to POST when Iris is enabled and egress is opted in', async () => {
        const deps = fakeDeps({ isIrisEnabled: () => true, isEgressEnabled: () => true });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(discreteAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalled();
    });

    it('ends an alert silently (no surface, logged) when egress is not opted in', async () => {
        const deps = fakeDeps({ isEgressEnabled: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(discreteAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.log.record).toHaveBeenCalledWith(
            expect.objectContaining({ finalAction: 'silent', surface: 'none', source: 'local' }),
        );
    });

    it('not opted in → ends silently (no surface, logged), never POSTs', async () => {
        const deps = fakeDeps({ isEgressEnabled: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await Promise.resolve();
        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.log.record).toHaveBeenCalledWith(
            expect.objectContaining({ finalAction: 'silent', surface: 'none', source: 'local' }),
        );
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

    it('decide POST carries proactivityMode mapped from the exercise level (less -> pull, more -> push)', async () => {
        const more = fakeDeps({ getProactiveLevel: () => 'more' });
        const svcMore = new StruggleInterventionService(more);
        svcMore.onTick(tick(530));
        svcMore.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        const bodyMore = (more.postIntervention as ReturnType<typeof vi.fn>).mock.calls[0][1] as StruggleInterventionRequest;
        expect(bodyMore.proactivityMode).toBe('push');

        const less = fakeDeps({ getProactiveLevel: () => 'less' });
        const svcLess = new StruggleInterventionService(less);
        svcLess.onTick(tick(530));
        svcLess.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        const bodyLess = (less.postIntervention as ReturnType<typeof vi.fn>).mock.calls[0][1] as StruggleInterventionRequest;
        expect(bodyLess.proactivityMode).toBe('pull');
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

    it('.noai marker → ends silently, never POSTs (spec §9)', async () => {
        const deps = fakeDeps({ hasNoaiMarker: () => true });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await Promise.resolve();
        expect(deps.postIntervention).not.toHaveBeenCalled();
        expect(deps.log.record).toHaveBeenCalledWith(
            expect.objectContaining({ finalAction: 'silent', surface: 'none', source: 'local' }),
        );
    });

    it('server 404 → subsequent alerts end silently (logged) without POSTing again (spec §9/§11)', async () => {
        const deps = fakeDeps({ postIntervention: vi.fn(async () => 'unavailable' as const) });
        const svc = new StruggleInterventionService(deps);
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        expect(deps.log.record).toHaveBeenCalledWith(
            expect.objectContaining({ finalAction: 'silent', surface: 'none', source: 'local' }),
        );
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
        svc.deliver(alert());                                // in-flight was released → this one POSTs again
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(2);
    });

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

    it('a 404 server-unavailable latch survives reset() (surface clear) and clears only on resetSession() (new exercise)', async () => {
        const svc = new StruggleInterventionService(fakeDeps({ postIntervention: vi.fn(async () => 'unavailable' as const) }));
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(svc.getProactiveGateState().serverUnavailable).toBe(true);
        svc.reset();
        expect(svc.getProactiveGateState().serverUnavailable).toBe(true);   // surface clear KEEPS the per-session 404 latch
        svc.resetSession();
        expect(svc.getProactiveGateState()).toEqual({ consentMissing: false, serverUnavailable: false });  // a new exercise re-probes
    });

    it('course-off latches (survives the in-flight watchdog + a surface-clear reset): no re-POST until resetSession (spec §13)', async () => {
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

        // The watchdog fires: without the latch this would un-wedge the session and let the next alert POST again.
        fireInflightWatchdog?.();
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(post).toHaveBeenCalledTimes(1);             // latched, not merely in-flight

        svc.reset();                                       // surface clear must NOT lift the per-session latch
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
    });

    it('inbound ambient/active are dropped when the student turned proactive off (mid-flight opt-out)', () => {
        const deps = fakeDeps({ isStudentProactiveOn: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onServerAmbient('ep-x', 'hint', undefined, undefined, undefined);
        svc.onServerActive('ep-x', 99);
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
    });

    it('consent-guard drop (mid-flight revoke) retires the persisted row for ambient AND active (#349 wave 3)', () => {
        // Correlated in-flight marker so the frame passes the correlation guard and lands on the
        // consent guard specifically (not the wave-2 uncorrelated-drop retirement).
        const deps = fakeDeps({ isEgressEnabled: () => false });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-x');
        svc.onServerAmbient('ep-x', 'hint', undefined, undefined, undefined, undefined, 71);
        expect(deps.postRemoveMessage).toHaveBeenCalledWith(71);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 71);
        expect(deps.showInline).not.toHaveBeenCalled();
        // The guard's pre-existing marker handling is unchanged: _clearInFlight releases it.
        expect(svc._inFlightMarker).toBeUndefined();

        const deps2 = fakeDeps({ isEgressEnabled: () => false });
        const svc2 = new StruggleInterventionService(deps2);
        simulateDecidePending(svc2, 'ep-y');
        svc2.onServerActive('ep-y', 99, undefined, undefined, undefined, undefined, undefined, 72);
        expect(deps2.postRemoveMessage).toHaveBeenCalledWith(72);
        expect(deps2.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 72);
        expect(deps2.showActiveBanner).not.toHaveBeenCalled();
        expect(deps2.postBubble).not.toHaveBeenCalled();
        expect(svc2._inFlightMarker).toBeUndefined();
    });

    it('student-opt-out drop retires the persisted row for ambient AND active (#349 wave 3)', () => {
        const deps = fakeDeps({ isStudentProactiveOn: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onServerAmbient('ep-x', 'hint', undefined, undefined, undefined, undefined, 81);
        svc.onServerActive('ep-x', 99, undefined, undefined, undefined, undefined, undefined, 82);
        expect(deps.postRemoveMessage).toHaveBeenCalledWith(81);
        expect(deps.postRemoveMessage).toHaveBeenCalledWith(82);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 81);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 82);
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
    });

    it('setStudentProactive(active exercise, false) clears a standing inline cue + lamp + badge + banner', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.setStudentProactive(42, false);   // 42 is fakeDeps' active exercise
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(false);
        expect(deps.hideActiveBanner).toHaveBeenCalled();
    });

    it('setStudentProactive(false) from a NON-active exercise STILL clears the active exercise surfaces (#341 global Off)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.setStudentProactive(999, false);   // active is 42; a global Off clears regardless of source
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(false);
        expect(deps.hideActiveBanner).toHaveBeenCalled();
    });

    // C1/C3: ambient = PARKED pointer only (badge + lamp always; gutter icon if anchor live). No inline text, no banner.
    // Note: C3 routes onServerAmbient through the slot guard; tests use simulateDecidePending to set up the in-flight state.
    it('inbound ambient event (no anchor) → badge + lamp (PARKED pointer); no inline', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('ep-test', 'Re-check the logic.', undefined, undefined, undefined);
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        // Slot is now PARKED
        expect(svc._slot.snapshot().state.kind).toBe('parked');
    });

    it('inbound ambient event WITH an anchor → badge + lamp + gutter icon armed; no inline text (spec §5 pull model)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('ep-test', 'Re-check the logic.', 'src/A.java', 42, 'off-by-one?');
        // The gutter cue is armed unconditionally: the decoration renders it once the file is visible.
        expect(deps.showGutterOnly).toHaveBeenCalledWith('src/A.java', 42);
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        // Ambient must NOT render the inline after-line text or banner or bubble:
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
    });

    it('inbound ambient event WITHOUT an anchor → badge + lamp only; clears any stale inline cue', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('ep-test', 'Re-check the logic.', undefined, undefined, undefined);
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.clearInline).toHaveBeenCalled();   // clears any stale cue from a previous active
        expect(deps.showGutterOnly).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
    });

    // C3: active now routes through the slot guard; use simulateDecidePending for test setup.
    // The old 3/session cap is replaced by the slot (only one episode at a time). Only the first active
    // surface per episode is delivered; subsequent decides from a DELIVERED slot are suppressed unless
    // the slot is an escalation candidate (ambient+hardEvent).
    it('inbound active event (FREE slot) → opens session + badge + banner + inline if anchor live', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        expect(deps.clearInline).toHaveBeenCalled();   // active clears any stale inline cue
        expect(deps.openSession).toHaveBeenCalledWith(7);
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showActiveBanner).toHaveBeenCalledWith('ep-1');
        // Slot is now DELIVERED
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
    });

    it('active delivery suppresses the banner when the chat is already open (in-session); the bubble still posts', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc._slot.setInSession(true);                              // chat view open
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        expect(deps.postBubble).toHaveBeenCalled();                // bubble still lands in the open chat
        expect(deps.showActiveBanner).not.toHaveBeenCalled();      // ...but no redundant banner
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
    });

    it('second active decide on an already-DELIVERED slot is suppressed by the slot (C3 blind-overwrite fix)', () => {
        // First active takes the slot (DELIVERED). A second decide from a different alert
        // returns 'suppress' (DELIVERED + active without hardEvent). The slot stays DELIVERED.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        expect(deps.openSession).toHaveBeenCalledTimes(1);

        // Simulate a second decide arriving (non-hard boundary -> no escalation)
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        expect(deps.openSession).toHaveBeenCalledTimes(1); // still 1, not 2 -- slot prevents overwrite
    });

    it('slot freed on resetSession() -> next active re-opens (new exercise)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.reset();                       // reset() (surface clear) does NOT free the slot
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        svc.resetSession();                // new exercise frees the slot
        expect(svc._slot.isFree()).toBe(true);

        // After resetSession a new active takes the slot again
        simulateDecidePending(svc, 'ep-2', false);
        svc.onServerActive('ep-2', 7);
        expect(deps.openSession).toHaveBeenCalledTimes(2);
    });

    it('inbound active event with an anchor ALSO arms the inline breadcrumb (spec §6.1)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 8, 'src/B.java', 84, 'check punctuation', 0.9);
        // the bubble still opens (active surface)...
        expect(deps.openSession).toHaveBeenCalledWith(8);
        expect(deps.showActiveBanner).toHaveBeenCalledWith('ep-1');
        // ...AND the inline breadcrumb is armed at the anchor (rendered once the file is visible;
        // the anchor no longer has to be on screen in the delivery moment)...
        expect(deps.showInline).toHaveBeenCalledWith('src/B.java', 84, 'check punctuation', 'Iris has a suggestion for you.');
        // ...and the jump lamp is armed at the same anchor (the persistent way to reach the cue);
        // showActiveJump replaces the old unconditional clearLamp for the anchored case.
        expect(deps.showActiveJump).toHaveBeenCalledWith('src/B.java', 84);
        expect(deps.clearLamp).not.toHaveBeenCalled();
    });

    it('inbound active event without an anchor arms no inline cue and no jump lamp (clears both)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 8, undefined, undefined, undefined, 0.9);
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveJump).not.toHaveBeenCalled();
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();
        expect(deps.openSession).toHaveBeenCalledWith(8);
    });

    // Pull re-route (spec §12.2 Off/Less/More): the client-side defence-in-depth that keeps Less
    // from ever surfacing a bubble/notification, even when the server decided `active`.
    it('Pull re-route: level=less turns an inbound active event into ambient/PARKED, never a bubble/banner/session-open', () => {
        const deps = fakeDeps({ getProactiveLevel: () => 'less' });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7, 'src/B.java', 84, 'check punctuation', 0.9, 'Iris has a suggestion for you.', 123);

        // Re-routed to the ambient/PARKED surface: badge + lamp (+ gutter, since an anchor was sent).
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showLamp).toHaveBeenCalled();
        expect(deps.showGutterOnly).toHaveBeenCalledWith('src/B.java', 84);
        // Never the active surface: no session open, no bubble, no banner, no inline text/jump.
        expect(deps.openSession).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveJump).not.toHaveBeenCalled();
        // The slot itself is PARKED, not DELIVERED.
        expect(svc._slot.snapshot().state.kind).toBe('parked');
    });

    it('Pull re-route: level=more delivers the full active push (DELIVERED, bubble/banner) unchanged', () => {
        const deps = fakeDeps({ getProactiveLevel: () => 'more' });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7, 'src/B.java', 84, 'check punctuation', 0.9, 'Iris has a suggestion for you.', 123);

        expect(deps.openSession).toHaveBeenCalledWith(7);
        expect(deps.setBadge).toHaveBeenCalledWith(true);
        expect(deps.showActiveBanner).toHaveBeenCalledWith('ep-1');
        expect(deps.showInline).toHaveBeenCalledWith('src/B.java', 84, 'check punctuation', 'Iris has a suggestion for you.');
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
    });

    it('an UNSAFE anchor path (traversal) is treated as no anchor on every surface', () => {
        // One contract for inline, gutter, and jump: a malformed server anchor like ../x must not
        // arm any anchor surface (it could point outside the exercise root). It falls through to the
        // no-anchor branch exactly like a missing anchor.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 8, '../../etc/passwd', 1, 'peek', 0.9, 'Hint text', 5);
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showActiveJump).not.toHaveBeenCalled();
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();
    });

    // Delivery-time anchor rebase: the server anchor is in the coords of the snapshot the client SENT
    // at trigger; the student keeps typing during the ~10s round-trip, so the raw line can be stale.
    describe('anchor rebase (snapshot-to-delivery gap)', () => {
        const lines = (...ls: string[]): string => ls.join('\n');

        it('rebases the active anchor from the sent snapshot onto the current buffer before arming surfaces', () => {
            const baseline = lines('class B {', 'void m() {', 'return x;', '}');
            const current = lines('class B {', 'void m() {', 'int y = 0;', 'return x;', '}');
            const deps = fakeDeps({ readFileContent: vi.fn(() => current) });
            const svc = new StruggleInterventionService(deps);
            simulateDecidePending(svc, 'ep-1', false);
            svc._inFlightMarker!.baseline = { 'src/B.java': baseline };
            svc.onServerActive('ep-1', 8, 'src/B.java', 3, 'check punctuation', 0.9);
            // A line was inserted above the return: server line 3 -> live line 4, on inline AND jump.
            expect(deps.showInline).toHaveBeenCalledWith('src/B.java', 4, 'check punctuation', 'Iris has a suggestion for you.');
            expect(deps.showActiveJump).toHaveBeenCalledWith('src/B.java', 4);
        });

        it('rebases the gutter anchor for an ambient reply too', () => {
            const baseline = lines('a', 'b', 'TARGET', 'c');
            const current = lines('a', 'NEW', 'b', 'TARGET', 'c');
            const deps = fakeDeps({ readFileContent: vi.fn(() => current) });
            const svc = new StruggleInterventionService(deps);
            simulateDecidePending(svc);
            svc._inFlightMarker!.baseline = { 'src/A.java': baseline };
            svc.onServerAmbient('ep-test', 'Re-check the logic.', 'src/A.java', 3, 'off-by-one?');
            expect(deps.showGutterOnly).toHaveBeenCalledWith('src/A.java', 4);
        });

        it('suppresses the cue but keeps the bubble when the anchored line was rewritten', () => {
            const baseline = lines('class B {', 'void m() {', 'return x;', '}');
            const current = lines('class B {', 'void m() {', 'return y;', '}');
            const deps = fakeDeps({ readFileContent: vi.fn(() => current) });
            const svc = new StruggleInterventionService(deps);
            simulateDecidePending(svc, 'ep-1', false);
            svc._inFlightMarker!.baseline = { 'src/B.java': baseline };
            svc.onServerActive('ep-1', 8, 'src/B.java', 3, 'check punctuation', 0.9);
            expect(deps.showInline).not.toHaveBeenCalled();
            expect(deps.showActiveJump).not.toHaveBeenCalled();
            expect(deps.clearInline).toHaveBeenCalled();
            // The bubble/session still open; only the code cue is dropped (fail-safe).
            expect(deps.postBubble).toHaveBeenCalled();
            expect(deps.openSession).toHaveBeenCalledWith(8);
        });

        it('keeps the raw server line when the anchor file has no snapshot baseline (unchanged file)', () => {
            const deps = fakeDeps({ readFileContent: vi.fn(() => 'whatever') });
            const svc = new StruggleInterventionService(deps);
            simulateDecidePending(svc, 'ep-1', false);
            svc._inFlightMarker!.baseline = { 'src/OTHER.java': 'x' }; // no entry for the anchored file
            svc.onServerActive('ep-1', 8, 'src/B.java', 84, 'check punctuation', 0.9);
            expect(deps.showInline).toHaveBeenCalledWith('src/B.java', 84, 'check punctuation', 'Iris has a suggestion for you.');
            // Without a baseline the live buffer is never consulted.
            expect(deps.readFileContent).not.toHaveBeenCalled();
        });

        it('keeps the raw server line when the anchor file is not open (no current buffer)', () => {
            const deps = fakeDeps({ readFileContent: vi.fn(() => undefined) });
            const svc = new StruggleInterventionService(deps);
            simulateDecidePending(svc, 'ep-1', false);
            svc._inFlightMarker!.baseline = { 'src/B.java': 'class B {}' };
            svc.onServerActive('ep-1', 8, 'src/B.java', 84, 'check punctuation', 0.9);
            expect(deps.showInline).toHaveBeenCalledWith('src/B.java', 84, 'check punctuation', 'Iris has a suggestion for you.');
            expect(deps.readFileContent).toHaveBeenCalledWith('src/B.java');
        });
    });

    // Terminal-cleanup: the inline cue is episode-scoped, so every terminal exit must retire it.
    // All terminal exits (RECOVERED close, watchdog/ABANDON force-free, dismiss, stale-ask
    // "something-else", new-exercise) funnel through _clearEpisodeRuntime(), so one representative
    // path (dismissEpisode) proves the shared seam clears the standing cue.
    it('a terminal episode exit retires the standing inline cue (no reliance on a later file edit)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 8, 'src/B.java', 84, 'check punctuation', 0.9);
        expect(deps.showInline).toHaveBeenCalled();     // an inline cue is standing on the DELIVERED slot
        vi.mocked(deps.clearInline).mockClear();        // ignore any setup stale-cue clear

        svc.dismissEpisode();                           // terminal exit -> _clearEpisodeRuntime()

        expect(deps.clearInline).toHaveBeenCalled();    // the standing cue is retired at the episode end
        expect(svc._slot.isFree()).toBe(true);
    });

    it('a terminal episode exit retires the jump lamp (mode-guarded clearEpisodeLamp)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 8, 'src/B.java', 84, 'check punctuation', 0.9);
        expect(deps.showActiveJump).toHaveBeenCalled(); // jump lamp is standing on the DELIVERED slot
        vi.mocked(deps.clearEpisodeLamp).mockClear();

        vi.mocked(deps.clearLamp).mockClear();
        svc.dismissEpisode();                           // terminal exit -> _clearEpisodeRuntime()

        expect(deps.clearEpisodeLamp).toHaveBeenCalled();
        // Teardown uses ONLY the mode-guarded clear (parked/jump), not the unconditional clearLamp.
        expect(deps.clearLamp).not.toHaveBeenCalled();
    });

    // #343: the activity-bar badge marks an outstanding proactive hint and is episode-scoped, so the
    // shared terminal seam must clear it too (previously it stranded at "1" after a solved/timed-out close).
    it('a terminal episode exit clears the activity-bar badge', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 8, 'src/B.java', 84, 'check punctuation', 0.9);
        vi.mocked(deps.setBadge).mockClear();           // ignore the delivery-time badge set

        svc.dismissEpisode();                           // terminal exit -> _clearEpisodeRuntime()

        expect(deps.setBadge).toHaveBeenCalledWith(false);
        expect(svc._slot.isFree()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Delivered-slot POST gating: no decide POST when the result is provably discarded
// ---------------------------------------------------------------------------

describe('StruggleInterventionService delivered-slot POST gating', () => {
    // While the slot is DELIVERED, reconcile suppresses every inbound decide result except the
    // escalation case (revealed-ambient level + hard boundary), so a decide POST whose result is
    // provably discarded must not be sent (it costs a full server pipeline run only to be thrown
    // away on arrival). Since C6 the same delivered-slot hook, when an offer is still available for
    // the episode (under cap, not declined), raises a client-local Moment-1 offer INSTEAD of
    // suppressing: shouldSuppress() therefore returns false (the alert flows through), but the
    // POST-saving invariant is preserved either way -- raising an offer sends no decide POST.

    function stateAlert(t = 610): AlertRecord {
        return { kind: 'edit', t, ts: t * 1000, urgency: 0.9, typesPreGate: ['STATE'], types: ['STATE'], primary: 'STATE', path: 'e6', inWarmup: false, inGrace: false };
    }

    it('soft (STATE) alert while DELIVERED-active: raises a Moment-1 offer, no POST', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);                                       // slot -> DELIVERED, level active
        vi.mocked(deps.postIntervention).mockClear();

        expect(svc.shouldSuppress(stateAlert())).toBe(false);        // C6: an offer is available, so it flows through
        svc.onTick(tick(610));
        svc.deliver(stateAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(svc._outstandingOffer).toBeDefined();                 // a Moment-1 offer was raised, not a POST
        expect(deps.postIntervention).not.toHaveBeenCalled();        // raising an offer sends no decide POST
    });

    it('hard (FM) alert while DELIVERED-active: raises a Moment-1 offer, no POST (no escalation from active level)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        vi.mocked(deps.postIntervention).mockClear();

        // FM is hard, but level is 'active' (no escalation), so C6 raises an offer instead of suppressing.
        expect(svc.shouldSuppress(alert())).toBe(false);
        svc.onTick(tick(620));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(svc._outstandingOffer).toBeDefined();                 // a Moment-1 offer was raised, not a POST
        expect(deps.postIntervention).not.toHaveBeenCalled();        // raising an offer sends no decide POST
    });

    it('soft (STATE) alert while DELIVERED-ambient (revealed): raises a Moment-1 offer, no POST (escalation needs a hard boundary)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc._slot.takeParked(1000, newEpisode(1000, () => 'ep-amb', 42), { level: 'ambient', text: 'hint', atSessionS: 100 });
        svc._frozenSessionId = 55;
        await svc.revealParkedHint();                                // slot -> DELIVERED, level ambient
        vi.mocked(deps.postIntervention).mockClear();

        // A soft alert cannot escalate the revealed-ambient slot, so C6 raises an offer instead of suppressing.
        expect(svc.shouldSuppress(stateAlert())).toBe(false);
        svc.onTick(tick(620));
        svc.deliver(stateAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(svc._outstandingOffer).toBeDefined();                 // a Moment-1 offer was raised, not a POST
        expect(deps.postIntervention).not.toHaveBeenCalled();        // raising an offer sends no decide POST
    });

    it('hard (FM) alert while DELIVERED-ambient (revealed): POST proceeds (escalation candidate) with the live episode', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc._slot.takeParked(1000, newEpisode(1000, () => 'ep-amb', 42), { level: 'ambient', text: 'hint', atSessionS: 100 });
        svc._frozenSessionId = 55;
        await svc.revealParkedHint();
        vi.mocked(deps.postIntervention).mockClear();

        expect(svc.shouldSuppress(alert())).toBe(false);
        svc.onTick(tick(620));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        // Continuation carries the live episode including the already-delivered hint.
        const body = (deps.postIntervention as ReturnType<typeof vi.fn>).mock.calls[0][1] as StruggleInterventionRequest;
        expect(body.episode.episodeId).toBe('ep-amb');
        expect(body.episode.hints).toHaveLength(1);
    });

    it('TPS (discrete) alert while DELIVERED-ambient (revealed): POST proceeds and the active reply escalates', async () => {
        // The REAL escalation flow (not a synthetic hardEvent stamp): parked -> reveal ->
        // TPS deliver() -> POST (hard event lets it through the delivered-slot gate) ->
        // server replies active -> reconcile escalates the SAME episode ambient -> active.
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc._slot.takeParked(1000, newEpisode(1000, () => 'ep-amb', 42), { level: 'ambient', text: 'hint', atSessionS: 100 });
        svc._frozenSessionId = 55;
        await svc.revealParkedHint();                                // slot -> DELIVERED, level ambient
        vi.mocked(deps.postIntervention).mockClear();
        vi.mocked(deps.postBubble).mockClear();

        expect(svc.shouldSuppress(discreteAlert())).toBe(false);     // TPS is hard: escalation candidate
        svc.onTick(tick(620));
        svc.deliver(discreteAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);
        const body = (deps.postIntervention as ReturnType<typeof vi.fn>).mock.calls[0][1] as StruggleInterventionRequest;
        expect(body.struggleSignal.alert.primaryBoundary).toBe('TPS');
        expect(body.episode.episodeId).toBe('ep-amb');               // continues the live episode

        svc.onServerActive('ep-amb', 55, undefined, undefined, undefined, 0.9, 'escalated hint', 123);
        const state = svc._slot.snapshot().state;
        expect(state.kind).toBe('delivered');
        expect(state.kind === 'delivered' ? state.level : null).toBe('active');
        expect(deps.postBubble).toHaveBeenCalledWith('escalated hint', 123, 'ep-amb');
    });
});

// ---------------------------------------------------------------------------
// C2: hold-frozen ambient + reveal-on-click + episode-outcome API + back-fill
// ---------------------------------------------------------------------------

describe('StruggleInterventionService C2 reveal', () => {
    /** Puts the slot in PARKED state and sets the frozen session id. */
    function setupParked(svc: StruggleInterventionService, sessionId: number, hintText = 'Re-check the loop.', epId = 'ep-uuid'): void {
        const ep = newEpisode(1000, () => epId, 42);
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

    it('revealParkedHint (#364): synchronous transition; navToken captured before the persist await; navigates once on confirmed persist with resolved courseId/title + captured navToken; no parked bubble', async () => {
        const resolveRevealTarget = vi.fn(() => ({ courseId: 5, title: 'X' }));
        const currentNavToken = vi.fn(() => 777);
        const openRevealSession = vi.fn(async () => true);
        const deps = fakeDeps({ resolveRevealTarget, currentNavToken, openRevealSession });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');   // episode.exerciseId = 42

        const p = svc.revealParkedHint();
        // The slot transition ran synchronously (before the persist await suspended).
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        // navToken was read synchronously, before revealAmbient (the persist await).
        const navOrder = currentNavToken.mock.invocationCallOrder[0];
        const persistOrder = (deps.revealAmbient as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
        expect(navOrder).toBeLessThan(persistOrder);
        await p;

        // Navigation fires ONLY from the confirmed-persist branch, exactly once, carrying the
        // resolved courseId + threaded title + captured navToken.
        expect(openRevealSession).toHaveBeenCalledTimes(1);
        expect(openRevealSession).toHaveBeenCalledWith(5, 42, 55, 'X', 777);
        // Deterministic localId = reveal-${episodeId} is used as the clientMessageId.
        expect(deps.revealAmbient).toHaveBeenCalledWith(42, 'ep-uuid', 'Re-check the loop.', 'ambient', 'reveal-ep-uuid');
        // The parked path no longer posts an optimistic bubble (the row arrives via the reload).
        expect(deps.postRevealBubble).not.toHaveBeenCalled();
    });

    it('revealParkedHint (#364): unresolvable exercise (resolveRevealTarget undefined) notifies + aborts; no transition/persist/navigate; slot stays PARKED', async () => {
        const deps = fakeDeps({ resolveRevealTarget: vi.fn(() => undefined) });
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        await svc.revealParkedHint();

        expect(deps.notifyRevealUnavailable).toHaveBeenCalledTimes(1);
        expect(svc._slot.snapshot().state.kind).toBe('parked');   // no transition
        expect(deps.revealAmbient).not.toHaveBeenCalled();         // no persist
        expect(deps.openRevealSession).not.toHaveBeenCalled();     // no navigation
    });

    it('revealParkedHint (#364): missing sessionId -> guard, nothing happens (no resolve/notify/persist/navigate)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');
        svc._frozenSessionId = undefined;   // no frozen session -> step-2 guard

        await svc.revealParkedHint();

        expect(deps.resolveRevealTarget).not.toHaveBeenCalled();
        expect(deps.notifyRevealUnavailable).not.toHaveBeenCalled();
        expect(deps.revealAmbient).not.toHaveBeenCalled();
        expect(deps.openRevealSession).not.toHaveBeenCalled();
        expect(svc._slot.snapshot().state.kind).toBe('parked');
    });

    it('revealParkedHint: revealAmbient called once with correct args incl. clientMessageId=localId', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        setupParked(svc, 55, 'Re-check the loop.', 'ep-uuid');

        await svc.revealParkedHint();

        expect(deps.revealAmbient).toHaveBeenCalledTimes(1);
        expect(deps.revealAmbient).toHaveBeenCalledWith(42, 'ep-uuid', 'Re-check the loop.', 'ambient', 'reveal-ep-uuid');
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
            'reveal-ep-uuid', 7, 'server-ep-id', '2024-01-01T00:00:00Z',
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
        // #364: a failed persist must NEVER navigate to an empty session.
        expect(deps.openRevealSession).not.toHaveBeenCalled();

        // Fire the retry
        await (retryFn as () => void)();

        // Retry calls revealAmbient with the SAME (deterministic) localId
        expect(revealAmbient).toHaveBeenCalledTimes(2);
        expect(revealAmbient).toHaveBeenNthCalledWith(2, 42, 'ep-uuid', 'Re-check the loop.', 'ambient', 'reveal-ep-uuid');
        // Reconcile fires after the retry succeeds
        expect(deps.reconcileOptimisticBubble).toHaveBeenCalledTimes(1);
        // #364: the retry that first succeeds navigates exactly once, carrying the ORIGINAL
        // courseId/sessionId/title/navToken captured at reveal time (defaults from the fake).
        expect(deps.openRevealSession).toHaveBeenCalledTimes(1);
        expect(deps.openRevealSession).toHaveBeenCalledWith(100, 42, 55, 'Fake Exercise', 1);
    });

    it('revealParkedHint: no-op when slot is not PARKED (prevents double-reveal)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        // Slot is FREE (default)

        await svc.revealParkedHint();

        expect(deps.revealAmbient).not.toHaveBeenCalled();
        expect(deps.postRevealBubble).not.toHaveBeenCalled();
    });

    it('revealParkedHint (#364): missing episode.exerciseId -> guard, nothing happens', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        // PARKED episode deliberately WITHOUT an exerciseId -> hits the missing-id guard.
        svc._slot.takeParked(1000, newEpisode(1000, () => 'ep-noid'), { level: 'ambient', text: 'hint', atSessionS: 100 });
        svc._frozenSessionId = 55;

        await svc.revealParkedHint();

        expect(deps.resolveRevealTarget).not.toHaveBeenCalled();   // guard precedes resolve
        expect(deps.notifyRevealUnavailable).not.toHaveBeenCalled();
        expect(deps.revealAmbient).not.toHaveBeenCalled();
        expect(deps.openRevealSession).not.toHaveBeenCalled();
        expect(svc._slot.snapshot().state.kind).toBe('parked');
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
        expect(deps.revealAmbient).toHaveBeenCalledWith(42, 'ep-c1', 'look at this line', 'ambient', 'reveal-ep-c1');
    });

    it('I2 back-fill: dismissEpisode (terminal write) records pending outcome when setEpisodeOutcome returns applied=false', async () => {
        const setEpisodeOutcome = vi.fn(async () => ({ applied: false }));
        const deps = fakeDeps({ setEpisodeOutcome });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-bf');
        svc.onServerActive('ep-bf', 55);
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

        svc.onServerAmbient('ep-x', 'hint', undefined, undefined, undefined, undefined, null, 99);

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
        svc.onServerActive('ep-1', 7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        expect(deps.postBubble).toHaveBeenCalledTimes(1);

        // Second decide: ambient -> reconcile returns suppress (DELIVERED + ambient -> suppress)
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerAmbient('ep-1', 'New hint', undefined, undefined, undefined);
        // Slot still DELIVERED (not overwritten)
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        // Badge/lamp NOT re-fired for the ambient (it was suppressed)
        expect(deps.showLamp).not.toHaveBeenCalled();
    });

    it('suppressed decide that carries a persisted messageId drops the orphan row (no duplicate hint via history)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // First decide: active -> takes slot as DELIVERED
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        // Second decide on the DELIVERED slot: ambient reply carries a persisted messageId (555).
        // reconcile(DELIVERED, ambient) -> suppress. The persisted row would otherwise linger on the
        // server and reappear as a chat row on the next history/chat-ws load (the duplicate-hint the
        // stale-check removal is meant to prevent), so suppress MUST drop it.
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerAmbient('ep-1', 'New hint', undefined, undefined, undefined, undefined, 555);

        // Slot untouched (still the original delivered episode)
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        // The orphaned persisted row is removed from the webview and best-effort deleted server-side
        expect(deps.postRemoveMessage).toHaveBeenCalledWith(555);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 555);
    });

    it('suppressed decide WITHOUT a messageId does not attempt a row drop', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerActive('ep-1', 7);
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerAmbient('ep-1', 'New hint', undefined, undefined, undefined); // no messageId

        expect(deps.postRemoveMessage).not.toHaveBeenCalled();
        expect(deps.deleteSupersededProactiveMessage).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Preallocated candidate: replace-parked uses the REQUEST's candidate id
    // -------------------------------------------------------------------------
    it('PARKED ambient + different-problem ambient -> replace-parked using the preallocated candidate id', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // First decide: ambient -> FREE slot -> take-parked (candidate ep-1)
        simulateDecidePending(svc, 'ep-1', false);
        svc.onServerAmbient('ep-1', 'First hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');
        const gen1 = svc._slot.generation();

        // Second decide: ambient -> PARKED slot -> replace-parked (candidate ep-2)
        simulateDecidePending(svc, 'ep-2', false);
        svc.onServerAmbient('ep-2', 'Second hint', undefined, undefined, undefined);

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
        svc.onServerAmbient('ep-1', 'Hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');

        // Second decide: active -> PARKED -> replace-delivered (candidate ep-2)
        simulateDecidePending(svc, 'ep-2', false);
        svc.onServerActive('ep-2', 8);

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
        const ep = { episodeId: 'ep-stale', hints: [], createdAtMs: 0 };
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'h', atSessionS: 0 });
        // Now generation is 1 but in-flight marker still has generation 0 (from simulateDecidePending)
        // The accept() check: stamp.generation(0) !== snap.generation(1) -> null -> drop
        svc.onServerAmbient('ep-stale', 'New hint', undefined, undefined, undefined);

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
        const ep = { episodeId: 'ep-escl', hints: [], createdAtMs: 0 };
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

        svc.onServerActive('ep-escl', 9);
        // Slot escalated: still DELIVERED but level changed to active
        const snap = svc._slot.snapshot();
        expect(snap.state.kind).toBe('delivered');
        expect((snap.state as Extract<SlotState, { kind: 'delivered' }>).level).toBe('active');
        expect(deps.postBubble).toHaveBeenCalledTimes(1);
    });

    it('setInSession(true): escalation is quiet (bubble only, no banner/inline); setInSession(false): loud (banner+inline)', () => {
        // Helper to set up a DELIVERED-ambient slot and run an escalating decide
        function runEscalation(inSession: boolean): StruggleInterventionDeps {
            const deps = fakeDeps();
            const svc = new StruggleInterventionService(deps);

            // Set slot to DELIVERED ambient (parked then revealed)
            const ep = { episodeId: 'ep-esc', hints: [], createdAtMs: 0 };
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

            svc.onServerActive('ep-esc', 9, 'src/A.java', 10, 'tip', 0.9, 'Hint text');
            return deps;
        }

        // In-session: bubble only, no banner or inline push. The jump lamp is the ONE code
        // pointer that still arms in-session (leiser, no focus steal) so the code stays reachable.
        // clearInline still fires to retire any stale parked gutter cue carried over by the reveal.
        const inSessionDeps = runEscalation(true);
        expect(inSessionDeps.postBubble).toHaveBeenCalledTimes(1);
        expect(inSessionDeps.showActiveBanner).not.toHaveBeenCalled();
        expect(inSessionDeps.showInline).not.toHaveBeenCalled();
        expect(inSessionDeps.clearInline).toHaveBeenCalled();
        expect(inSessionDeps.showActiveJump).toHaveBeenCalledWith('src/A.java', 10);

        // Out-of-session (default): bubble + banner + inline + jump lamp
        const outSessionDeps = runEscalation(false);
        expect(outSessionDeps.postBubble).toHaveBeenCalledTimes(1);
        expect(outSessionDeps.showActiveBanner).toHaveBeenCalledTimes(1);
        expect(outSessionDeps.showActiveBanner).toHaveBeenCalledWith('ep-esc');
        expect(outSessionDeps.showInline).toHaveBeenCalledTimes(1);
        expect(outSessionDeps.showActiveJump).toHaveBeenCalledWith('src/A.java', 10);
    });

    it('escalation WITHOUT an anchor retires any stale parked gutter cue and arms no jump lamp', () => {
        // Regression: revealParkedHint keeps the parked gutter cue; a no-anchor escalation must
        // still clear it (previously the escalation returned without touching inline state).
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc._slot.takeParked(0, { episodeId: 'ep-na', hints: [], createdAtMs: 0 }, { level: 'ambient', text: 'h', atSessionS: 0 });
        svc._slot.revealParked({ level: 'ambient', text: 'h', atSessionS: 0 });
        const gen = svc._slot.generation();
        const stamp = { episodeId: 'ep-na', generation: gen, hardEvent: true, requestToken: 'tok-na' };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken: 'tok-na', episodeId: 'ep-na', generation: gen, intent: 'decide', localToken };
        vi.mocked(deps.clearInline).mockClear();

        svc.onServerActive('ep-na', 9);                          // active reply with NO anchor -> escalate

        expect(deps.clearInline).toHaveBeenCalled();    // stale gutter cue retired
        expect(deps.showActiveJump).not.toHaveBeenCalled();
        expect(deps.showInline).not.toHaveBeenCalled();
    });

    it('escalation gated by hardEvent: delivered-ambient + active WITHOUT hardEvent -> suppress', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set slot to DELIVERED ambient
        const ep = { episodeId: 'ep-soft', hints: [], createdAtMs: 0 };
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'h', atSessionS: 0 });
        svc._slot.revealParked({ level: 'ambient', text: 'h', atSessionS: 0 });
        const genAfterReveal = svc._slot.generation();

        const requestToken = 'tok-soft';
        const stamp = { episodeId: 'ep-soft', generation: genAfterReveal, hardEvent: false, requestToken };
        const localToken = svc._guard.issue('decide', stamp);
        svc._inFlightMarker = { requestToken, episodeId: 'ep-soft', generation: genAfterReveal, intent: 'decide', localToken };

        svc.onServerActive('ep-soft', 9);
        // No escalation, slot stays at ambient level
        expect((svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).level).toBe('ambient');
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // isNew flip on first accepted request
    // -------------------------------------------------------------------------
    it('isNew=true on first POST; flips to false on the next POST to the same episode (after first accepted)', async () => {
        // The only continuation POST left from a DELIVERED slot is the escalation candidate
        // (revealed-ambient level + hard boundary); all other delivered-slot decides are
        // skipped before the POST (delivered-slot POST gating).
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.5, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });

        // First decide: FREE slot, preallocates a candidate, isNew=true
        svc.deliver({ kind: 'edit', t: 530, ts: 530000, urgency: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);
        const firstBody = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(firstBody.episode.isNew).toBe(true);
        const episodeId = firstBody.episode.episodeId;

        // Server replies: ambient -> PARKED; the student reveals it -> DELIVERED at ambient level.
        // The episode is now in _continuedEpisodeIds.
        svc.onServerAmbient(episodeId, 'Hint text', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');
        svc._frozenSessionId = 55;
        await svc.revealParkedHint();
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
        postSpy.mockClear();

        // Second decide (hard boundary, escalation candidate): same episodeId, isNew MUST be false now.
        svc.deliver({ kind: 'edit', t: 540, ts: 540000, urgency: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
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
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.5, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });
        svc.deliver({ kind: 'edit', t: 530, ts: 530000, urgency: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
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

        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.5, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });
        svc.deliver({ kind: 'edit', t: 530, ts: 530000, urgency: 0.72, typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'armed', inWarmup: false, inGrace: false });
        await new Promise(r => setTimeout(r, 0));

        const sentEpisodeId = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1].episode.episodeId;
        // Receive ambient -> candidate takes the slot
        svc.onServerAmbient(sentEpisodeId, 'Hint text', undefined, undefined, undefined);
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
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 530 };
        svc.onServerActive('ep-del', 7);
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

    it('confirmClose POST carries proactivityMode mapped from the exercise level (less -> pull, more -> push)', async () => {
        const morePost = vi.fn(async () => 'accepted' as const);
        const more = fakeDeps({ postIntervention: morePost, getProactiveLevel: () => 'more' });
        const svcMore = new StruggleInterventionService(more);
        simulateDecidePending(svcMore, 'ep-del-more', false);
        svcMore._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 530 };
        svcMore.onServerActive('ep-del-more', 7);
        await new Promise(r => setTimeout(r, 0));
        morePost.mockClear();
        svcMore.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        expect(morePost).toHaveBeenCalledTimes(1);
        const moreBody = (morePost.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(moreBody.proactivityMode).toBe('push');

        const lessPost = vi.fn(async () => 'accepted' as const);
        const less = fakeDeps({ postIntervention: lessPost, getProactiveLevel: () => 'less' });
        const svcLess = new StruggleInterventionService(less);
        simulateDecidePending(svcLess, 'ep-del-less', false);
        svcLess._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 530 };
        svcLess.onServerActive('ep-del-less', 7);
        await new Promise(r => setTimeout(r, 0));
        lessPost.mockClear();
        svcLess.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        expect(lessPost).toHaveBeenCalledTimes(1);
        const lessBody = (lessPost.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(lessBody.proactivityMode).toBe('pull');
    });

    it('owed confirmClose is NOT posted while Iris is disabled (defense-in-depth _drainOwed gate)', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        // isIrisEnabled flips false AFTER the (synthetic) episode is already live, mirroring a
        // mid-session cache invalidation: _drainOwed must still refuse to egress code.
        const deps = fakeDeps({ postIntervention: postSpy, isIrisEnabled: () => false });
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot + lastSignal directly (bypasses the gated alert path on purpose,
        // so this test isolates the _drainOwed guard from the _suppressReason guard).
        simulateDecidePending(svc, 'ep-del', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 530 };
        svc.onServerActive('ep-del', 7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');

        // Green test -> latch fires -> owed confirmClose queued -> _drainOwed runs but must bail early
        svc.onNewBuildResult(true);
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).not.toHaveBeenCalled();
        // The owed request is left queued (not consumed), proving the guard returned before
        // touching collectFiles/postIntervention/the owed-clear branch.
        expect(svc._owedConfirmClose).toEqual({ confirmReason: 'progress' });
    });

    it('confirmClose after a TPS-originated decide reuses the TPS _lastSignal (path=discrete on the wire)', async () => {
        const postSpy = vi.fn(async () => 'accepted' as const);
        const deps = fakeDeps({ postIntervention: postSpy });
        const svc = new StruggleInterventionService(deps);

        // Real decide path: _lastSignal is built from the discrete alert by production code.
        svc.onTick(tick(530));
        svc.deliver(discreteAlert());
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);

        svc.onServerActive(svc._inFlightMarker!.episodeId, 7);                    // decide reply -> slot DELIVERED
        postSpy.mockClear();

        svc.onNewBuildResult(true);               // progress edge -> owed confirmClose -> drains
        await new Promise(r => setTimeout(r, 0));
        expect(postSpy).toHaveBeenCalledTimes(1);
        const body = (postSpy.mock.calls[0] as unknown as [number, StruggleInterventionRequest])[1];
        expect(body.intent).toBe('confirm_close');
        expect(body.confirmReason).toBe('progress');
        expect(body.struggleSignal.alert.primaryBoundary).toBe('TPS');
        expect(body.struggleSignal.alert.path).toBe('discrete');
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
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 530 };
        svc.onServerActive('ep-del', 7);
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
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 100 };
        svc.onServerAmbient('ep-pcc', 'Hint', undefined, undefined, undefined);
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
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 100 };
        svc.onServerAmbient('ep-pcc2', 'Hint', undefined, undefined, undefined);
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
    it('scoped-cancel: _clearEpisodeRuntime cancels under the OWNING exercise, not the current one (#350)', () => {
        const cancelSpy = vi.fn(async () => undefined);
        // Owning exercise A=1; the student has already switched so getExerciseId() now returns B=2.
        const deps = fakeDeps({ cancelOutstandingStruggleJob: cancelSpy, getExerciseId: () => 2 });
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot
        simulateDecidePending(svc, 'ep-sc', false);
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 530 };
        svc.onServerActive('ep-sc', 7); // wire cleared by _acceptDecide

        // A fresh confirmClose request B is now in flight, armed under the OWNING exercise A=1.
        const tokenB = 'token-B';
        const ep = (svc._slot.snapshot().state as Extract<SlotState, { kind: 'delivered' }>).episode;
        const stamp = { episodeId: ep.episodeId, generation: svc._slot.generation(), hardEvent: false, requestToken: tokenB };
        const lt = svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken: tokenB, episodeId: ep.episodeId, generation: svc._slot.generation(), intent: 'confirm_close', localToken: lt, exerciseId: 1 };

        // resetSession is a terminal: calls _slot.free() + _clearEpisodeRuntime
        svc.resetSession();

        // Cancel used the OWNING exercise (A=1) from the marker, NOT getExerciseId() (B=2).
        expect(cancelSpy).toHaveBeenCalledWith(1, tokenB);
        expect(cancelSpy).toHaveBeenCalledTimes(1);
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('replace-parked does NOT cancel: the in-flight decide is completing into the replacement', () => {
        const cancelSpy = vi.fn(async () => undefined);
        const deps = fakeDeps({ cancelOutstandingStruggleJob: cancelSpy });
        const svc = new StruggleInterventionService(deps);

        // First decide: FREE -> ambient -> PARKED
        simulateDecidePending(svc, 'ep-r1', false);
        svc.onServerAmbient('ep-r1', 'First hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');

        // Second decide in-flight (for replace-parked)
        simulateDecidePending(svc, 'ep-r2', false);

        // Reply: ambient on PARKED -> replace-parked (non-terminal, does NOT call _clearEpisodeRuntime)
        svc.onServerAmbient('ep-r2', 'Second hint', undefined, undefined, undefined);

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
        const ep = newEpisode(0, () => 'ep-rev', 42);
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'STATE', boundaryTypes: ['STATE'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 100 };

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

        const ep = newEpisode(0, () => 'ep-rev2', 42);
        svc._slot.takeParked(0, ep, { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'STATE', boundaryTypes: ['STATE'], severity: 0.5, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 100 };

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
    it('clearEpisodeRuntime teardown: latch reset, watchdog disarmed, owed cleared', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up some state
        simulateDecidePending(svc, 'ep-tear', false);
        svc._owedConfirmClose = { confirmReason: 'progress' };
        // Arm watchdog
        svc._watchdog = new StaleWatchdog({ idleAbandonMs: 600_000 });
        svc._watchdog!.arm(Date.now(), false);

        // Free the slot to trigger clearEpisodeRuntime
        svc._slot.takeParked(0, { episodeId: 'ep-tear', hints: [], createdAtMs: 0 }, { level: 'ambient', text: 'h', atSessionS: 0 });
        svc._slot.free();
        svc['_clearEpisodeRuntime']();

        expect(svc._owedConfirmClose).toBeUndefined();
        expect(svc._watchdog).toBeUndefined();
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
        svc._lastSignal = { alert: { tSessionS: 530, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 530 };
        svc.onServerActive('ep-fold', 7);
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
        svc.onServerAmbient('ep-parked', 'h', undefined, undefined, undefined);
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
    it('watchdog force-frees a DELIVERED slot after continuous idle (ABANDONED + fold)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Set up DELIVERED slot
        simulateDecidePending(svc, 'ep-wdog', false);
        svc._lastSignal = { alert: { tSessionS: 100, primaryBoundary: 'FM', boundaryTypes: ['FM'], severity: 0.72, path: 'armed', inWarmup: false, inGrace: false }, trajectory: [], sessionSeconds: 100 };
        svc.onServerActive('ep-wdog', 7);

        // Watchdog with a tiny idle window, armed in the past so the next tick is past the deadline.
        svc._watchdog = new StaleWatchdog({ idleAbandonMs: 0 });
        svc._watchdog!.arm(Date.now() - 1000, false);

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
        svc.onServerActive('ep-wp', 7);
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
        svc.onServerActive('ep-wp2', 7);
        expect(svc._watchdog).toBeDefined();
        const resetSpy = vi.spyOn(svc._watchdog!, 'resetProgress');

        // DEFAULT_PROGRESS_CFG.reArmSBase = 0.6; feed sBase = 0.3 (below threshold)
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.3, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });

        expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    it('tick with sBase above reArmSBase does NOT call watchdog.resetProgress (no reset on high stress)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-wp3', false);
        svc.onServerActive('ep-wp3', 7);
        expect(svc._watchdog).toBeDefined();
        const resetSpy = vi.spyOn(svc._watchdog!, 'resetProgress');

        // sBase = 0.8 (above reArmSBase threshold of 0.6)
        svc.onTick({ t: 530, ts: 530000, features: {} as any, sBase: 0.8, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace });

        expect(resetSpy).not.toHaveBeenCalled();
    });

});

// ---------------------------------------------------------------------------
// Live-episode chat frame (SetLiveEpisode seam): the engine pushes which episode
// is DELIVERED so the chat webview never folds the live episode as an earlier hint.
// ---------------------------------------------------------------------------

describe('StruggleInterventionService live-episode chat frame', () => {
    const flushSlotChange = () => new Promise(r => setTimeout(r, 0));

    it('active delivery pushes the delivered episodeId to the chat', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-live', false);
        svc.onServerActive('ep-live', 7);
        await flushSlotChange();

        expect(deps.setChatLiveEpisode).toHaveBeenCalledWith('ep-live');
    });

    it('active delivery threads the episodeId into the bubble', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-live', false);
        svc.onServerActive('ep-live', 7);

        expect(deps.postBubble).toHaveBeenCalledWith(expect.any(String), null, 'ep-live');
    });

    it('dismissEpisode pushes null (slot freed)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-live', false);
        svc.onServerActive('ep-live', 7);
        await flushSlotChange();
        svc.dismissEpisode('ep-live');
        await flushSlotChange();

        expect(deps.setChatLiveEpisode).toHaveBeenLastCalledWith(null);
    });

    it('an unchanged live value is not re-pushed (suppressed decide on the delivered slot)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-live', false);
        svc.onServerActive('ep-live', 7);
        await flushSlotChange();
        expect(deps.setChatLiveEpisode).toHaveBeenCalledTimes(1);

        // Suppressed follow-up (DELIVERED + ambient -> suppress) notifies the slot seam,
        // but the live episode is unchanged -> no duplicate frame.
        simulateDecidePending(svc, 'ep-live', false);
        svc.onServerAmbient('ep-live', 'New hint', undefined, undefined, undefined);
        await flushSlotChange();

        expect(deps.setChatLiveEpisode).toHaveBeenCalledTimes(1);
    });

    it('watchdog force-free pushes null (ABANDONED terminal)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-live', false);
        svc.onServerActive('ep-live', 7);
        await flushSlotChange();
        expect(deps.setChatLiveEpisode).toHaveBeenCalledWith('ep-live');

        // Watchdog past its idle deadline -> force-free (DELIVERED -> ABANDONED)
        svc._watchdog = new StaleWatchdog({ idleAbandonMs: 0 });
        svc._watchdog!.arm(Date.now() - 1000, false);
        svc['_handleWatchdogTick'](Date.now());
        await flushSlotChange();

        expect(svc._slot.isFree()).toBe(true);
        expect(deps.setChatLiveEpisode).toHaveBeenLastCalledWith(null);
    });

    it('confirm-close resolved pushes null (RECOVERED terminal)', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        simulateDecidePending(svc, 'ep-live', false);
        svc.onServerActive('ep-live', 7);
        await flushSlotChange();
        expect(deps.setChatLiveEpisode).toHaveBeenCalledWith('ep-live');

        // Synthetic confirm_close in-flight for the delivered episode
        const gen = svc._slot.generation();
        const requestToken = 'close-request-token';
        const stamp: PendingStamp = { episodeId: 'ep-live', generation: gen, hardEvent: false, requestToken };
        const localToken = svc._guard.issue('confirm_close', stamp);
        svc._inFlightMarker = { requestToken, episodeId: 'ep-live', generation: gen, intent: 'confirm_close', localToken };

        svc.onServerClose('ep-live', true, undefined, undefined, undefined);
        await flushSlotChange();

        expect(svc._slot.isFree()).toBe(true);
        expect(deps.setChatLiveEpisode).toHaveBeenLastCalledWith(null);
    });
});

describe('onConsentRevoked (#349)', () => {
    it('frees a PARKED slot, clears every surface, keeps the latches', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        svc.onServerAmbient('ep-test', 'hint', undefined, undefined, undefined);   // slot -> PARKED
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
        svc.onServerActive(svc._inFlightMarker!.episodeId, 7, undefined, undefined, undefined, undefined, undefined, undefined);  // slot -> DELIVERED
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
        svc.onServerAmbient('ep-test', 'hint', undefined, undefined, undefined);   // slot -> PARKED (with consent)
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
        svc.onServerAmbient('ep-test', 'hint', undefined, undefined, undefined);   // slot -> PARKED
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
        svc.onServerAmbient('ep-test', 'late hint', undefined, undefined, undefined);
        expect(deps.showLamp).not.toHaveBeenCalled();
        expect(svc._slot.isFree()).toBe(true);
    });
    it('an inbound ACTIVE frame after revocation surfaces nothing', () => {
        let egress = true;
        const deps = fakeDeps({ isEgressEnabled: () => egress });
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc);
        egress = false;
        svc.onServerActive('ep-test', 7, undefined, undefined, undefined, undefined, undefined, undefined);
        expect(deps.showActiveBanner).not.toHaveBeenCalled();
        expect(deps.postBubble).not.toHaveBeenCalled();
        expect(svc._slot.isFree()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// #349 revoke->regrant epoch-boundary races (Findings 1-3 regression tests)
// ---------------------------------------------------------------------------

describe('StruggleInterventionService revoke->regrant epoch races (#349)', () => {
    // Finding 2: a stale POST completion from request A (superseded by a revoke->regrant that
    // issued a fresh marker for request B) must not clear or latch onto B's live in-flight state.
    it('deferred-POST settlement race: a superseded A completion never clears the fresh request B marker', async () => {
        let egress = true;
        let settleA!: (r: StruggleEgressResult) => void;
        let postN = 0;
        const deps = fakeDeps({
            isEgressEnabled: () => egress,
            postIntervention: vi.fn(() => {
                postN++;
                // A's POST is held; B's POST resolves normally.
                if (postN === 1) { return new Promise<StruggleEgressResult>(res => { settleA = res; }); }
                return Promise.resolve('accepted' as const);
            }),
        });
        const svc = new StruggleInterventionService(deps);

        // Request A on the wire, its POST held mid-flight.
        svc.onTick(tick(530));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        const tokenA = svc._inFlightMarker!.requestToken;
        expect(deps.postIntervention).toHaveBeenCalledTimes(1);

        // Revoke clears A's marker; then the student regrants.
        egress = false;
        svc.onConsentRevoked();
        expect(svc._inFlightMarker).toBeUndefined();
        egress = true;

        // Request B posts under the fresh consent and takes the wire (fresh token).
        svc.onTick(tick(560));
        svc.deliver(alert());
        await new Promise(r => setTimeout(r, 0));
        const tokenB = svc._inFlightMarker!.requestToken;
        expect(tokenB).not.toBe(tokenA);

        // A's held POST settles late as 'failed'. It must NOT touch B's marker.
        settleA('failed');
        await new Promise(r => setTimeout(r, 0));
        expect(svc._inFlightMarker?.requestToken).toBe(tokenB);   // B's wire survived

        // B's own reply (echoing B's episodeId) is still consumable -> slot delivers.
        svc.onServerActive(svc._inFlightMarker!.episodeId, 7);
        expect(svc._slot.snapshot().state.kind).toBe('delivered');
    });

    // Finding 1: a late ambient/active reply for a superseded request (its episodeId != the live
    // marker's) must be dropped without surfacing anything AND without killing the live marker.
    it('late-frame correlation: an uncorrelated ambient frame is dropped and preserves the live marker', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // Marker for episode B in flight.
        simulateDecidePending(svc, 'ep-B');

        // A late AMBIENT frame carrying episode A's id must surface nothing and keep B's marker.
        svc.onServerAmbient('ep-A', 'stale hint', undefined, undefined, undefined);
        expect(deps.showLamp).not.toHaveBeenCalled();
        expect(deps.setBadge).not.toHaveBeenCalledWith(true);
        expect(svc._slot.isFree()).toBe(true);
        expect(svc._inFlightMarker?.episodeId).toBe('ep-B');   // marker survived the stale frame

        // The correctly-correlated frame for B is consumed normally.
        svc.onServerAmbient('ep-B', 'real hint', undefined, undefined, undefined);
        expect(svc._slot.snapshot().state.kind).toBe('parked');
        expect(svc._inFlightMarker).toBeUndefined();           // consumed
    });

    // Finding 3: a reveal-persist retry scheduled before a revoke must not egress after it.
    it('reveal-retry revoke: a retry scheduled before revocation performs no egress once consent is gone', async () => {
        let egress = true;
        let retryFn: (() => void) | undefined;
        const revealAmbient = vi.fn()
            .mockRejectedValueOnce(new Error('network'))   // first attempt fails -> schedules a retry
            .mockResolvedValue({ id: 7, sentAt: 'T', proactiveEpisodeId: 'srv' } as IrisChatMessage);
        const deps = fakeDeps({
            isEgressEnabled: () => egress,
            revealAmbient,
            setTimeoutFn: (fn: () => void) => { retryFn = fn; },   // capture the retry instead of auto-firing it
        });
        const svc = new StruggleInterventionService(deps);

        // PARKED slot with a frozen session, ready to reveal.
        svc._slot.takeParked(0, newEpisode(0, () => 'ep-rr', 42), { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;

        await svc.revealParkedHint();     // first _persistReveal attempt fails -> schedules a retry
        expect(revealAmbient).toHaveBeenCalledTimes(1);
        expect(retryFn).toBeDefined();

        // Consent revoked before the retry fires.
        egress = false;
        svc.onConsentRevoked();

        // Fire the scheduled retry: it must NOT egress (generation bump + entry guard both block it).
        retryFn!();
        await new Promise(r => setTimeout(r, 0));
        expect(revealAmbient).toHaveBeenCalledTimes(1);   // still 1 -> no post-revoke egress
    });
});

// ---------------------------------------------------------------------------
// #349 wave 2: persisted-row retirement on correlation drops + reveal epoch boundary
// ---------------------------------------------------------------------------

describe('StruggleInterventionService wave 2: stale-row retirement + reveal epoch (#349)', () => {
    // Wave 2 Finding 1: a correlation-dropped frame's chat row is already persisted server-side
    // and could surface via chat history; it must be retired (like the suppress path does),
    // while the live marker still survives untouched.
    it('correlation-mismatch frame with a persisted messageId retires the row and preserves the marker', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-B');

        svc.onServerAmbient('ep-A', 'stale hint', undefined, undefined, undefined, undefined, 777);

        expect(deps.postRemoveMessage).toHaveBeenCalledWith(777);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 777);
        expect(svc._inFlightMarker?.episodeId).toBe('ep-B');   // marker untouched
        expect(svc._slot.isFree()).toBe(true);                 // nothing surfaced
        expect(deps.showLamp).not.toHaveBeenCalled();
    });

    it('missing-episodeId ACTIVE frame while a marker is live retires the row and preserves the marker', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        simulateDecidePending(svc, 'ep-B');

        svc.onServerActive(undefined, 7, undefined, undefined, undefined, undefined, undefined, 888);

        expect(deps.postRemoveMessage).toHaveBeenCalledWith(888);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 888);
        expect(svc._inFlightMarker?.episodeId).toBe('ep-B');
        expect(deps.postBubble).not.toHaveBeenCalled();
    });

    it('a late frame with NO in-flight marker retires its persisted row and surfaces nothing', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        // No marker at all: the frame is by definition late (stale reply after teardown).
        svc.onServerAmbient('ep-old', 'late hint', undefined, undefined, undefined, undefined, 555);

        expect(deps.postRemoveMessage).toHaveBeenCalledWith(555);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 555);
        expect(svc._slot.isFree()).toBe(true);
        expect(deps.showLamp).not.toHaveBeenCalled();
    });

    // Wave 2 Finding 2a: a reveal POST that settles successfully AFTER a revoke must not
    // reconcile the optimistic bubble or flush a pending outcome.
    it('in-flight reveal settling after a revoke reconciles nothing and flushes no outcome', async () => {
        let egress = true;
        let resolveReveal!: (v: IrisChatMessage) => void;
        const revealAmbient = vi.fn(() => new Promise<IrisChatMessage>(r => { resolveReveal = r; }));
        const deps = fakeDeps({ isEgressEnabled: () => egress, revealAmbient });
        const svc = new StruggleInterventionService(deps);

        svc._slot.takeParked(0, newEpisode(0, () => 'ep-fl', 42), { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;
        // Seed a pending outcome so the flush path is observable too.
        svc._pendingOutcomes.set('ep-fl', { outcome: 'DISMISSED' });

        const p = svc.revealParkedHint();          // hangs inside revealAmbient
        await new Promise(r => setTimeout(r, 0));
        expect(revealAmbient).toHaveBeenCalledTimes(1);

        egress = false;
        svc.onConsentRevoked();                    // epoch boundary while the POST is in flight

        resolveReveal({ id: 7, sentAt: 'T', proactiveEpisodeId: 'srv' } as IrisChatMessage);
        await p;

        expect(deps.reconcileOptimisticBubble).not.toHaveBeenCalled();
        expect(deps.setEpisodeOutcome).not.toHaveBeenCalled();
        // #364: a consent-epoch drop during the POST must NEVER navigate.
        expect(deps.openRevealSession).not.toHaveBeenCalled();
    });

    // Wave 2 Finding 2b: a reveal POST that REJECTS after a revoke must not schedule a retry
    // (the old code captured the already-bumped generation, so a regrant would replay stale content).
    it('reveal rejecting after a revoke schedules no retry', async () => {
        let egress = true;
        let rejectReveal!: (e: Error) => void;
        const revealAmbient = vi.fn(() => new Promise<IrisChatMessage>((_res, rej) => { rejectReveal = rej; }));
        const setTimeoutFn = vi.fn();
        const deps = fakeDeps({ isEgressEnabled: () => egress, revealAmbient, setTimeoutFn });
        const svc = new StruggleInterventionService(deps);

        svc._slot.takeParked(0, newEpisode(0, () => 'ep-rj', 42), { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;

        const p = svc.revealParkedHint();          // hangs inside revealAmbient
        await new Promise(r => setTimeout(r, 0));

        egress = false;
        svc.onConsentRevoked();                    // revoke while in flight (bumps the generation)

        rejectReveal(new Error('network'));
        await p;

        expect(setTimeoutFn).not.toHaveBeenCalled();   // no retry crosses the epoch boundary
    });

    // Sanity: the epoch guard must not over-block the normal same-epoch flow.
    it('sanity: a normal reveal still reconciles the optimistic bubble', async () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc._slot.takeParked(0, newEpisode(0, () => 'ep-ok', 42), { level: 'ambient', text: 'Hint', atSessionS: 0 });
        svc._frozenSessionId = 55;

        await svc.revealParkedHint();

        expect(deps.reconcileOptimisticBubble).toHaveBeenCalledWith('reveal-ep-ok', 7, 'server-ep-id', '2024-01-01T00:00:00Z');
    });
});
