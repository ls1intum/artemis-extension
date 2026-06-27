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
});
