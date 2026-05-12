import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ProblemStatementRenderService } from '../../../src/extension/services/problemStatementRenderService';
import type { ArtemisApiService } from '../../../src/extension/api/artemisApi';
import type { RenderedProblemStatementDTO, ProblemStatementRenderRequest } from '../../../src/extension/domain/problemStatementRendering';

suite('ProblemStatementRenderService', () => {
    let sandbox: sinon.SinonSandbox;
    let renderStub: sinon.SinonStub;
    let configChangeCallbacks: Array<(e: vscode.ConfigurationChangeEvent) => void>;
    let configListenerDisposed: boolean;
    let service: ProblemStatementRenderService;

    function mockExercise(overrides: { id?: number; problemStatement?: string } = {}): { id?: number; problemStatement?: string } {
        return {
            id: 42,
            problemStatement: '# Exercise\n\nSolve it.',
            ...overrides,
        };
    }

    function mockDto(overrides: Partial<RenderedProblemStatementDTO> = {}): RenderedProblemStatementDTO {
        return {
            html: '<html><body><p>Solve it.</p></body></html>',
            contentHash: 'abc123def',
            rendererVersion: '1.0.0',
            ...overrides,
        };
    }

    function configChangeEvent(affects: boolean): vscode.ConfigurationChangeEvent {
        return { affectsConfiguration: () => affects };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        configChangeCallbacks = [];
        configListenerDisposed = false;

        renderStub = sandbox.stub<[ProblemStatementRenderRequest], Promise<RenderedProblemStatementDTO>>();
        const apiStub = { renderProblemStatement: renderStub } as unknown as ArtemisApiService;

        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (_key: string) => 'https://artemis.example.com',
        } as unknown as vscode.WorkspaceConfiguration);

        sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').callsFake((cb) => {
            configChangeCallbacks.push(cb);
            return { dispose: () => { configListenerDisposed = true; } } as vscode.Disposable;
        });

        sandbox.stub(vscode.window, 'activeColorTheme').value({ kind: vscode.ColorThemeKind.Light });

        service = new ProblemStatementRenderService(apiStub);
    });

    teardown(() => {
        service.dispose();
        sandbox.restore();
    });

    test('returns undefined when problemStatement is empty', async () => {
        const result = await service.render(mockExercise({ problemStatement: '' }));
        assert.strictEqual(result, undefined);
        assert.strictEqual(renderStub.callCount, 0);
    });

    test('returns undefined when exercise id is missing', async () => {
        const result = await service.render(mockExercise({ id: undefined }));
        assert.strictEqual(result, undefined);
        assert.strictEqual(renderStub.callCount, 0);
    });

    test('calls api with includeJs:false, inlineImages:true, locale en', async () => {
        renderStub.resolves(mockDto());
        await service.render(mockExercise());
        assert.strictEqual(renderStub.callCount, 1);
        const req = renderStub.firstCall.args[0];
        assert.strictEqual(req.includeJs, false);
        assert.strictEqual(req.inlineImages, true);
        assert.strictEqual(req.locale, 'en');
        assert.strictEqual(req.markdown, '# Exercise\n\nSolve it.');
    });

    test('passes darkModeOverride to request', async () => {
        renderStub.resolves(mockDto());
        await service.render(mockExercise(), { darkModeOverride: true });
        assert.strictEqual(renderStub.firstCall.args[0].darkMode, true);

        renderStub.resetHistory();
        await service.render(mockExercise(), { darkModeOverride: false });
        assert.strictEqual(renderStub.firstCall.args[0].darkMode, false);
    });

    test('rewrites relative src URLs against configured server URL', async () => {
        renderStub.resolves(mockDto({ html: '<img src="/api/files/foo.png"> <img src="https://other/x.png">' }));
        const result = await service.render(mockExercise());
        assert.ok(result);
        assert.ok(result.html.includes('src="https://artemis.example.com/api/files/foo.png"'));
        // Absolute URLs are left alone
        assert.ok(result.html.includes('src="https://other/x.png"'));
    });

    test('caches result for identical input — no second API call', async () => {
        renderStub.resolves(mockDto());
        await service.render(mockExercise());
        await service.render(mockExercise());
        assert.strictEqual(renderStub.callCount, 1);
    });

    test('re-renders when darkMode changes', async () => {
        renderStub.resolves(mockDto());
        await service.render(mockExercise(), { darkModeOverride: false });
        await service.render(mockExercise(), { darkModeOverride: true });
        assert.strictEqual(renderStub.callCount, 2);
    });

    test('disables server rendering after 404 and short-circuits subsequent calls', async () => {
        renderStub.onFirstCall().rejects(Object.assign(new Error('not found'), { status: 404 }));
        const first = await service.render(mockExercise());
        assert.strictEqual(first, undefined);

        // Subsequent call must not hit the API
        const second = await service.render(mockExercise());
        assert.strictEqual(second, undefined);
        assert.strictEqual(renderStub.callCount, 1);
    });

    test('treats 405 and 501 as unsupported-server signals', async () => {
        renderStub.onFirstCall().rejects(Object.assign(new Error(), { status: 405 }));
        await service.render(mockExercise());
        const second = await service.render(mockExercise());
        assert.strictEqual(second, undefined);
        assert.strictEqual(renderStub.callCount, 1);

        // Reset
        service.invalidateAll();
        configChangeCallbacks.forEach(cb => cb(configChangeEvent(true)));

        renderStub.onCall(1).rejects(Object.assign(new Error(), { status: 501 }));
        await service.render(mockExercise());
        await service.render(mockExercise());
        assert.strictEqual(renderStub.callCount, 2);
    });

    test('does NOT disable server on transient (500) failure — retries on next call', async () => {
        renderStub.onFirstCall().rejects(Object.assign(new Error(), { status: 500 }));
        renderStub.onSecondCall().resolves(mockDto());

        const first = await service.render(mockExercise());
        assert.strictEqual(first, undefined);

        const second = await service.render(mockExercise());
        assert.ok(second, 'should retry and succeed');
        assert.strictEqual(renderStub.callCount, 2);
    });

    test('invalidateAll clears the cache so next render hits the API', async () => {
        renderStub.resolves(mockDto());
        await service.render(mockExercise());
        service.invalidateAll();
        await service.render(mockExercise());
        assert.strictEqual(renderStub.callCount, 2);
    });

    test('config change for server URL clears cache and re-enables server', async () => {
        // Disable via 404
        renderStub.onFirstCall().rejects(Object.assign(new Error(), { status: 404 }));
        await service.render(mockExercise());
        assert.strictEqual(renderStub.callCount, 1);

        // Fire config change targeting the server URL
        configChangeCallbacks.forEach(cb => cb(configChangeEvent(true)));

        // Server should now be re-enabled and next render hits API
        renderStub.onCall(1).resolves(mockDto());
        const result = await service.render(mockExercise());
        assert.ok(result);
        assert.strictEqual(renderStub.callCount, 2);
    });

    test('config change for unrelated key does not clear cache', async () => {
        renderStub.resolves(mockDto());
        await service.render(mockExercise());

        configChangeCallbacks.forEach(cb => cb(configChangeEvent(false)));

        await service.render(mockExercise());
        assert.strictEqual(renderStub.callCount, 1, 'cache should still serve');
    });

    test('dispose() disposes the config change listener', () => {
        assert.strictEqual(configListenerDisposed, false);
        service.dispose();
        assert.strictEqual(configListenerDisposed, true);
    });

    test('maps participation feedbacks into testResults (extractLatestFeedbacks integration)', async () => {
        renderStub.resolves(mockDto());
        const exercise = mockExercise();
        const participation = {
            submissions: [
                {
                    id: 1,
                    results: [
                        { id: 10, feedbacks: [{ testCase: { id: 99, testName: 'old' }, positive: true }] },
                    ],
                },
                {
                    id: 2,
                    results: [
                        { id: 20, feedbacks: [{ testCase: { id: 100, testName: 'newest' }, positive: false, detailText: 'fail msg' }] },
                        { id: 21, feedbacks: [{ testCase: { id: 101, testName: 'newer' }, positive: true }] },
                    ],
                },
            ],
        };
        await service.render(exercise, { participation });
        const sent = renderStub.firstCall.args[0];
        assert.deepStrictEqual(sent.testResults, [
            { testId: 101, testName: 'newer', passed: true, message: undefined, credits: undefined },
        ]);
    });

    test('mapper enforces backend validation constraints (max length, dedupe, cap)', async () => {
        renderStub.resolves(mockDto());
        const longName = 'x'.repeat(600);
        const longMsg = 'y'.repeat(6000);
        const feedbacks = [
            { testCase: { id: 1, testName: longName }, positive: true, detailText: longMsg },
            { testCase: { id: 1, testName: 'dup' }, positive: false },
            ...Array.from({ length: 150 }, (_, i) => ({ testCase: { id: i + 2 }, positive: true })),
        ];
        const participation = { submissions: [{ id: 1, results: [{ id: 10, feedbacks }] }] };
        await service.render(mockExercise(), { participation });
        const sent = renderStub.firstCall.args[0];
        const testResults = sent.testResults!;
        assert.strictEqual(testResults.length, 100, 'cap at MAX_TEST_RESULTS');
        assert.strictEqual(testResults[0].testName.length, 500, 'testName clamped');
        assert.strictEqual(testResults[0].message!.length, 5000, 'message clamped');
        const ids = testResults.map((t: { testId: number }) => t.testId);
        assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate testIds');
    });
});
