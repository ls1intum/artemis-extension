import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import {
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
});
