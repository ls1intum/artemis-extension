import { describe, expect, it, vi } from 'vitest';

import type { ProactiveLevel } from '@shared/messageContracts';

import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { StruggleEngineDeps } from '@extension/telemetry/contract';
import { createStruggleEngine } from '@extension/telemetry/index';
import { createStruggleEngine as createNoopStruggleEngine } from '@extension/telemetry/noop';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

/**
 * The full engine factory constructs a status-bar lamp, an inline decoration surface and the
 * struggle-detection grid timer, none of which are provided by vitest's minimal global `vscode`
 * stub (test/react/__helpers__/vscode.stub.ts). This local mock adds exactly the surface those
 * constructors touch synchronously, so `createStruggleEngine` builds the SAME real object graph
 * production does (only `getProactiveLevel`/the active-exercise source are faked).
 */
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
            getConfiguration: () => ({ get: (key: string, def: unknown) => key === 'proactiveCodeEgress' ? 'enabled' : def }),
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

/** A fully-formed `StruggleEngineDeps` fake; `getProactiveLevel` (now exercise-independent) is under test. */
function fakeDeps(getProactiveLevel: () => ProactiveLevel): StruggleEngineDeps {
    return {
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
        getProactiveLevel,
        openProactiveSession: vi.fn(async () => undefined),
        setProactiveBadge: vi.fn(),
        postOptimisticBubble: vi.fn(),
        postLiveEpisode: vi.fn(),
        revealAmbient: vi.fn(async () => ({}) as never),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        postRevealBubble: vi.fn(),
        reconcileOptimisticBubble: vi.fn(),
        subscribeStruggleTopic: () => ({ dispose: () => {} }),
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
}

describe('full struggle-engine seam: getActiveProactiveLevel', () => {
    it('reflects the single global level, independent of the active exercise (#341)', () => {
        const getProactiveLevel = vi.fn((): ProactiveLevel => 'less');
        const handle = createStruggleEngine(fakeDeps(getProactiveLevel));

        // No active exercise: the global level already applies (no per-exercise keying / 'more' gate).
        expect(handle.getActiveProactiveLevel()).toBe('less');

        // Starting/switching/ending a session does NOT re-key the level; it stays the global value.
        handle.coordinator.startExerciseSession(42);
        expect(handle.getActiveProactiveLevel()).toBe('less');
        handle.coordinator.startExerciseSession(7);
        expect(handle.getActiveProactiveLevel()).toBe('less');
        handle.coordinator.endExerciseSession();
        expect(handle.getActiveProactiveLevel()).toBe('less');

        // Every read passes NO exercise id (the strip removed the argument).
        for (const call of getProactiveLevel.mock.calls) { expect(call).toEqual([]); }
    });

    it('reads the level live on each call (mid-session flips take effect)', () => {
        let level: ProactiveLevel = 'more';
        const handle = createStruggleEngine(fakeDeps(() => level));
        handle.coordinator.startExerciseSession(42);
        expect(handle.getActiveProactiveLevel()).toBe('more');
        level = 'off';
        expect(handle.getActiveProactiveLevel()).toBe('off');
    });

    it('no-op build: always returns \'more\' (no engine, no active-exercise concept)', () => {
        const handle = createNoopStruggleEngine(fakeDeps(() => 'off'));
        expect(handle.getActiveProactiveLevel()).toBe('more');
    });
});
