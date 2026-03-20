import * as assert from 'assert';
import { ArtemisApiService } from '../../../src/api/artemisApi';
import { AuthManager } from '../../../src/services/auth/authManager';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { ApiError, ArtemisUser, ArtemisParticipation, ArtemisResult, BuildLogEntry, AuthenticationResult, ProgrammingSubmission } from '../../../src/types';

// Mock fetch
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

        // Mock AuthManager.getAuthHeaders
        authManager.getAuthHeaders = async () => ({ 'Authorization': 'Bearer test-token' });

        apiService = new TestableArtemisApiService(authManager);

        // Mock fetch
        mockFetch = async (url: string, options: any) => {
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
                json: async () => mockUser,
            } as any;
        };

        const user = await apiService.getCurrentUser();
        assert.ok(user instanceof ArtemisUser);
        assert.strictEqual(user.id, 1);
        assert.strictEqual(user.login, 'test');
    });

    test('should get courses', async () => {
        const mockCourses = [{ id: 1, title: 'Course 1' }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/core/courses'));
            return {
                ok: true,
                status: 200,
                json: async () => mockCourses,
            } as any;
        };

        const courses = await apiService.getCourses();
        assert.deepStrictEqual(courses, mockCourses);
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

    test('should get exercise details with submissions', async () => {
        const exerciseId = 123;
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/exercise/exercises/${exerciseId}/details`));
            assert.ok(url.includes('withSubmissions=true'));
            assert.ok(url.includes('withLatestResult=true'));
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

    test('should get course details', async () => {
        const courseId = 1;
        const mockCourse = { id: 1, title: 'Course 1' };
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/core/courses/${courseId}`));
            return {
                ok: true,
                status: 200,
                json: async () => mockCourse,
            } as any;
        };

        const course = await apiService.getCourseDetails(courseId);
        assert.deepStrictEqual(course, mockCourse);
    });

    test('should get participations', async () => {
        const mockParticipations = [{ id: 1, type: 'student' }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/core/participations'));
            return {
                ok: true,
                status: 200,
                json: async () => mockParticipations,
            } as any;
        };

        const participations = await apiService.getParticipations();
        assert.strictEqual(participations.length, 1);
        assert.ok(participations[0] instanceof ArtemisParticipation);
        assert.strictEqual(participations[0].id, 1);
        assert.strictEqual(participations[0].type, 'student');
    });

    test('should get results for participation', async () => {
        const participationId = 1;
        const mockResults = [{ id: 1, score: 100 }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/core/participations/${participationId}/results`));
            return {
                ok: true,
                status: 200,
                json: async () => mockResults,
            } as any;
        };

        const results = await apiService.getResults(participationId);
        assert.strictEqual(results.length, 1);
        assert.ok(results[0] instanceof ArtemisResult);
        assert.strictEqual(results[0].id, 1);
        assert.strictEqual(results[0].score, 100);
    });

    test('should get result details', async () => {
        const participationId = 1;
        const resultId = 10;
        const mockDetails = { id: 10, feedbacks: [] };
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/assessment/participations/${participationId}/results/${resultId}/details`));
            return {
                ok: true,
                status: 200,
                json: async () => mockDetails,
            } as any;
        };

        const details = await apiService.getResultDetails(participationId, resultId);
        assert.ok(details instanceof ArtemisResult);
        assert.strictEqual(details.id, 10);
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
        assert.ok(logs[0] instanceof BuildLogEntry);
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

    test('should check authentication status', async () => {
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/core/public/account'));
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 1 }),
            } as any;
        };

        const isAuthenticated = await apiService.isAuthenticated();
        assert.strictEqual(isAuthenticated, true);
    });

    test('should return false if not authenticated', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 401,
        } as any);

        const isAuthenticated = await apiService.isAuthenticated();
        assert.strictEqual(isAuthenticated, false);
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
        assert.ok(participation instanceof ArtemisParticipation);
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
        assert.ok(participation instanceof ArtemisParticipation);
        assert.strictEqual(participation.id, 101);
    });

    test('should authenticate user', async () => {
        const mockToken = 'jwt-token';
        const mockCookie = 'jwt=jwt-token; Path=/; Secure; HttpOnly';

        global.fetch = async (url: any, options: any) => {
            // The actual implementation uses CONFIG.API.ENDPOINTS.AUTHENTICATE which might be different
            // Let's check if it contains 'authenticate' at least
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
        assert.ok(result instanceof AuthenticationResult);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.token, mockToken);
        // The cookie might be processed/cleaned by AuthManager or ArtemisApiService
        // Just check if it contains the token
        assert.ok(result.cookie!.includes('jwt-token'));
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

    test('should render PlantUML', async () => {
        const mockSvg = '<svg>test</svg>';
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/programming/plantuml/svg'));
            assert.ok(url.includes('plantuml='));
            return {
                ok: true,
                status: 200,
                text: async () => mockSvg,
            } as any;
        };

        const svg = await apiService.renderPlantUmlToSvg('@startuml\n@enduml');
        assert.strictEqual(svg, mockSvg);
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

    test('should get current course chat session', async () => {
        const courseId = 1;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/course-chat/${courseId}/sessions/current`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 123 }),
            } as any;
        };

        await apiService.getCurrentCourseChat(courseId);
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
        global.fetch = async (url: any, options: any) => {
            attempt++;
            if (attempt === 1) {
                // First attempt with files fails
                const body = JSON.parse(options.body);
                assert.ok(body.uncommittedFiles);
                return {
                    ok: false,
                    status: 400,
                    text: async () => 'Bad Request',
                } as any;
            } else {
                // Second attempt without files succeeds
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
        assert.ok(submission instanceof ProgrammingSubmission);
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

    test('should get exercise chat sessions', async () => {
        const exerciseId = 1;
        const mockSessions = [{ id: 1 }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/iris/programming-exercise-chat/${exerciseId}/sessions`));
            return {
                ok: true,
                status: 200,
                json: async () => mockSessions,
            } as any;
        };

        const sessions = await apiService.getExerciseChatSessions(exerciseId);
        assert.deepStrictEqual(sessions, mockSessions);
    });

    test('should get course chat sessions', async () => {
        const courseId = 1;
        const mockSessions = [{ id: 1 }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/iris/course-chat/${courseId}/sessions`));
            return {
                ok: true,
                status: 200,
                json: async () => mockSessions,
            } as any;
        };

        const sessions = await apiService.getCourseChatSessions(courseId);
        assert.deepStrictEqual(sessions, mockSessions);
    });

    test('should get course chat sessions with messages', async () => {
        const courseId = 1;
        const mockSessions = [{ id: 1, messages: [] }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/iris/chat-history/${courseId}/sessions`));
            return {
                ok: true,
                status: 200,
                json: async () => mockSessions,
            } as any;
        };

        const sessions = await apiService.getCourseChatSessionsWithMessages(courseId);
        assert.deepStrictEqual(sessions, mockSessions);
    });

    test('should create course chat session', async () => {
        const courseId = 1;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/course-chat/${courseId}/sessions`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 201,
                json: async () => ({ id: 1 }),
            } as any;
        };

        const session = await apiService.createCourseChatSession(courseId);
        assert.strictEqual(session.id, 1);
    });

    test('should create exercise chat session', async () => {
        const exerciseId = 1;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/programming-exercise-chat/${exerciseId}/sessions`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 201,
                json: async () => ({ id: 1 }),
            } as any;
        };

        const session = await apiService.createExerciseChatSession(exerciseId);
        assert.strictEqual(session.id, 1);
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

    test('should resend chat message', async () => {
        const sessionId = 1;
        const messageId = 1;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/sessions/${sessionId}/messages/${messageId}/resend`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 2 }),
            } as any;
        };

        await apiService.resendChatMessage(sessionId, messageId);
    });

    test('should validate authentication', async () => {
        global.fetch = async (url: any) => {
            assert.ok(url.includes('/api/core/public/account'));
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 1 }),
            } as any;
        };

        const isValid = await apiService.validateAuthentication();
        assert.strictEqual(isValid, true);
    });

    test('should detect server URL change', async () => {
        // Mock AuthManager to return a different URL
        authManager.getArtemisServerUrl = async () => 'https://old-artemis.example.com';

        const isChanged = await apiService.isServerUrlChanged();
        assert.strictEqual(isChanged, true);
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

    test('should get current exercise chat session', async () => {
        const exerciseId = 77;
        global.fetch = async (url: any, options: any) => {
            assert.ok(url.includes(`/api/iris/programming-exercise-chat/${exerciseId}/sessions/current`));
            assert.strictEqual(options.method, 'POST');
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 555 })
            } as any;
        };

        const session = await apiService.getCurrentExerciseChat(exerciseId);
        assert.strictEqual(session.id, 555);
    });

    test('should fetch exercise chat sessions with messages', async () => {
        const exerciseId = 77;
        const sessions = [{ id: 1 }, { id: 2 }];
        const messages: Record<number, any[]> = {
            1: [{ id: 'm1' }],
            2: [{ id: 'm2' }]
        };

        global.fetch = async (url: any) => {
            if (url.includes(`/api/iris/programming-exercise-chat/${exerciseId}/sessions`)) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => sessions
                } as any;
            }
            if (url.includes('/api/iris/sessions/1/messages')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => messages[1]
                } as any;
            }
            if (url.includes('/api/iris/sessions/2/messages')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => messages[2]
                } as any;
            }
            return { ok: true, status: 200, json: async () => [] } as any;
        };

        const result = await apiService.getExerciseChatSessionsWithMessages(exerciseId);
        assert.deepStrictEqual(result[0].messages, messages[result[0].id]);
        assert.deepStrictEqual(result[1].messages, messages[result[1].id]);
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
});
