import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api/artemisApi';
import { AuthManager } from '@extension/services/auth/authManager';
import { ApiError, MalformedResponseError } from '@extension/types';
import { CONFIG } from '@extension/utils';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

const originalFetch = global.fetch;
let mockFetch: any;

class TestableArtemisApiService extends ArtemisApiService {
    protected getServerUrl(): string {
        return 'https://artemis.example.com';
    }
}

suite('Artemis API Service Test Suite', () => {
    let apiService: TestableArtemisApiService;
    let authManager: AuthManager;
    let context: MockExtensionContext;

    setup(() => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);

        authManager.getAuthHeaders = async () => ({ 'Authorization': 'Bearer test-token' });

        apiService = new TestableArtemisApiService(authManager);

        mockFetch = async (_url: string, _options: any) => {
            return {
                ok: true,
                status: 200,
                json: async () => ({}),
                text: async () => '',
            };
        };
        global.fetch = mockFetch;
    });

    teardown(() => {
        global.fetch = originalFetch;
    });

    test('should get current user', async () => {
        const mockUser = { id: 1, login: 'test' };
        global.fetch = async (url: any, options: any) => {
            assert.strictEqual(url, 'https://artemis.example.com/api/core/public/account');
            assert.strictEqual(options.headers['Authorization'], 'Bearer test-token');
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(mockUser),
            } as any;
        };

        const user = await apiService.getCurrentUser();
        assert.ok(user);
        assert.strictEqual(user.id, 1);
        assert.strictEqual(user.login, 'test');
    });

    test('treats a 200 account response with an empty body as unauthenticated (401)', async () => {
        // /api/core/public/account is public: an unauthenticated request gets a 200
        // with an empty body rather than a 401. getCurrentUser must surface this as a
        // 401 so startup credential validation clears the stale token.
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '',
        } as any);

        try {
            await apiService.getCurrentUser();
            assert.fail('Should have thrown error');
        } catch (error: unknown) {
            assert.ok(error instanceof ApiError);
            assert.strictEqual((error as ApiError).status, 401);
        }
    });

    test('treats a 200 account response with a whitespace-only body as unauthenticated (401)', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '   \n',
        } as any);

        try {
            await apiService.getCurrentUser();
            assert.fail('Should have thrown error');
        } catch (error: unknown) {
            assert.ok(error instanceof ApiError);
            assert.strictEqual((error as ApiError).status, 401);
        }
    });

    test('should handle 401 error', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 401,
            statusText: 'Unauthorized'
        } as any);

        try {
            await apiService.getCurrentUser();
            assert.fail('Should have thrown error');
        } catch (error: unknown) {
            assert.ok(error instanceof ApiError);
            assert.strictEqual(error.status, 401);
            assert.ok(error.message.includes('Authentication failed'));
        }
    });

    test('should handle generic API error', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
        } as any);

        try {
            await apiService.getCurrentUser();
            assert.fail('Should have thrown error');
        } catch (error: unknown) {
            assert.ok(error instanceof ApiError);
            assert.strictEqual(error.status, 500);
            assert.ok(error.message.includes('API request failed'));
        }
    });

    test("keeps Artemis' machine-readable errorKey on the ApiError", async () => {
        // Artemis' problem response. `title` is prose for people and may be
        // reworded any time; `errorKey` is the contract that code may branch on.
        global.fetch = async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            text: async () => JSON.stringify({
                title: 'Iris is disabled for course 42',
                status: 403,
                errorKey: 'iris.course_disabled',
                message: 'error.iris.course_disabled',
            }),
        } as any);

        try {
            await apiService.getCurrentUser();
            assert.fail('Should have thrown error');
        } catch (error: unknown) {
            assert.ok(error instanceof ApiError);
            assert.strictEqual(error.status, 403);
            assert.strictEqual(
                (error as { errorKey?: string }).errorKey,
                'iris.course_disabled',
                'the discriminator must survive the parse, not just the prose',
            );
        }
    });

    test('should get exercise details', async () => {
        const exerciseId = 123;
        global.fetch = async (url: any) => {
            // The backend always includes studentParticipations with submissions
            // and results, and the endpoint accepts no query parameters.
            assert.ok(url.includes(`/api/exercise/exercises/${exerciseId}/details`));
            return {
                ok: true,
                status: 200,
                json: async () => ({ exercise: { id: exerciseId } }),
            } as any;
        };

        await apiService.getExerciseDetails(exerciseId);
    });

    test('should get archived courses', async () => {
        const mockCourses = [{ id: 2, title: 'Archived Course' }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/core/courses/for-archive'));
            return {
                ok: true,
                status: 200,
                json: async () => mockCourses,
            } as any;
        };

        const courses = await apiService.getArchivedCourses();
        assert.deepStrictEqual(courses, mockCourses);
    });

    test('should get courses for dashboard', async () => {
        const mockDashboard = { courses: [] };
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/core/courses/for-dashboard'));
            return {
                ok: true,
                status: 200,
                json: async () => mockDashboard,
            } as any;
        };

        const dashboard = await apiService.getCoursesForDashboard();
        assert.deepStrictEqual(dashboard, mockDashboard);
    });

    test('should get single course for dashboard', async () => {
        const courseId = 1;
        const mockCourseData = { course: { id: 1, title: 'Course 1', exercises: [] } };
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/core/courses/${courseId}/for-dashboard`));
            return {
                ok: true,
                status: 200,
                json: async () => mockCourseData,
            } as any;
        };

        const courseData = await apiService.getCourseForDashboard(courseId);
        assert.deepStrictEqual(courseData, mockCourseData);
    });

    test('should get build logs', async () => {
        const participationId = 1;
        const mockLogs = [{ id: 1, time: '2023-01-01', log: 'Build started' }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/programming/participations/${participationId}/buildlogs`));
            return {
                ok: true,
                status: 200,
                json: async () => mockLogs,
            } as any;
        };

        const logs = await apiService.getBuildLogs(participationId);
        assert.strictEqual(logs.length, 1);
        assert.ok(logs[0]);
        assert.strictEqual(logs[0].time, '2023-01-01');
        assert.strictEqual(logs[0].log, 'Build started');
    });

    test('should get build logs for specific result', async () => {
        const participationId = 1;
        const resultId = 5;
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`resultId=${resultId}`));
            return {
                ok: true,
                status: 200,
                json: async () => [],
            } as any;
        };

        await apiService.getBuildLogs(participationId, resultId);
    });

    test('should get VCS access token', async () => {
        const participationId = 1;
        const mockToken = 'vcs-token';
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes('/api/core/account/participation-vcs-access-token'));
            assert.strictEqual(options.method, 'GET');
            return {
                ok: true,
                status: 200,
                text: async () => mockToken,
            } as any;
        };

        const token = await apiService.getVcsAccessToken(participationId);
        assert.strictEqual(token, mockToken);
    });

    test('should create VCS access token', async () => {
        const participationId = 1;
        const mockToken = 'new-vcs-token';
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes('/api/core/account/participation-vcs-access-token'));
            assert.strictEqual(options.method, 'PUT');
            return {
                ok: true,
                status: 200,
                text: async () => mockToken,
            } as any;
        };

        const token = await apiService.createVcsAccessToken(participationId);
        assert.strictEqual(token, mockToken);
    });

    test('should start exercise participation', async () => {
        const exerciseId = 1;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/exercise/exercises/${exerciseId}/participations`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 100, type: 'student' }),
            } as any;
        };

        const participation = await apiService.startExerciseParticipation(exerciseId);
        assert.ok(participation);
        assert.strictEqual(participation.id, 100);
    });

    test('should start practice participation', async () => {
        const exerciseId = 1;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/exercise/exercises/${exerciseId}/participations/practice`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 101, type: 'student' }),
            } as any;
        };

        const participation = await apiService.startPracticeParticipation(exerciseId);
        assert.ok(participation);
        assert.strictEqual(participation.id, 101);
    });

    test('should authenticate user', async () => {
        const mockToken = 'jwt-token';
        const mockCookie = 'jwt=jwt-token; Path=/; Secure; HttpOnly';

        global.fetch = async (url: any, options: any) => {
            // The path comes from CONFIG.API.ENDPOINTS.AUTHENTICATE, so only the
            // substring is pinned here.
            assert.ok(url.includes('authenticate'));
            assert.strictEqual(options.method, 'POST');
            const body = JSON.parse(options.body);
            assert.strictEqual(body.username, 'user');
            assert.strictEqual(body.password, 'pass');

            return {
                ok: true,
                status: 200,
                headers: {
                    get: (name: string) => name === 'set-cookie' ? mockCookie : null
                },
                json: async () => ({ access_token: mockToken }),
            } as any;
        };

        const result = await apiService.authenticate('user', 'pass');
        assert.ok(result);
        assert.strictEqual(result.success, true);
    });

    test('should check Iris health', async () => {
        const mockStatus = { active: true };
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/iris/courses/1/status'));
            return {
                ok: true,
                status: 200,
                json: async () => mockStatus,
            } as any;
        };

        const status = await apiService.checkIrisHealth(1);
        assert.strictEqual(status.active, true);
        assert.strictEqual(status.rateLimitInfo, undefined);
    });

    test('should get Iris chat settings', async () => {
        const courseId = 1;
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/iris/courses/${courseId}/iris-settings`));
            return {
                ok: true,
                status: 200,
                json: async () => ({ enabled: true }),
            } as any;
        };

        await apiService.getIrisCourseChatSettings(courseId);
    });

    test('should get chat messages', async () => {
        const sessionId = 123;
        const mockMessages = [{ id: 1, content: 'Hello' }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/iris/sessions/${sessionId}/messages`));
            return {
                ok: true,
                status: 200,
                json: async () => mockMessages,
            } as any;
        };

        const messages = await apiService.getChatMessages(sessionId);
        assert.deepStrictEqual(messages, mockMessages);
    });

    test('should send chat message', async () => {
        const sessionId = 123;
        const content = 'Hello Iris';
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/sessions/${sessionId}/messages`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 2, content }),
            } as any;
        };

        await apiService.sendChatMessage(sessionId, content);
    });

    test('should send chat message with uncommitted files', async () => {
        const sessionId = 123;
        const content = 'Check these files';
        const uncommittedFiles = new Map<string, string>();
        uncommittedFiles.set('file1.java', 'content1');

        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/sessions/${sessionId}/messages`));
            assert.strictEqual(options.method, 'POST');
            const body = JSON.parse(options.body);
            assert.strictEqual(body.uncommittedFiles['file1.java'], 'content1');
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 3, content }),
            } as any;
        };

        await apiService.sendChatMessage(sessionId, content, uncommittedFiles);
    });

    test('should retry sending message without uncommitted files on 400 error', async () => {
        const sessionId = 123;
        const content = 'Check these files';
        const uncommittedFiles = new Map<string, string>();
        uncommittedFiles.set('file1.java', 'content1');

        let attempt = 0;
        global.fetch = async (_url: any, options: any) => {
            attempt++;
            if (attempt === 1) {
                const body = JSON.parse(options.body);
                assert.ok(body.uncommittedFiles);
                return {
                    ok: false,
                    status: 400,
                    text: async () => 'Bad Request',
                } as any;
            } else {
                const body = JSON.parse(options.body);
                assert.strictEqual(body.uncommittedFiles, undefined);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ id: 3, content }),
                } as any;
            }
        };

        await apiService.sendChatMessage(sessionId, content, uncommittedFiles);
        assert.strictEqual(attempt, 2);
    });

    test('should get latest pending submission', async () => {
        const participationId = 1;
        const mockSubmission = { id: 100, submissionDate: '2023-01-01' };
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/programming/programming-exercise-participations/${participationId}/latest-pending-submission`));
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(mockSubmission),
                json: async () => mockSubmission,
            } as any;
        };

        const submission = await apiService.getLatestPendingSubmission(participationId);
        assert.ok(submission);
        assert.strictEqual(submission.id, 100);
        assert.strictEqual(submission.submissionDate, '2023-01-01');
    });

    test('should return null if no pending submission', async () => {
        const participationId = 1;
        global.fetch = async () => ({
            ok: false,
            status: 404,
        } as any);

        const submission = await apiService.getLatestPendingSubmission(participationId);
        assert.strictEqual(submission, null);
    });

    test('getLatestPendingSubmission: empty body maps to null', async () => {
        const participationId = 7;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '',
        } as any);

        const submission = await apiService.getLatestPendingSubmission(participationId);
        assert.strictEqual(submission, null);
    });

    test('getLatestPendingSubmission: literal "null" body maps to null', async () => {
        const participationId = 8;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => 'null',
        } as any);

        const submission = await apiService.getLatestPendingSubmission(participationId);
        assert.strictEqual(submission, null);
    });

    test('getLatestPendingSubmission: 500 propagates (no silent null)', async () => {
        const participationId = 9;
        global.fetch = async () => ({
            ok: false,
            status: 500,
            text: async () => '',
        } as any);

        await assert.rejects(
            () => apiService.getLatestPendingSubmission(participationId),
            (err: unknown) => err instanceof ApiError && err.status === 500,
        );
    });

    test('getLatestPendingSubmission: 401 propagates', async () => {
        const participationId = 10;
        global.fetch = async () => ({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
        } as any);

        await assert.rejects(
            () => apiService.getLatestPendingSubmission(participationId),
            (err: unknown) => err instanceof ApiError && err.status === 401,
        );
    });

    test('getLatestPendingSubmission: malformed non-empty JSON throws MalformedResponseError', async () => {
        const participationId = 11;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '{ this is not json',
        } as any);

        await assert.rejects(
            () => apiService.getLatestPendingSubmission(participationId),
            (err: unknown) => err instanceof MalformedResponseError
                && err.message.startsWith('Malformed pending-submission response'),
        );
    });

    test('getLatestPendingSubmission: valid JSON without numeric id throws MalformedResponseError', async () => {
        const participationId = 14;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '{}',
        } as any);

        await assert.rejects(
            () => apiService.getLatestPendingSubmission(participationId),
            (err: unknown) => err instanceof MalformedResponseError
                && err.message.includes('non-numeric id'),
        );
    });

    test('getLatestPendingSubmission: valid JSON with non-numeric id throws MalformedResponseError', async () => {
        const participationId = 15;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '{"id":"abc"}',
        } as any);

        await assert.rejects(
            () => apiService.getLatestPendingSubmission(participationId),
            (err: unknown) => err instanceof MalformedResponseError,
        );
    });

    test('getLatestPendingSubmission: array body throws MalformedResponseError', async () => {
        const participationId = 16;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '[]',
        } as any);

        await assert.rejects(
            () => apiService.getLatestPendingSubmission(participationId),
            (err: unknown) => err instanceof MalformedResponseError,
        );
    });

    test('getLatestPendingSubmission: id=null/false/empty-string all rejected (no Number() coercion)', async () => {
        const participationId = 19;
        for (const bogusId of ['null', 'false', '""']) {
            global.fetch = async () => ({
                ok: true,
                status: 200,
                text: async () => `{"id":${bogusId}}`,
            } as any);
            await assert.rejects(
                () => apiService.getLatestPendingSubmission(participationId),
                (err: unknown) => err instanceof MalformedResponseError,
                `id=${bogusId} must reject`,
            );
        }
    });

    test('getLatestResultWithFeedbacks: malformed JSON throws MalformedResponseError', async () => {
        const participationId = 17;
        global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '{ broken',
        } as any);

        await assert.rejects(
            () => apiService.getLatestResultWithFeedbacks(participationId),
            (err: unknown) => err instanceof MalformedResponseError
                && err.message.startsWith('Malformed latest-result response'),
        );
    });

    test('getLatestResultWithFeedbacks: non-object body (array/primitive) throws MalformedResponseError', async () => {
        const participationId = 19;
        for (const bogus of ['[]', '42', '"ok"']) {
            global.fetch = async () => ({
                ok: true,
                status: 200,
                text: async () => bogus,
            } as any);
            await assert.rejects(
                () => apiService.getLatestResultWithFeedbacks(participationId),
                (err: unknown) => err instanceof MalformedResponseError,
                `body ${bogus} must reject`,
            );
        }
    });

    test('should mark message helpful', async () => {
        const sessionId = 1;
        const messageId = 1;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/sessions/${sessionId}/messages/${messageId}/helpful`));
            assert.strictEqual(options.method, 'PUT');
            assert.strictEqual(options.body, 'true');
            return {
                ok: true,
                status: 200,
            } as any;
        };

        await apiService.markMessageHelpful(sessionId, messageId, true);
    });

    test('should fallback to creating VCS token when none exists', async () => {
        const participationId = 9;
        let attempt = 0;
        const createdToken = 'created-token';

        global.fetch = async (url: any) => {
            attempt++;
            if (attempt === 1) {
                return {
                    ok: false,
                    status: 404,
                    statusText: 'Not Found'
                } as any;
            }
            assert.ok(url.includes(`/participation-vcs-access-token?participationId=${participationId}`));
            return {
                ok: true,
                status: 200,
                text: async () => createdToken
            } as any;
        };

        const token = await apiService.getOrCreateVcsAccessToken(participationId);
        assert.strictEqual(attempt, 2);
        assert.strictEqual(token, createdToken);
    });

    test('getOrCreateVcsAccessToken: 401 propagates without PUT fallback', async () => {
        const participationId = 12;
        let attempt = 0;
        global.fetch = async () => {
            attempt++;
            return {
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
            } as any;
        };

        await assert.rejects(
            () => apiService.getOrCreateVcsAccessToken(participationId),
            (err: unknown) => err instanceof ApiError && err.status === 401,
        );
        assert.strictEqual(attempt, 1, 'no PUT fallback should be attempted on auth failure');
    });

    test('getOrCreateVcsAccessToken: 500 propagates without PUT fallback', async () => {
        const participationId = 13;
        let attempt = 0;
        global.fetch = async () => {
            attempt++;
            return {
                ok: false,
                status: 500,
                statusText: 'Server Error',
                text: async () => '',
            } as any;
        };

        await assert.rejects(
            () => apiService.getOrCreateVcsAccessToken(participationId),
            (err: unknown) => err instanceof ApiError && err.status === 500,
        );
        assert.strictEqual(attempt, 1, 'no PUT fallback should be attempted on server error');
    });

    test('getOrCreateVcsAccessToken: network error propagates without PUT fallback', async () => {
        const participationId = 18;
        let attempt = 0;
        global.fetch = async () => {
            attempt++;
            throw new TypeError('fetch failed (network)');
        };

        await assert.rejects(
            () => apiService.getOrCreateVcsAccessToken(participationId),
            (err: unknown) => err instanceof TypeError,
        );
        assert.strictEqual(attempt, 1, 'no PUT fallback should be attempted on network failure');
    });

    test('should include auth headers and payload when sending chat message', async () => {
        const sessionId = 99;
        const content = 'ping';

        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/sessions/${sessionId}/messages`));
            assert.strictEqual(options.method, 'POST');
            assert.strictEqual(options.headers['Authorization'], 'Bearer test-token');
            assert.strictEqual(options.headers['Content-Type'], 'application/json');

            const body = JSON.parse(options.body);
            assert.ok(body.sentAt);
            assert.deepStrictEqual(body.content, [{ textContent: content, type: 'text' }]);

            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 1 })
            } as any;
        };

        await apiService.sendChatMessage(sessionId, content);
    });

    test('should get current chat session via unified endpoint', async () => {
        const entityId = 42;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes('/api/iris/chat/sessions/current'));
            assert.ok(url.includes('mode=COURSE_CHAT'));
            assert.ok(url.includes(`entityId=${entityId}`));
            assert.strictEqual(options.method, 'POST');
            return { ok: true, status: 200, json: async () => ({ id: 123, mode: 'COURSE_CHAT', entityId, creationDate: '2026-07-01T10:00:00Z' }) } as any;
        };
        const detail = await apiService.getCurrentChat('COURSE_CHAT', entityId, 7);
        assert.strictEqual(detail.sessionId, 123);
    });

    test('should list chat sessions for course via overview endpoint', async () => {
        const courseId = 5;
        const rawSummaries = [
            { id: 1, entityId: 5, mode: 'COURSE_CHAT', creationDate: '2026-05-13T00:00:00Z' },
            { id: 2, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: '2026-05-13T01:00:00Z' },
        ];
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/chat/${courseId}/sessions/overview`));
            assert.ok(!options?.method || options.method === 'GET');
            return { ok: true, status: 200, json: async () => rawSummaries } as any;
        };
        const summaries = await apiService.listChatSessionsForCourse(courseId);
        assert.strictEqual(summaries.length, 2);
        assert.strictEqual(summaries[0].sessionId, 1);
        assert.strictEqual(summaries[0].courseId, courseId);
        assert.deepStrictEqual(summaries[0].context, { mode: 'COURSE_CHAT', entityId: 5, name: undefined });
        assert.strictEqual(summaries[1].sessionId, 2);
    });

    interface Captured { url: string; options: { method?: string; body?: string } }

    /** Serves one canned response per call and records what was sent. */
    function captureFetch(responses: Array<{ status?: number; json?: unknown }>): Captured[] {
        const calls: Captured[] = [];
        let i = 0;
        global.fetch = (async (url: any, options: any) => {
            calls.push({ url: String(url), options: options ?? {} });
            const r = responses[Math.min(i++, responses.length - 1)];
            const status = r.status ?? 200;
            return {
                ok: status < 400,
                status,
                text: async () => JSON.stringify(r.json ?? {}),
                json: async () => r.json ?? {},
            } as any;
        }) as typeof global.fetch;
        return calls;
    }

    test('createCourseSession posts courseId only', async () => {
        const calls = captureFetch([{ json: { id: 7, mode: 'COURSE_CHAT', entityId: 42, creationDate: '2026-07-01T10:00:00Z' } }]);
        const session = await apiService.createCourseSession(42);
        assert.strictEqual(session.sessionId, 7);
        assert.strictEqual(session.courseId, 42);
        assert.strictEqual(calls[0].url, 'https://artemis.example.com/api/iris/chat/sessions?courseId=42');
        assert.strictEqual(calls[0].options.method, 'POST');
    });

    test('getCurrentChat parses mode, entityId, title, activity and messages', async () => {
        captureFetch([{
            json: {
                id: 9, mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, title: 'BFS',
                creationDate: '2026-07-01T10:00:00Z', lastActivityDate: '2026-07-02T10:00:00Z',
                messages: [{ id: 1, sender: 'USER', content: [{ textContent: 'hi', type: 'text' }] }],
            },
        }]);
        const detail = await apiService.getCurrentChat('PROGRAMMING_EXERCISE_CHAT', 5, 42);
        assert.deepStrictEqual(detail.context, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 });
        assert.strictEqual(detail.courseId, 42);
        assert.strictEqual(detail.lastActivity, Date.parse('2026-07-02T10:00:00Z'));
        assert.strictEqual(detail.messages.length, 1);
    });

    test('absent messages parse as an empty array', async () => {
        // @JsonInclude(NON_EMPTY) omits `messages` entirely when the session is empty.
        captureFetch([{ json: { id: 9, mode: 'COURSE_CHAT', entityId: 42, creationDate: '2026-07-01T10:00:00Z' } }]);
        const detail = await apiService.getCurrentChat('COURSE_CHAT', 42, 42);
        assert.deepStrictEqual(detail.messages, []);
    });

    test('an unknown mode is preserved verbatim and does not throw', async () => {
        captureFetch([{ json: { id: 9, mode: 'FUTURE_CHAT', entityId: 3, creationDate: '2026-07-01T10:00:00Z' } }]);
        const detail = await apiService.getChatSessionById(42, 9);
        assert.strictEqual(detail.context.mode, 'FUTURE_CHAT');
    });

    test('a session without mode or entityId is REJECTED, not defaulted', async () => {
        // Defaulting would infer a committed context, which invariant 3 forbids:
        // the extension would believe this is a course chat, stage another topic
        // onto it, and rehome it on the next send.
        captureFetch([{ json: { id: 9, creationDate: '2026-07-01T10:00:00Z' } }]);
        await assert.rejects(() => apiService.getChatSessionById(42, 9), MalformedResponseError);
    });

    test('sendChatMessage puts pendingContext in the body', async () => {
        const calls = captureFetch([{ json: { id: 11 } }]);
        await apiService.sendChatMessage(9, 'hallo', undefined, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 });
        const body = JSON.parse(String(calls[0].options.body));
        assert.deepStrictEqual(body.pendingContext, { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 });
        assert.strictEqual(body.messageDifferentiator, undefined);
    });

    test('the uncommitted-files 400 retry keeps pendingContext', async () => {
        const calls = captureFetch([{ status: 400 }, { json: { id: 11 } }]);
        await apiService.sendChatMessage(9, 'hallo', new Map([['A.java', 'class A {}']]), { mode: 'COURSE_CHAT', entityId: 42 });
        const retryBody = JSON.parse(String(calls[1].options.body));
        assert.strictEqual(retryBody.uncommittedFiles, undefined);
        assert.deepStrictEqual(retryBody.pendingContext, { mode: 'COURSE_CHAT', entityId: 42 });
    });

    test('a 400 without uncommitted files is not retried', async () => {
        // Otherwise a pendingContext 400 is re-sent identically, twice.
        const calls = captureFetch([{ status: 400 }]);
        await assert.rejects(() => apiService.sendChatMessage(9, 'hallo', undefined, { mode: 'COURSE_CHAT', entityId: 42 }));
        assert.strictEqual(calls.length, 1);
    });

    test('listChatSessionsForCourse parses title, entityName and lastActivityDate', async () => {
        captureFetch([{
            json: [{
                id: 3, entityId: 5, entityName: 'BFS', title: 'Endlosschleife',
                creationDate: '2026-07-01T10:00:00Z', lastActivityDate: '2026-07-02T10:00:00Z',
                mode: 'PROGRAMMING_EXERCISE_CHAT',
            }],
        }]);
        const [summary] = await apiService.listChatSessionsForCourse(42);
        assert.strictEqual(summary.title, 'Endlosschleife');
        assert.strictEqual(summary.context.name, 'BFS');
        assert.strictEqual(summary.lastActivity, Date.parse('2026-07-02T10:00:00Z'));
    });

    test('a summary without lastActivityDate falls back to creationDate', async () => {
        captureFetch([{ json: [{ id: 3, entityId: 5, creationDate: '2026-07-01T10:00:00Z', mode: 'COURSE_CHAT' }] }]);
        const [summary] = await apiService.listChatSessionsForCourse(42);
        assert.strictEqual(summary.lastActivity, Date.parse('2026-07-01T10:00:00Z'));
    });

    test('getCoursesForDashboard: rejects when body is an array (not an object)', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => [{ courses: [] }],
        } as any);
        await assert.rejects(
            () => apiService.getCoursesForDashboard(),
            (err: unknown) => err instanceof MalformedResponseError && /expected object, got array/.test(err.message),
        );
    });

    test('getArchivedCourses: rejects when body is not an array', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
        } as any);
        await assert.rejects(
            () => apiService.getArchivedCourses(),
            (err: unknown) => err instanceof MalformedResponseError && /expected array, got object/.test(err.message),
        );
    });

    test('getCurrentChat: rejects when session id is missing or non-numeric', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ mode: 'COURSE_CHAT' }),
        } as any);
        await assert.rejects(
            () => apiService.getCurrentChat('COURSE_CHAT', 1, 42),
            (err: unknown) => err instanceof MalformedResponseError && /missing or non-number field "id"/.test(err.message),
        );
    });

    test('listChatSessionsForCourse: rejects element with missing required field', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => [{ id: 1, entityId: 2, creationDate: '2026-01-01', mode: 'COURSE_CHAT' }, { id: 3 }],
        } as any);
        await assert.rejects(
            () => apiService.listChatSessionsForCourse(1),
            (err: unknown) => err instanceof MalformedResponseError && /IrisChatSessionSummary\[1\]/.test(err.message),
        );
    });

    test('should throw when authentication succeeds without cookie', async () => {
        let storeCalled = false;
        (authManager as any).storeArtemisCredentials = async () => {
            storeCalled = true;
        };

        global.fetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ access_token: 'token' })
        } as any);

        try {
            await apiService.authenticate('user', 'pass');
            assert.fail('Expected authenticate to throw when cookie missing');
        } catch (error: unknown) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('no JWT token received'));
            assert.strictEqual(storeCalled, false, 'credentials should not be stored');
        }
    });

    test('should abort a hanging request after the request timeout', async () => {
        // A server that accepts the connection but never responds: the fetch promise
        // only settles if its abort signal fires.
        global.fetch = ((_url: any, options: any) => new Promise((_resolve, reject) => {
            const signal: AbortSignal | undefined = options?.signal;
            signal?.addEventListener('abort', () => reject(signal.reason));
        })) as any;

        const clock = sinon.useFakeTimers();
        try {
            const pending = apiService.getCurrentUser();
            let settled = false;
            pending.then(() => { settled = true; }, () => { settled = true; });

            await clock.tickAsync(CONFIG.API.REQUEST_TIMEOUT_MS + 1000);

            // settled check fails fast if the timeout is ever removed (rather than hanging CI).
            assert.ok(settled, 'request should have been aborted after the timeout');
            await assert.rejects(
                pending,
                (err: unknown) => err instanceof DOMException && err.name === 'TimeoutError',
            );
        } finally {
            clock.restore();
        }
    });

    test('logoutFromServer aborts on its short timeout and stays best-effort', async () => {
        // Logout uses a shorter timeout than other calls; verify it aborts well before
        // the default request timeout and that the best-effort method never rejects.
        let aborted = false;
        global.fetch = ((_url: any, options: any) => new Promise((_resolve, reject) => {
            const signal: AbortSignal | undefined = options?.signal;
            signal?.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
        })) as any;

        const clock = sinon.useFakeTimers();
        try {
            const done = apiService.logoutFromServer();
            let resolved = false;
            let threw = false;
            done.then(() => { resolved = true; }, () => { threw = true; });

            // Past the logout timeout but below the default request timeout.
            await clock.tickAsync(CONFIG.API.LOGOUT_TIMEOUT_MS + 500);

            assert.ok(aborted, 'logout request should be aborted by the short logout timeout');
            assert.ok(resolved && !threw, 'logout must remain best-effort (never reject)');
        } finally {
            clock.restore();
        }
    });

    // The 202 body is what distinguishes a deliberate course-off (§13, pause with no lamp) from an in-flight
    // single-flight skip (§11, treat as accepted) from a missing endpoint (404, degrade to the lamp). These guard
    // the actual JSON parsing in postStruggleIntervention, which the orchestrator test cannot see (it stubs the result).
    const struggleBody = { struggleSignal: {}, uncommittedFiles: {} } as any;

    test('postStruggleIntervention: 202 {accepted:false, courseDisabled:true} → course-off', async () => {
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/iris/chat/exercises/42/struggle-intervention'));
            return { ok: true, status: 202, json: async () => ({ accepted: false, courseDisabled: true, exerciseId: 42 }) } as any;
        };
        assert.strictEqual(await apiService.postStruggleIntervention(42, struggleBody), 'course-off');
    });

    test('postStruggleIntervention: 202 in-flight {accepted:false, courseDisabled:false} → accepted (NOT course-off)', async () => {
        global.fetch = async () => ({ ok: true, status: 202, json: async () => ({ accepted: false, courseDisabled: false, exerciseId: 42 }) } as any);
        assert.strictEqual(await apiService.postStruggleIntervention(42, struggleBody), 'accepted');
    });

    test('postStruggleIntervention: 202 in-flight with courseDisabled ABSENT → accepted', async () => {
        global.fetch = async () => ({ ok: true, status: 202, json: async () => ({ accepted: false, exerciseId: 42 }) } as any);
        assert.strictEqual(await apiService.postStruggleIntervention(42, struggleBody), 'accepted');
    });

    test('postStruggleIntervention: 202 {accepted:true} → accepted', async () => {
        global.fetch = async () => ({ ok: true, status: 202, json: async () => ({ accepted: true, courseDisabled: false, exerciseId: 42, jobId: 'tok' }) } as any);
        assert.strictEqual(await apiService.postStruggleIntervention(42, struggleBody), 'accepted');
    });

    test('postStruggleIntervention: 404 → unavailable (feature missing → lamp)', async () => {
        global.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' } as any);
        assert.strictEqual(await apiService.postStruggleIntervention(42, struggleBody), 'unavailable');
    });

    test('postStruggleIntervention: 500 → failed (silent)', async () => {
        global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' } as any);
        assert.strictEqual(await apiService.postStruggleIntervention(42, struggleBody), 'failed');
    });
});
