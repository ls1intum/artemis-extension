import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { StruggleEngineDeps } from '@extension/telemetry/contract';
import { createStruggleEngine } from '@extension/telemetry/index';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

/**
 * #364 Task 2: focus ownership belongs to `ChatWebviewProvider.revealProactiveSessionForExercise`,
 * so the `iris.intervention.inlineOpen` command triggers the reveal WITHOUT focusing the chat itself.
 *
 * The vscode mock mirrors createStruggleEngine.proactiveLevel.test.ts, with one difference:
 * `commands.registerCommand` captures each handler by id (instead of just returning a
 * disposable) so the test can invoke the real `iris.intervention.inlineOpen` handler directly,
 * and `commands.executeCommand` is a spy so "was focus fired" is directly observable.
 */
const mocks = vi.hoisted(() => ({
    registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
    executeCommand: vi.fn(async () => undefined),
}));

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
            registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
                mocks.registeredCommands.set(id, handler);
                return disposable();
            },
            executeCommand: mocks.executeCommand,
        },
    };
});

/** A fully-formed `StruggleEngineDeps` fake; only the command wiring under test matters here. */
function fakeDeps(): StruggleEngineDeps {
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
        getProactiveLevel: () => 'more',
        openProactiveSession: vi.fn(async () => undefined),
        setProactiveBadge: vi.fn(),
        postOptimisticBubble: vi.fn(),
        postLiveEpisode: vi.fn(),
        revealAmbient: vi.fn(async () => ({}) as never),
        setEpisodeOutcome: vi.fn(async () => ({ applied: true })),
        reconcileOptimisticBubble: vi.fn(),
        // #364 reveal navigation: defaults, unused in this suite.
        resolveRevealTarget: () => ({ courseId: 1, title: 'Fake Exercise' }),
        currentNavToken: () => 0,
        openRevealSession: vi.fn(async () => true),
        notifyRevealUnavailable: vi.fn(),
        notifyRevealFailed: vi.fn(),
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

describe('createStruggleEngine: iris.intervention.inlineOpen focus ownership (#364 Task 2)', () => {
    beforeEach(() => {
        mocks.registeredCommands.clear();
        mocks.executeCommand.mockClear();
    });

    it('triggers the reveal but no longer focuses the chat view directly', () => {
        createStruggleEngine(fakeDeps());

        const handler = mocks.registeredCommands.get('iris.intervention.inlineOpen');
        expect(handler, 'iris.intervention.inlineOpen must be registered').toBeTruthy();

        mocks.executeCommand.mockClear(); // isolate: only observe what the click handler itself does
        handler?.();

        expect(mocks.executeCommand).not.toHaveBeenCalledWith('iris.chatView.focus');
    });
});
