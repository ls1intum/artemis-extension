import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { WebCmd } from '@shared/messageContracts';

import { NavigationCommandModule } from '@extension/controller/commands/navigationCommands';
import type { CommandContext } from '@extension/controller/commands/types';

suite('handleViewCourseDetails resolver', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
    });

    teardown(() => {
        sandbox.restore();
    });

    function buildContext(overrides: {
        coursesData?: { courses: Array<{ course: { id: number; title?: string } }> };
        getCourseForDashboard?: sinon.SinonStub;
        showCourseDetail?: sinon.SinonStub;
        courseCatalog?: { upsertSupplemental: sinon.SinonStub };
        sessionEpoch?: () => number;
    }): CommandContext {
        return {
            appStateManager: {
                coursesData: overrides.coursesData,
                showCourseDetail: overrides.showCourseDetail ?? sandbox.stub(),
            },
            artemisApi: {
                getCourseForDashboard: overrides.getCourseForDashboard
                    ?? sandbox.stub().resolves({ course: undefined }),
            },
            actionHandler: { render: sandbox.stub() },
            courseAccessStorage: { onCourseAccessed: sandbox.stub() },
            providerRegistry: { getChatWebviewProvider: () => undefined },
            exerciseRegistry: { registerFromCourseData: sandbox.stub() },
            courseCatalog: overrides.courseCatalog ?? { upsertSupplemental: sandbox.stub() },
            sessionEpoch: overrides.sessionEpoch ?? (() => 0),
        } as unknown as CommandContext;
    }

    test('uses cache when course is present', async () => {
        const showCourseDetail = sandbox.stub();
        const getCourseForDashboard = sandbox.stub().resolves({ course: { id: 7, title: 'fetched' } });
        const ctx = buildContext({
            coursesData: { courses: [{ course: { id: 7, title: 'cached' } }] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 7 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(getCourseForDashboard.callCount, 0, 'API must not be called on cache hit');
        assert.strictEqual(showCourseDetail.callCount, 1, 'showCourseDetail must be called on cache hit');
    });

    test('records the viewed course in the catalog, stamped with the session epoch', async () => {
        const upsertSupplemental = sandbox.stub();
        const ctx = buildContext({
            coursesData: { courses: [{ course: { id: 7, title: 'cached' } }] },
            courseCatalog: { upsertSupplemental },
            sessionEpoch: () => 9,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 7 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(upsertSupplemental.callCount, 1);
        const [record, epoch] = upsertSupplemental.firstCall.args as [{ kind: string; entry: { course: { id: number } } }, number];
        assert.strictEqual(record.kind, 'course');
        assert.strictEqual(record.entry.course.id, 7);
        assert.strictEqual(epoch, 9, 'the epoch must come from context.sessionEpoch(), not a hardcoded value');
    });

    test('falls back to getCourseForDashboard on cache miss', async () => {
        const showCourseDetail = sandbox.stub();
        const getCourseForDashboard = sandbox.stub().resolves({ course: { id: 99, title: 'fetched' } });
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 99 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(getCourseForDashboard.callCount, 1, 'API must be called once on cache miss');
        sinon.assert.calledWith(getCourseForDashboard, 99);
        assert.strictEqual(showCourseDetail.callCount, 1, 'showCourseDetail must be called after API fetch');
    });

    test('shows error and aborts when mapper returns null', async () => {
        const showCourseDetail = sandbox.stub();
        const getCourseForDashboard = sandbox.stub().resolves({ course: { title: 'no-id' } });
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 5 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(showCourseDetail.callCount, 0, 'showCourseDetail must not be called');
        assert.strictEqual(showErrorMessage.callCount, 1, 'error toast must be shown');
        sinon.assert.calledWith(showErrorMessage, 'Course data is incomplete');
    });

    test('shows error toast when API throws on cache miss', async () => {
        const showCourseDetail = sandbox.stub();
        const apiError = new Error('boom');
        const getCourseForDashboard = sandbox.stub().rejects(apiError);
        const ctx = buildContext({
            coursesData: { courses: [] },
            getCourseForDashboard,
            showCourseDetail,
        });
        const mod = new NavigationCommandModule(ctx);

        await mod.getHandlers().viewCourseDetails({
            type: 'command',
            command: 'viewCourseDetails',
            payload: { courseId: 12 },
        } satisfies WebCmd<'viewCourseDetails'>);

        assert.strictEqual(showCourseDetail.callCount, 0, 'showCourseDetail must not be called');
        assert.strictEqual(showErrorMessage.callCount, 1, 'error toast must be shown');
        sinon.assert.calledWith(showErrorMessage, 'Error viewing course details');
    });
});
