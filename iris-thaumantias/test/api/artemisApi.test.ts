import * as assert from 'assert';
import { ArtemisApiService } from '../../src/api/artemisApi';
import { AuthManager } from '../../src/auth/auth';
import { MockExtensionContext } from '../mocks/vscodeMocks';

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
        assert.deepStrictEqual(user, mockUser);
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
        } catch (error: any) {
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
        } catch (error: any) {
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

    test('should get exercises for course', async () => {
        const courseId = 1;
        const mockExercises = [{ id: 1, title: 'Ex 1' }];
        global.fetch = async (url: any) => {
            assert.ok(url.includes(`/api/core/courses/${courseId}/exercises`));
            return {
                ok: true,
                status: 200,
                json: async () => mockExercises,
            } as any;
        };

        const exercises = await apiService.getExercises(courseId);
        assert.deepStrictEqual(exercises, mockExercises);
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
});
