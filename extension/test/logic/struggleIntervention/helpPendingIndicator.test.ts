/**
 * The chat's "Iris is preparing your hint" indicator. It is derived from the in-flight marker, so
 * these tests drive the real request and frame paths rather than assigning `_inFlightMarker`
 * directly: the fast-setup seam bypasses the notifying writer on purpose (see the NOTE in
 * slotDebugSnapshot.test.ts), so a direct assignment would never arm the indicator.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AlertRecord } from '@extension/services/struggle/types';
import { HELP_PENDING_DEADLINE_MS } from '@extension/services/struggleIntervention/helpPendingIndicator';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';

import { fakeDeps, simulateDelivered } from './helpers';

/** A hard-boundary alert that gets past the gates, so `deliver` really reaches the decide POST. */
function alert(): AlertRecord {
    return {
        kind: 'edit', t: 610, ts: 610_000, urgency: 0.9,
        typesPreGate: ['FM'], types: ['FM'], primary: 'FM', path: 'e6', inWarmup: false, inGrace: false,
    };
}

type Thinking = ReturnType<typeof vi.fn>;

function thinkingCalls(deps: StruggleInterventionDeps): boolean[] {
    return (deps.setProactiveThinking as unknown as Thinking).mock.calls.map(c => c[0] as boolean);
}

/** A delivered episode with an outstanding stuck offer, i.e. the state a "Show me" click starts from. */
function deliveredWithOffer(deps: StruggleInterventionDeps, episodeId = 'ep-1'): StruggleInterventionService {
    const svc = new StruggleInterventionService(deps);
    simulateDelivered(svc, episodeId);
    svc._outstandingOffer = { offerId: 'off-1', episodeId, moment: 'stuck' };
    (deps.setProactiveThinking as unknown as Thinking).mockClear();
    return svc;
}

describe('help-pending indicator: turning it on', () => {
    it('an accepted offer claims the indicator before the file collection resolves', async () => {
        // Never resolves: the indicator must already be on while the egress is still gathering files.
        const deps = fakeDeps({ collectFiles: vi.fn(() => new Promise<never>(() => { })) });
        const svc = deliveredWithOffer(deps);

        svc.acceptOffer('off-1', 'ep-1');
        await Promise.resolve();

        expect(thinkingCalls(deps)).toEqual([true]);
    });

    it('"I need more help" claims it too, not just the Moment-1 accept', async () => {
        const deps = fakeDeps({ collectFiles: vi.fn(() => new Promise<never>(() => { })) });
        const svc = new StruggleInterventionService(deps);
        simulateDelivered(svc, 'ep-2');
        svc._outstandingOffer = { offerId: 'off-2', episodeId: 'ep-2', moment: 'abandon' };
        (deps.setProactiveThinking as unknown as Thinking).mockClear();

        svc.needMoreHelp('off-2', 'ep-2');
        await Promise.resolve();

        expect(thinkingCalls(deps)).toEqual([true]);
    });

    it('the automatic decide POST never claims it: passive detection stays invisible', async () => {
        // A REAL alert, not simulateDelivered: that helper assigns the marker through the fast-setup
        // seam, which bypasses the notifying writer, so it could not tell a working gate from a
        // broken one. This drives the production decide path end to end.
        const deps = fakeDeps({ collectFiles: vi.fn(() => new Promise<never>(() => { })) });
        const svc = new StruggleInterventionService(deps);

        svc.deliver(alert());
        await Promise.resolve();
        await Promise.resolve();

        expect(svc._inFlightMarker?.intent).toBe('decide');
        expect(thinkingCalls(deps)).not.toContain(true);
    });
});

describe('help-pending indicator: the paths that never send', () => {
    it('a blocked egress gate leaves it off and gives the honest note instead', async () => {
        const deps = fakeDeps({ isEgressEnabled: () => true });
        const svc = deliveredWithOffer(deps, 'ep-gate');
        // Flip the gate only now: the delivery above needs a working egress.
        deps.isStudentProactiveOn = () => false;

        svc.acceptOffer('off-1', 'ep-gate');
        await Promise.resolve();

        expect(thinkingCalls(deps)).not.toContain(true);
        expect(deps.postBubble).toHaveBeenCalledWith('Nothing more I can add right now.', null, 'ep-gate');
    });

    it('a missing exercise id leaves it off', async () => {
        const deps = fakeDeps();
        const svc = deliveredWithOffer(deps, 'ep-noex');
        deps.getExerciseId = () => undefined;

        svc.acceptOffer('off-1', 'ep-noex');
        await Promise.resolve();

        expect(thinkingCalls(deps)).not.toContain(true);
    });

    it('an accept with no live signal leaves it off', async () => {
        const deps = fakeDeps();
        const svc = deliveredWithOffer(deps, 'ep-nosig');
        svc._lastSignal = undefined;

        svc.acceptOffer('off-1', 'ep-nosig');
        await Promise.resolve();

        expect(thinkingCalls(deps)).not.toContain(true);
    });
});

describe('help-pending indicator: every way it is released', () => {
    /** Accept an offer and leave the request in flight, so the release path can be driven. */
    async function inFlight(deps: StruggleInterventionDeps, episodeId: string): Promise<StruggleInterventionService> {
        const svc = deliveredWithOffer(deps, episodeId);
        svc.acceptOffer('off-1', episodeId);
        await Promise.resolve();
        await Promise.resolve();
        expect(thinkingCalls(deps)).toEqual([true]);
        return svc;
    }

    it('the hint arriving releases it', async () => {
        const deps = fakeDeps();
        const svc = await inFlight(deps, 'ep-hint');

        svc.onServerActive('ep-hint', 1, undefined, undefined, undefined, 0.9, 'the next step', 200);
        await Promise.resolve();

        expect(thinkingCalls(deps)).toEqual([true, false]);
    });

    it('a silent reply releases it', async () => {
        const deps = fakeDeps();
        const svc = await inFlight(deps, 'ep-silent');

        svc.onServerSilent('ep-silent', undefined);

        expect(thinkingCalls(deps)).toEqual([true, false]);
    });

    it('consent revocation releases it', async () => {
        const deps = fakeDeps();
        const svc = await inFlight(deps, 'ep-consent');

        svc.onConsentRevoked();

        expect(thinkingCalls(deps).at(-1)).toBe(false);
    });

    it('the surface reset releases it', async () => {
        const deps = fakeDeps();
        const svc = await inFlight(deps, 'ep-reset');

        svc.reset();

        expect(thinkingCalls(deps).at(-1)).toBe(false);
    });

    it('a failed POST releases it without waiting for a reply that will never come', async () => {
        const deps = fakeDeps({ postIntervention: vi.fn(async () => 'failed' as const) });
        const svc = deliveredWithOffer(deps, 'ep-rej');

        svc.acceptOffer('off-1', 'ep-rej');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(thinkingCalls(deps)).toEqual([true, false]);
    });
});

describe('opting out mid-flight', () => {
    /** A "Show me" whose file collection is still running, i.e. nothing is on the wire yet. */
    function collecting(episodeId: string): { deps: StruggleInterventionDeps; svc: StruggleInterventionService; finish: (files: Record<string, string>) => void } {
        let release: ((files: Record<string, string>) => void) | undefined;
        const deps = fakeDeps({ collectFiles: vi.fn(() => new Promise<Record<string, string>>(r => { release = r; })) });
        const svc = deliveredWithOffer(deps, episodeId);
        svc.acceptOffer('off-1', episodeId);
        return { deps, svc, finish: (files) => release?.(files) };
    }

    it('switching proactivity Off stops the chat claiming that Iris is working', async () => {
        const { deps, svc } = collecting('ep-off');
        await Promise.resolve();
        expect(thinkingCalls(deps)).toEqual([true]);

        svc.setStudentProactive(42, false);

        expect(thinkingCalls(deps)).toEqual([true, false]);
        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('nothing collected before the opt-out reaches the wire afterwards', async () => {
        const { deps, svc, finish } = collecting('ep-off2');
        await Promise.resolve();

        svc.setStudentProactive(42, false);
        finish({ 'src/Secret.java': 'class Secret {}' });
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postIntervention).not.toHaveBeenCalled();
    });

    it('proactivity going Off during the collection aborts the POST on its own', async () => {
        // Not via setStudentProactive: that also clears the marker, so the token check would abort
        // anyway. Flipping only the level leaves the marker intact and isolates the egress guard.
        const { deps, finish } = collecting('ep-lvl');
        await Promise.resolve();

        deps.isStudentProactiveOn = () => false;
        finish({ 'src/Secret.java': 'class Secret {}' });
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postIntervention).not.toHaveBeenCalled();
    });

    it('Iris being disabled during the collection aborts the POST', async () => {
        const { deps, finish } = collecting('ep-iris');
        await Promise.resolve();

        deps.isIrisEnabled = () => false;
        finish({ 'src/Secret.java': 'class Secret {}' });
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postIntervention).not.toHaveBeenCalled();
    });

    it('a .noai marker appearing during the collection aborts the POST too', async () => {
        const { deps, finish } = collecting('ep-noai');
        await Promise.resolve();

        deps.hasNoaiMarker = () => true;
        finish({ 'src/Secret.java': 'class Secret {}' });
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postIntervention).not.toHaveBeenCalled();
    });

    it('an untouched collection still posts, so the guard is not simply refusing everything', async () => {
        const { deps, finish } = collecting('ep-ok');
        await Promise.resolve();

        finish({ 'src/A.java': 'class A {}' });
        await Promise.resolve();
        await Promise.resolve();

        expect(deps.postIntervention).toHaveBeenCalledOnce();
    });
});

describe('a closed gate tears its own request down', () => {
    /**
     * Before the post-collection gate widened, the only way to fail it was a consent revoke, which
     * clears the marker through its own path. `.noai` and Iris-disabled have no such path, so a bare
     * return would leave the wire busy forever and the chat claiming Iris is still working.
     */
    function collecting(episodeId: string): { deps: StruggleInterventionDeps; svc: StruggleInterventionService; finish: () => void } {
        let release: ((files: Record<string, string>) => void) | undefined;
        const deps = fakeDeps({ collectFiles: vi.fn(() => new Promise<Record<string, string>>(r => { release = r; })) });
        const svc = deliveredWithOffer(deps, episodeId);
        svc.acceptOffer('off-1', episodeId);
        return { deps, svc, finish: () => release?.({ 'src/A.java': 'class A {}' }) };
    }

    it('a .noai marker appearing frees the wire instead of stranding it', async () => {
        const { deps, svc, finish } = collecting('ep-strand');
        await Promise.resolve();

        deps.hasNoaiMarker = () => true;
        finish();
        await Promise.resolve();
        await Promise.resolve();

        expect(svc._inFlightMarker).toBeUndefined();
        expect(thinkingCalls(deps)).toEqual([true, false]);
    });

    it('Iris being disabled frees the wire too', async () => {
        const { deps, svc, finish } = collecting('ep-strand2');
        await Promise.resolve();

        deps.isIrisEnabled = () => false;
        finish();
        await Promise.resolve();
        await Promise.resolve();

        expect(svc._inFlightMarker).toBeUndefined();
    });

    it('a superseded request never clears the marker that overtook it', async () => {
        const { deps, svc, finish } = collecting('ep-super2');
        await Promise.resolve();

        // Somebody else owns the wire now. Our stale continuation must leave it alone, even though
        // the gate it is about to check is closed.
        deps.hasNoaiMarker = () => true;
        svc._inFlightMarker = { ...svc._inFlightMarker!, requestToken: 'someone-elses' };
        finish();
        await Promise.resolve();
        await Promise.resolve();

        expect(svc._inFlightMarker?.requestToken).toBe('someone-elses');
    });
});

describe('opting out while a request is already on the server', () => {
    it('Off cancels the server job, so a later re-enable cannot inherit its reply', async () => {
        // The reply carries episode identity, not the client request token, so an abandoned job
        // whose answer arrives after Off -> On -> new request would be consumed as the new one's.
        const deps = fakeDeps();
        const svc = deliveredWithOffer(deps, 'ep-cancel');
        svc.acceptOffer('off-1', 'ep-cancel');
        await Promise.resolve();
        await Promise.resolve();
        const token = svc._inFlightMarker?.requestToken;
        expect(token).toBeDefined();

        svc.setStudentProactive(42, false);

        expect(deps.cancelOutstandingStruggleJob).toHaveBeenCalledWith(42, token);
    });

    it('cancels nothing when nothing is on the wire', () => {
        const deps = fakeDeps();
        const svc = new StruggleInterventionService(deps);

        svc.setStudentProactive(42, false);

        expect(deps.cancelOutstandingStruggleJob).not.toHaveBeenCalled();
    });
});

describe('help-pending indicator: the deadline', () => {
    /** Capture what the service schedules instead of running it, so the deadline can be fired by hand. */
    function capturingDeps(): { deps: StruggleInterventionDeps; fire: () => void; delays: number[] } {
        const scheduled: (() => void)[] = [];
        const delays: number[] = [];
        const deps = fakeDeps({
            setTimeoutFn: vi.fn((fn: () => void, ms: number) => { scheduled.push(fn); delays.push(ms); }),
        });
        return { deps, fire: () => scheduled.forEach(fn => fn()), delays };
    }

    it('stops claiming Iris is working and says so, after the deadline', async () => {
        const { deps, fire, delays } = capturingDeps();
        const svc = deliveredWithOffer(deps, 'ep-dead');

        svc.acceptOffer('off-1', 'ep-dead');
        await Promise.resolve();
        expect(delays).toContain(HELP_PENDING_DEADLINE_MS);

        fire();

        expect(thinkingCalls(deps)).toEqual([true, false]);
        expect(deps.postBubble).toHaveBeenCalledWith('Nothing more I can add right now.', null, 'ep-dead');
    });

    it('does not clear the in-flight marker, so a late reply is still attributed', async () => {
        const { deps, fire } = capturingDeps();
        const svc = deliveredWithOffer(deps, 'ep-late');

        svc.acceptOffer('off-1', 'ep-late');
        await Promise.resolve();
        await Promise.resolve();
        fire();

        expect(svc._inFlightMarker?.intent).toBe('help_request');
    });

    it('a superseded deadline is inert: the reply already released the indicator', async () => {
        const { deps, fire } = capturingDeps();
        const svc = deliveredWithOffer(deps, 'ep-super');

        svc.acceptOffer('off-1', 'ep-super');
        await Promise.resolve();
        await Promise.resolve();
        svc.onServerActive('ep-super', 1, undefined, undefined, undefined, 0.9, 'the next step', 201);
        await Promise.resolve();
        (deps.postBubble as unknown as Thinking).mockClear();

        fire();

        expect(thinkingCalls(deps)).toEqual([true, false]);
        expect(deps.postBubble).not.toHaveBeenCalled();
    });
});
