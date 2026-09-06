import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { StruggleEngineDeps } from '@extension/telemetry/contract';
import { createStruggleEngine } from '@extension/telemetry/index';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

/**
 * #364 Task 2 gave focus ownership on the REVEAL path to
 * `ChatWebviewProvider.revealProactiveSessionForExercise`, so `iris.intervention.inlineOpen` must not
 * focus the chat out from under a reveal that is still deciding whether to navigate.
 *
 * That rule covers the parked slot. It never covered the delivered one, where nothing is parked, the
 * hint is already a message in the chat, and the same inline cue is armed anyway -- there the command
 * has to bring the chat forward or the link dead-ends. `revealParkedHint` reports which case it is.
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

    /**
     * The handler decides asynchronously, so every assertion here has to run AFTER the reveal
     * promise settled. Awaiting the handler's own return value is not enough: it is registered as
     * a `() => void`, so vscode discards whatever it returns. Flushing the microtask queue is what
     * makes the observation honest -- without it this file asserts on a decision that has not been
     * taken yet and passes whatever the handler ends up doing.
     */
    const flush = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

    it('focuses the chat when nothing is parked, so the cue armed by an active hint leads somewhere', async () => {
        createStruggleEngine(fakeDeps());

        const handler = mocks.registeredCommands.get('iris.intervention.inlineOpen');
        expect(handler, 'iris.intervention.inlineOpen must be registered').toBeTruthy();

        mocks.executeCommand.mockClear(); // isolate: only observe what the click handler itself does
        handler?.();
        await flush();

        // A fresh engine has an empty slot, which is also the state after an ACTIVE delivery.
        expect(mocks.executeCommand).toHaveBeenCalledWith('iris.chatView.focus');
    });
});
