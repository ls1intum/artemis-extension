import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import {
    buildChatProviderSink,
    wireWorkspaceDetection,
    type WorkspaceDetectionSink,
    type WorkspaceRegisterInput,
} from '@extension/services/workspace/wireWorkspaceDetection';
import * as detectionModule from '@extension/services/workspace/workspaceDetectionService';

function makeSinkSpy(): WorkspaceDetectionSink & {
    _register: sinon.SinonSpy<[WorkspaceRegisterInput], void>;
    _clear: sinon.SinonSpy<[], void>;
} {
    const _register = sinon.spy<(input: WorkspaceRegisterInput) => void>(() => undefined);
    const _clear = sinon.spy<() => void>(() => undefined);
    return {
        registerWorkspaceExercise: _register,
        clearWorkspaceExercise: _clear,
        _register, _clear,
    };
}

suite('wireWorkspaceDetection', () => {
    let sandbox: sinon.SinonSandbox;
    let detectStub: sinon.SinonStub;
    let folderEmitter: vscode.EventEmitter<vscode.WorkspaceFoldersChangeEvent>;
    let coursesEmitter: vscode.EventEmitter<unknown>;
    let courseDataCache: CourseDataCache;
    let registry: ExerciseRegistry;

    setup(() => {
        sandbox = sinon.createSandbox();
        detectStub = sandbox.stub(detectionModule, 'detectAndRegisterWorkspaceExercise').resolves();
        folderEmitter = new vscode.EventEmitter<vscode.WorkspaceFoldersChangeEvent>();
        coursesEmitter = new vscode.EventEmitter<unknown>();
        sandbox.stub(vscode.workspace, 'onDidChangeWorkspaceFolders').callsFake(listener => folderEmitter.event(listener));
        courseDataCache = { onCoursesLoaded: coursesEmitter.event } as unknown as CourseDataCache;
        registry = {} as ExerciseRegistry;
    });

    teardown(() => {
        sandbox.restore();
        folderEmitter.dispose();
        coursesEmitter.dispose();
    });

    test('initial detection runs once at wiring time', async () => {
        const sink = makeSinkSpy();
        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();
        assert.strictEqual(detectStub.callCount, 1);
        disposable.dispose();
    });

    test('onDidChangeWorkspaceFolders event triggers re-detection', async () => {
        const sink = makeSinkSpy();
        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();
        detectStub.resetHistory();
        folderEmitter.fire({ added: [], removed: [] });
        await Promise.resolve();
        assert.strictEqual(detectStub.callCount, 1);
        disposable.dispose();
    });

    test('courseDataCache.onCoursesLoaded event triggers re-detection', async () => {
        const sink = makeSinkSpy();
        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();
        detectStub.resetHistory();
        coursesEmitter.fire(undefined);
        await Promise.resolve();
        assert.strictEqual(detectStub.callCount, 1);
        disposable.dispose();
    });

    test('generation guard: stale registerExercise from older detection is a no-op', async () => {
        const sink = makeSinkSpy();
        let resolveA!: () => void;
        let resolveB!: () => void;
        const capturedCallbacks: Array<{
            registerExercise: (input: WorkspaceRegisterInput) => void;
            clearStaleWorkspaceContext: () => void;
        }> = [];
        detectStub.callsFake(async (_api: unknown, cb: typeof capturedCallbacks[number]) => {
            capturedCallbacks.push(cb);
            if (capturedCallbacks.length === 1) {await new Promise<void>(r => { resolveA = r; });}
            else {await new Promise<void>(r => { resolveB = r; });}
        });

        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();          // schedule detection A
        folderEmitter.fire({ added: [], removed: [] });
        await Promise.resolve();          // schedule detection B (A still pending)

        // A finishes late; its callback must be a no-op.
        capturedCallbacks[0].registerExercise({
            id: 1, title: 'Stale', source: 'workspace-detected', isWorkspace: true,
        });
        // B finishes normally.
        capturedCallbacks[1].registerExercise({
            id: 2, title: 'Fresh', source: 'workspace-detected', isWorkspace: true,
        });

        resolveA(); resolveB();
        await Promise.resolve();

        assert.strictEqual(sink._register.callCount, 1, 'only fresh detection should reach sink');
        assert.strictEqual(sink._register.firstCall.args[0].id, 2);
        disposable.dispose();
    });

    test('generation guard: stale clearWorkspaceExercise from older detection is a no-op', async () => {
        const sink = makeSinkSpy();
        let resolveA!: () => void;
        let resolveB!: () => void;
        const capturedCallbacks: Array<{
            registerExercise: (input: WorkspaceRegisterInput) => void;
            clearStaleWorkspaceContext: () => void;
        }> = [];
        detectStub.callsFake(async (_api: unknown, cb: typeof capturedCallbacks[number]) => {
            capturedCallbacks.push(cb);
            if (capturedCallbacks.length === 1) {await new Promise<void>(r => { resolveA = r; });}
            else {await new Promise<void>(r => { resolveB = r; });}
        });

        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();
        folderEmitter.fire({ added: [], removed: [] });
        await Promise.resolve();

        capturedCallbacks[0].clearStaleWorkspaceContext();   // stale, must be no-op
        capturedCallbacks[1].clearStaleWorkspaceContext();   // fresh

        resolveA(); resolveB();
        await Promise.resolve();

        assert.strictEqual(sink._clear.callCount, 1, 'only fresh detection should reach sink');
        disposable.dispose();
    });

    test('dispose guard: callbacks after dispose are no-ops', async () => {
        const sink = makeSinkSpy();
        let resolve!: () => void;
        let captured!: {
            registerExercise: (input: WorkspaceRegisterInput) => void;
            clearStaleWorkspaceContext: () => void;
        };
        detectStub.callsFake(async (_api: unknown, cb: typeof captured) => {
            captured = cb;
            await new Promise<void>(r => { resolve = r; });
        });

        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();          // detection in flight
        disposable.dispose();

        captured.registerExercise({ id: 1, title: 'X', source: 'workspace-detected', isWorkspace: true });
        captured.clearStaleWorkspaceContext();
        resolve();
        await Promise.resolve();

        assert.strictEqual(sink._register.callCount, 0);
        assert.strictEqual(sink._clear.callCount, 0);
    });

    test('dispose unsubscribes both event listeners: later folder/courses events do not re-trigger detection', async () => {
        const sink = makeSinkSpy();
        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();
        disposable.dispose();
        detectStub.resetHistory();
        folderEmitter.fire({ added: [], removed: [] });
        coursesEmitter.fire(undefined);
        await Promise.resolve();
        assert.strictEqual(detectStub.callCount, 0);
    });

    test('no-match path invokes sink.clearWorkspaceExercise exactly once per detection', async () => {
        const sink = makeSinkSpy();
        detectStub.callsFake(async (_api: unknown, cb: { clearStaleWorkspaceContext: () => void }) => {
            cb.clearStaleWorkspaceContext();
        });
        const disposable = wireWorkspaceDetection({ api: undefined, registry, courseDataCache, sink });
        await Promise.resolve();
        assert.strictEqual(sink._clear.callCount, 1);
        assert.strictEqual(sink._register.callCount, 0);
        disposable.dispose();
    });

    test('publishes every settled outcome, including the one from activation', async () => {
        detectStub.resolves({ kind: 'matched', exerciseId: 42, courseId: 9 });
        const seen: unknown[] = [];

        const handle = wireWorkspaceDetection({
            api: undefined, registry, courseDataCache, sink: makeSinkSpy(),
        });
        handle.onDetectionSettled(outcome => seen.push(outcome));
        await Promise.resolve();
        await Promise.resolve();

        detectStub.resolves({ kind: 'no-match' });
        handle.retry();
        await Promise.resolve();
        await Promise.resolve();

        assert.deepStrictEqual(seen, [
            { kind: 'matched', exerciseId: 42, courseId: 9 },
            { kind: 'no-match' },
        ]);
        handle.dispose();
    });

    test('a superseded run cannot emit its late result', async () => {
        let resolveFirst: (o: unknown) => void = () => undefined;
        detectStub.onFirstCall().returns(new Promise(res => { resolveFirst = res; }));
        detectStub.onSecondCall().resolves({ kind: 'no-match' });

        const handle = wireWorkspaceDetection({
            api: undefined, registry, courseDataCache, sink: makeSinkSpy(),
        });
        const seen: unknown[] = [];
        handle.onDetectionSettled(outcome => seen.push(outcome));

        handle.retry();
        await Promise.resolve();
        await Promise.resolve();
        resolveFirst({ kind: 'matched', exerciseId: 1, courseId: 2 });
        await Promise.resolve();
        await Promise.resolve();

        assert.deepStrictEqual(seen, [{ kind: 'no-match' }],
            'the superseded activation run must not emit after a newer one settled');
        handle.dispose();
    });
});

suite('buildChatProviderSink', () => {
    test('registerWorkspaceExercise delegates to the provider method', () => {
        const provider = {
            registerWorkspaceExercise: sinon.spy(),
            clearWorkspaceExercise: sinon.spy(),
        };
        const sink = buildChatProviderSink(provider);
        const input = { id: 1, title: 'X', source: 'workspace-detected' as const, isWorkspace: true as const };
        sink.registerWorkspaceExercise(input);
        assert.ok((provider.registerWorkspaceExercise as sinon.SinonSpy).calledOnceWith(input));
    });

    test('clearWorkspaceExercise delegates to the provider method', () => {
        const provider = {
            registerWorkspaceExercise: sinon.spy(),
            clearWorkspaceExercise: sinon.spy(),
        };
        const sink = buildChatProviderSink(provider);
        sink.clearWorkspaceExercise();
        assert.ok((provider.clearWorkspaceExercise as sinon.SinonSpy).calledOnce);
    });
});
