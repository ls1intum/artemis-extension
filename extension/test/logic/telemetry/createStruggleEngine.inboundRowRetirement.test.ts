import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { StruggleEngineDeps } from '@extension/telemetry/contract';
import { createStruggleEngine } from '@extension/telemetry/index';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

/**
 * #349 wave 3: frames dropped by the telemetry wrapper BEFORE the orchestrator (revoked
 * consent / inactive exercise) still have a server-persisted chat row; the wrapper must
 * retire that row (postRemoveMessage + best-effort durable delete with the FRAME's
 * exerciseId) or a post-revocation hint resurfaces via chat history.
 *
 * The vscode mock mirrors createStruggleEngine.proactiveLevel.test.ts, with ONE difference:
 * the `proactiveCodeEgress` config read is backed by a MUTABLE variable so tests can flip
 * consent (the ProactiveEgressConsent gate reads the config live on every access).
 */
const mockCfg = vi.hoisted(() => ({ egressLevel: 'enabled' as string }));

vi.mock('vscode', () => {
    class EventEmitter<T> {
        private readonly _listeners = new Set<(e: T) => void>();
        readonly event = (listener: (e: T) => void): { dispose(): void } => {
            this._listeners.add(listener);
            return { dispose: () => { this._listeners.delete(listener); } };
        };
        fire(data: T): void { for (const l of [...this._listeners]) { l(data); } }
        dispose(): void { this._listeners.clear(); }
    }
    class ThemeColor { constructor(public readonly id: string) {} }
    const disposable = () => ({ dispose: () => {} });
    return {
        EventEmitter,
        ThemeColor,
        Disposable: { from: (...items: { dispose(): void }[]) => ({ dispose: () => items.forEach(i => i.dispose()) }) },
        Uri: {
            parse: (v: string) => ({ scheme: '', authority: '', path: v, fsPath: v, toString: () => v }),
            joinPath: (base: { path: string }, ...segs: string[]) => {
                const path = [base.path, ...segs].join('/');
                return { path, fsPath: path, toString: () => path };
            },
        },
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
        StatusBarAlignment: { Left: 1, Right: 2 },
        window: {
            createStatusBarItem: () => ({ show: () => {}, hide: () => {}, dispose: () => {} }),
            createTextEditorDecorationType: () => ({ dispose: () => {} }),
            onDidChangeVisibleTextEditors: disposable,
            visibleTextEditors: [],
        },
        workspace: {
            getConfiguration: () => ({ get: (key: string, def: unknown) => key === 'proactiveCodeEgress' ? mockCfg.egressLevel : def }),
            onDidChangeConfiguration: disposable,
            onDidChangeTextDocument: disposable,
            workspaceFolders: undefined,
            textDocuments: [],
        },
        commands: {
            registerCommand: disposable,
            executeCommand: async () => undefined,
        },
    };
});

/** Full StruggleEngineDeps fake; also captures the struggle-topic frame callback so tests can inject frames. */
function fakeDeps(): { deps: StruggleEngineDeps; feedFrame: (data: unknown) => void } {
    let onFrame: ((data: unknown) => void) | undefined;
    const deps: StruggleEngineDeps = {
        hub: new TestSensorHub(),
        exerciseRegistry: new ExerciseRegistry(),
        isIrisEnabled: () => true,
        context: {
            subscriptions: [],
            globalStorageUri: { fsPath: '/tmp/artemis-test-struggle' },
            extensionUri: { path: '/ext', fsPath: '/ext' },
        } as unknown as StruggleEngineDeps['context'],
        postIntervention: vi.fn(async () => 'accepted' as const),
        isStudentProactiveOn: () => true,
        getProactiveLevel: () => 'more',
        openProactiveSession: vi.fn(async () => undefined),
        setProactiveBadge: vi.fn(),
        postOptimisticBubble: vi.fn(),
        postLiveEpisode: vi.fn(),
        revealAmbient: vi.fn(async () => ({}) as never),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        reconcileOptimisticBubble: vi.fn(),
        // #364: reveal navigation (behavior-preserving defaults; unused in this suite).
        resolveRevealTarget: () => ({ courseId: 1, title: 'Fake Exercise' }),
        currentNavToken: () => 0,
        openRevealSession: vi.fn(async () => true),
        notifyRevealUnavailable: vi.fn(),
        subscribeStruggleTopic: (_topic, cb) => { onFrame = cb; return { dispose: () => {} }; },
        cancelOutstandingStruggleJob: vi.fn(async () => undefined),
        foldEpisode: vi.fn(),
        postRemoveMessage: vi.fn(),
        deleteSupersededProactiveMessage: vi.fn(async () => undefined),
        showNudgeBanner: vi.fn(),
        hideNudgeBanner: vi.fn(),
        postOfferBubble: vi.fn(),
        resolveOfferBubble: vi.fn(),
        showOfferBanner: vi.fn(),
    };
    return { deps, feedFrame: (data) => { onFrame?.(data); } };
}

describe('telemetry wrapper: inbound drop paths retire the persisted chat row (#349 wave 3)', () => {
    beforeEach(() => { mockCfg.egressLevel = 'enabled'; });

    it('revoked-consent AMBIENT drop retires the row with the frame ids and forwards nothing', () => {
        const { deps, feedFrame } = fakeDeps();
        const handle = createStruggleEngine(deps);
        handle.coordinator.startExerciseSession(42);

        // Session start resets the badge (setProactiveBadge(false)); clear that so the
        // assertions below observe only what the FRAME caused.
        vi.mocked(deps.setProactiveBadge).mockClear();

        mockCfg.egressLevel = 'disabled'; // consent revoked mid-session
        feedFrame({ exerciseId: 42, kind: 'decide', action: 'ambient', episodeId: 'ep-1', message: 'secret hint', messageId: 77 });

        // Row retired with the FRAME's identifiers (identifiers only; no content anywhere).
        expect(deps.postRemoveMessage).toHaveBeenCalledWith(77);
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 77);
        // Nothing forwarded or surfaced: the orchestrator never saw the frame.
        expect(deps.setProactiveBadge).not.toHaveBeenCalled();
        expect(deps.postOptimisticBubble).not.toHaveBeenCalled();
        expect(deps.postLiveEpisode).not.toHaveBeenCalled();
        expect(deps.showNudgeBanner).not.toHaveBeenCalled();
    });

    it('inactive-exercise ACTIVE drop retires the row with the FRAME exerciseId, not the active one', () => {
        const { deps, feedFrame } = fakeDeps();
        const handle = createStruggleEngine(deps);
        handle.coordinator.startExerciseSession(7); // active exercise is 7; the frame is for 42
        vi.mocked(deps.setProactiveBadge).mockClear(); // session start resets the badge; observe only the frame

        feedFrame({ exerciseId: 42, kind: 'decide', action: 'active', episodeId: 'ep-2', sessionId: 5, message: 'late hint', messageId: 88 });

        expect(deps.postRemoveMessage).toHaveBeenCalledWith(88);
        // The durable delete MUST key on the frame's exercise (42): the inactive-exercise drop
        // is exactly the case where frame id and active id differ.
        expect(deps.deleteSupersededProactiveMessage).toHaveBeenCalledWith(42, 88);
        expect(deps.deleteSupersededProactiveMessage).not.toHaveBeenCalledWith(7, 88);
        expect(deps.setProactiveBadge).not.toHaveBeenCalled();
        expect(deps.postOptimisticBubble).not.toHaveBeenCalled();
        expect(deps.showNudgeBanner).not.toHaveBeenCalled();
    });

    it('a dropped frame WITHOUT a messageId retires nothing (no null-id calls)', () => {
        const { deps, feedFrame } = fakeDeps();
        const handle = createStruggleEngine(deps);
        handle.coordinator.startExerciseSession(7);

        // Inactive-exercise drop, but the server persisted no row (messageId absent -> null).
        feedFrame({ exerciseId: 42, kind: 'decide', action: 'ambient', episodeId: 'ep-3', message: 'hint' });

        expect(deps.postRemoveMessage).not.toHaveBeenCalled();
        expect(deps.deleteSupersededProactiveMessage).not.toHaveBeenCalled();
    });
});
