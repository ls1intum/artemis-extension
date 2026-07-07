/**
 * Shared test helpers for the struggleIntervention logic-test suite.
 * Extracted from C8-dismissEpisode.test.ts (C1) so later tasks can reuse them.
 */
import { vi } from 'vitest';

import type { PendingStamp } from '@extension/services/struggleIntervention/slot/guard';
import type { StruggleInterventionDeps } from '@extension/services/struggleIntervention/struggleInterventionService';
import { StruggleInterventionService } from '@extension/services/struggleIntervention/struggleInterventionService';
import type { IrisChatMessage } from '@extension/types';

export function fakeDeps(over: Partial<StruggleInterventionDeps> = {}): StruggleInterventionDeps {
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
        postBubble: vi.fn(),
        setChatLiveEpisode: vi.fn(),
        log: { record: vi.fn(async () => undefined) } as unknown as StruggleInterventionDeps['log'],
        setTimeoutFn: vi.fn(),
        generateLocalId: () => 'test-local-id',
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        revealAmbient: vi.fn(async () => ({
            id: 7,
            sentAt: '2024-01-01T00:00:00Z',
            proactiveEpisodeId: 'ep-server',
        } as IrisChatMessage)),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        cancelOutstandingStruggleJob: vi.fn(async () => undefined),
        foldEpisode: vi.fn(),
        postRemoveMessage: vi.fn(),
        deleteSupersededProactiveMessage: vi.fn(async () => undefined),
        ...over,
    };
}

/** Drive the service into DELIVERED state (simulates a full active-push cycle). */
export function simulateDelivered(svc: StruggleInterventionService, episodeId = 'ep-1'): void {
    const gen = svc._slot.generation();
    const requestToken = 'tok-1';
    const stamp: PendingStamp = { episodeId, generation: gen, hardEvent: true, requestToken };
    const localToken = svc._guard.issue('decide', stamp);
    svc._inFlightMarker = { requestToken, episodeId, generation: gen, intent: 'decide', localToken };
    svc._candidate = { episodeId, hints: [], createdAtMs: 0 };
    // Simulate an active server response, which takes the slot and sets delivered
    svc.onServerActive(1, undefined, undefined, undefined, 0.9, 'hint text', 99);
    svc._lastSignal = {} as never;
}
