import { describe, expect, it, vi } from 'vitest';

import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import { type StruggleInterventionDeps, StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import { emptyDecisionTrace } from '@test/__shared__/tickRecordFixture';

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
        clearLamp: vi.fn(),
        showInline: vi.fn(),
        clearInline: vi.fn(),
        isAnchorLive: () => false,
        isStudentProactiveOn: () => true,
        softThreshold: 3,
        pauseStrikes: 5,
        setBadge: vi.fn(),
        showActiveNotification: vi.fn(),
        log: { record: vi.fn(async () => undefined) } as unknown as StruggleInterventionDeps['log'],
        setTimeoutFn: () => { /* never auto-clear in-flight in tests */ },
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

    it('course-off latches (survives the in-flight watchdog): no lamp, no re-POST until reset (spec §13)', async () => {
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

        svc.reset();                                       // new exercise / re-probe clears the latch
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

    it('inbound ambient event (no anchor) → lamp hint (opensChat=true) + clears in-flight', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.onServerAmbient('Re-check the logic.', undefined, undefined, undefined);
        expect(deps.showAmbient).toHaveBeenCalledWith('Re-check the logic.', true);
        expect(deps.showInline).not.toHaveBeenCalled();
    });

    it('inbound ambient event WITH a live anchor → inline cue, not the lamp, and clears any standing lamp (spec §4)', () => {
        const deps = fakeDeps({ isAnchorLive: () => true });
        const svc = new StruggleInterventionService(deps);
        svc.onServerAmbient('Re-check the logic.', 'src/A.java', 42, 'off-by-one?');
        expect(deps.showInline).toHaveBeenCalledWith('src/A.java', 42, 'off-by-one?', 'Re-check the logic.');
        expect(deps.showAmbient).not.toHaveBeenCalled();
        expect(deps.clearLamp).toHaveBeenCalled();   // exclusive surface
    });

    it('inbound ambient event with an anchor that is NOT live → falls back to the lamp, and clears any standing inline cue', () => {
        const deps = fakeDeps({ isAnchorLive: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onServerAmbient('Re-check the logic.', 'src/A.java', 42, 'off-by-one?');
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.showAmbient).toHaveBeenCalledWith('Re-check the logic.', true);
        expect(deps.clearInline).toHaveBeenCalled();   // exclusive surface
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

    it('recordOutcome is a no-op when nothing was surfaced', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.recordOutcome('dismissed');
        expect(svc.isPaused()).toBe(false);   // no surface -> no backoff mutation
    });

    it('single-shot: a surface yields exactly one outcome; repeated callbacks on it are no-ops', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.onServerAmbient('hint', undefined, undefined, undefined);   // exactly ONE surface
        for (let i = 0; i < 5; i++) { svc.recordOutcome('dismissed'); } // 5 callbacks on that SAME surface
        expect(svc.isPaused()).toBe(false);   // only the first counted (1 strike), not 5 -> no pause
    });

    it('recordChatDismiss feeds the backoff even with no current surface (reloaded bubble)', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        for (let i = 0; i < 5; i++) { svc.recordChatDismiss(); }   // no surface shown beforehand
        expect(svc.isPaused()).toBe(true);
    });

    it('inbound active event → open/fetch session + badge + notification, capped after 3 actives', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);
        svc.onServerActive(7); svc.onServerActive(7); svc.onServerActive(7);
        expect(deps.clearInline).toHaveBeenCalled();   // active supersedes any standing inline cue (exclusive surface)
        expect(deps.openSession).toHaveBeenCalledTimes(3);
        expect(deps.openSession).toHaveBeenCalledWith(7);
        expect(deps.setBadge).toHaveBeenCalledTimes(3);
        expect(deps.showActiveNotification).toHaveBeenCalledTimes(3);
        svc.onServerActive(7);
        expect(deps.openSession).toHaveBeenCalledTimes(3);
        expect(deps.setBadge).toHaveBeenCalledTimes(3);
        expect(deps.showActiveNotification).toHaveBeenCalledTimes(3);
        expect(deps.showAmbient).toHaveBeenCalled();
    });

    it('inbound active event with a live anchor ALSO drops the inline breadcrumb (spec §6.1)', () => {
        const deps = fakeDeps({ isAnchorLive: () => true });
        const svc = new StruggleInterventionService(deps);
        svc.onServerActive(8, 'src/B.java', 84, 'check punctuation', 0.9);
        // the bubble still opens (active surface)...
        expect(deps.openSession).toHaveBeenCalledWith(8);
        expect(deps.showActiveNotification).toHaveBeenCalled();
        // ...AND the inline breadcrumb is rendered at the anchor (was dropped before the fix)...
        expect(deps.showInline).toHaveBeenCalledWith('src/B.java', 84, 'check punctuation', 'check punctuation');
        // ...and it clears any standing lamp (inline and lamp are exclusive surfaces, mirrors onServerAmbient).
        expect(deps.clearLamp).toHaveBeenCalled();
    });

    it('inbound active event without a live anchor renders no inline cue (clears any stale one)', () => {
        const deps = fakeDeps({ isAnchorLive: () => false });
        const svc = new StruggleInterventionService(deps);
        svc.onServerActive(8, 'src/B.java', 84, 'check punctuation', 0.9);
        expect(deps.showInline).not.toHaveBeenCalled();
        expect(deps.clearInline).toHaveBeenCalled();
        expect(deps.openSession).toHaveBeenCalledWith(8);
    });
});
