import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import { ApiError, MalformedResponseError } from '@extension/domain/errors';
import type { AvailabilityContext } from '@extension/services/iris/chat/irisAvailabilityService';
import { IrisAvailabilityService } from '@extension/services/iris/chat/irisAvailabilityService';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('IrisAvailabilityService Test Suite', () => {
    let service: IrisAvailabilityService;
    let contextStore: ContextStore;
    let mockApiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let postMessageSpy: sinon.SinonSpy;

    const courseContext: AvailabilityContext = { type: 'course', id: 101, title: 'Test Course' };

    setup(() => {
        contextStore = new ContextStore(new MockExtensionContext());

        mockApiService = sinon.createStubInstance(ArtemisApiService);
        // Mock Iris profile check (required for all Iris settings checks)
        mockApiService.getProfileInfo.resolves({ activeProfiles: [], activeModuleFeatures: ['iris'] });
        mockApiService.isIrisProfileActive.returns(true);

        postMessageSpy = sinon.spy();
        service = new IrisAvailabilityService(contextStore, mockApiService as never, postMessageSpy);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Iris Settings Check', () => {
        test('classifies as unavailable when API service is not available', async () => {
            const serviceWithoutApi = new IrisAvailabilityService(contextStore, undefined, postMessageSpy);

            const result = await serviceWithoutApi.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as enabled for course context when settings.enabled is true', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true },
                effectiveRateLimit: { requests: 10, timeframeHours: 1 }
            });

            const result = await service.checkAndLoadIrisSettings(courseContext);

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getIrisCourseChatSettings.calledOnceWith(101));
        });

        test('classifies as disabled when settings.enabled is false', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: false }
            });

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies as unavailable when settings.settings is missing entirely', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({} as never);

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as unavailable when settings.settings.enabled is not a boolean', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({
                settings: {} as never
            });

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as enabled for exercise context with courseId', async () => {
            const context: AvailabilityContext = { type: 'exercise', id: 123, title: 'Test Exercise', courseId: 101 };

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            const result = await service.checkAndLoadIrisSettings(context);

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getIrisCourseChatSettings.calledOnceWith(101));
        });

        test('resolves courseId from tracked exercise', async () => {
            const context: AvailabilityContext = { type: 'exercise', id: 123, title: 'Test Exercise' };

            contextStore.registerExercise({
                id: 123,
                title: 'Test Exercise',
                courseId: 101
            });

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            const result = await service.checkAndLoadIrisSettings(context);

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getIrisCourseChatSettings.calledWith(101));
        });

        test('resolves courseId from exercise details API', async () => {
            const context: AvailabilityContext = { type: 'exercise', id: 123, title: 'Test Exercise' };

            mockApiService.getExerciseDetails.resolves({
                exercise: {
                    id: 123,
                    title: 'Test Exercise',
                    course: { id: 101, title: 'Test Course' }
                }
            });

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            const result = await service.checkAndLoadIrisSettings(context);

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getExerciseDetails.calledOnceWith(123));
            assert.ok(mockApiService.getIrisCourseChatSettings.calledWith(101));
        });

        test('classifies as unavailable when courseId cannot be resolved for exercise', async () => {
            const context: AvailabilityContext = { type: 'exercise', id: 123, title: 'Test Exercise' };

            mockApiService.getExerciseDetails.resolves({
                exercise: { id: 123, title: 'Test Exercise' }
            });

            const result = await service.checkAndLoadIrisSettings(context);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as disabled for unsupported context type', async () => {
            const context = { type: 'lecture', id: 999, title: 'Test Lecture' } as unknown as AvailabilityContext;

            const result = await service.checkAndLoadIrisSettings(context);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies ApiError(403) as disabled', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Forbidden', 403));

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies ApiError(401) as unavailable (auth handler is firing)', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Auth expired', 401));

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies ApiError(404) as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Not found', 404));

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies ApiError(500) as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Server error', 500));

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies MalformedResponseError as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(
                new MalformedResponseError('Schema mismatch', 200, 'bad shape')
            );

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies a plain network error as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new TypeError('Failed to fetch'));

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies getProfileInfo failure as unavailable', async () => {
            mockApiService.getProfileInfo.rejects(new TypeError('Failed to fetch'));

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as disabled when iris profile is not active on server', async () => {
            mockApiService.isIrisProfileActive.returns(false);

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies ApiError(403) from getProfileInfo as unavailable, not disabled', async () => {
            // 403 only means "Iris is off for this course/exercise" when it
            // comes from the iris-settings endpoint. A 403 from the profile
            // probe (or any other endpoint in the flow) is an
            // infrastructure / auth issue and must NOT be misclassified as
            // disabled, otherwise a transient permissions hiccup would
            // surface the "instructor disabled Iris" overlay.
            mockApiService.getProfileInfo.rejects(new ApiError('Forbidden', 403));

            const result = await service.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies ApiError(403) from getExerciseDetails (during course resolution) as unavailable', async () => {
            // Same origin-sensitivity concern as the profile probe: a 403
            // from the exercise-details endpoint while resolving the course
            // ID is an auth / permissions issue, not an Iris-disabled
            // signal. The user must see the unavailable banner, not the
            // disabled overlay.
            const exerciseContext: AvailabilityContext = { type: 'exercise', id: 123, title: 'Test Exercise' };
            mockApiService.getExerciseDetails.rejects(new ApiError('Forbidden', 403));

            const result = await service.checkAndLoadIrisSettings(exerciseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });
    });

    suite('Availability state tracking', () => {
        const postedTypes = (): string[] => postMessageSpy.getCalls().map(call => call.args[0].type);

        test('lastAvailability starts as unknown', () => {
            assert.strictEqual(service.lastAvailability.kind, 'unknown');
        });

        test('postAvailability records the classification and its context key', () => {
            service.postAvailability({ kind: 'unavailable', reason: 'boom' }, courseContext);

            assert.strictEqual(service.lastAvailability.kind, 'unavailable');
            assert.strictEqual(service.lastAvailability.contextKey, 'course:101');
        });

        test('postAvailability tracks contextKey for disabled state', () => {
            service.postAvailability({ kind: 'disabled' }, courseContext);

            assert.strictEqual(service.lastAvailability.kind, 'disabled');
            assert.strictEqual(service.lastAvailability.contextKey, 'course:101');
        });

        test('postAvailability with no context records unknown', () => {
            service.postAvailability({ kind: 'disabled' }, null);

            assert.strictEqual(service.lastAvailability.kind, 'unknown');
            assert.strictEqual(service.lastAvailability.contextKey, undefined);
        });

        test('resetAvailability sets state back to unknown', () => {
            service.postAvailability({ kind: 'unavailable', reason: 'boom' }, courseContext);
            assert.strictEqual(service.lastAvailability.kind, 'unavailable');

            service.resetAvailability();

            const reset = service.lastAvailability;
            assert.strictEqual(reset.kind, 'unknown');
            assert.strictEqual(reset.contextKey, undefined);
        });

        // Each emission always clears the OPPOSITE banner: the two are
        // mutually exclusive states of one surface, and letting both show at
        // once is how a student ends up with "Iris is disabled" and "retry"
        // side by side.
        test('enabled hides both banners', () => {
            service.postAvailability({ kind: 'enabled' }, courseContext);
            assert.deepStrictEqual(postedTypes(), [ExtensionMsg.HideDisabledState, ExtensionMsg.HideUnavailableState]);
        });

        test('disabled shows the disabled banner and hides the unavailable one', () => {
            service.postAvailability({ kind: 'disabled' }, courseContext);
            assert.deepStrictEqual(postedTypes(), [ExtensionMsg.ShowDisabledState, ExtensionMsg.HideUnavailableState]);
            assert.match(postMessageSpy.firstCall.args[0].message, /not enabled for this course/);
        });

        test('disabled labels an exercise context as an exercise', () => {
            service.postAvailability({ kind: 'disabled' }, { type: 'exercise', id: 7, title: 'Ex' });
            assert.match(postMessageSpy.firstCall.args[0].message, /not enabled for this exercise/);
        });

        test('unavailable shows the unavailable banner and hides the disabled one', () => {
            service.postAvailability({ kind: 'unavailable', reason: 'boom' }, courseContext);
            assert.deepStrictEqual(postedTypes(), [ExtensionMsg.ShowUnavailableState, ExtensionMsg.HideDisabledState]);
        });
    });
});
