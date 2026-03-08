import * as assert from 'assert';
import { AppStateManager } from '../../../../src/views/app/appStateManager';
import { AuthManager } from '../../../../src/auth';
import { ArtemisApiService } from '../../../../src/api';
import { MockExtensionContext } from '../../mocks/vscodeMocks';

class MockAuthManager extends AuthManager {
    constructor(context: any) {
        super(context);
    }
}

class MockArtemisApiService extends ArtemisApiService {
    public getCoursesForDashboardCalled = false;
    public getCourseDetailsCalled = false;
    public getExerciseDetailsCalled = false;
    public lastCourseId: number | undefined;
    public lastExerciseId: number | undefined;

    constructor(authManager: AuthManager) {
        super(authManager);
    }

    async getCoursesForDashboard() {
        this.getCoursesForDashboardCalled = true;
        return {
            courses: [
                { course: { id: 1, title: 'Test Course 1' } },
                { course: { id: 2, title: 'Test Course 2' } }
            ]
        };
    }

    async getCourseForDashboard(courseId: number) {
        this.getCourseDetailsCalled = true;
        this.lastCourseId = courseId;
        return { course: { id: courseId, title: 'Test Course' } };
    }

    async getExamsForCourse(_courseId: number) {
        return [];
    }

    async getCourseDetails(courseId: number) {
        this.getCourseDetailsCalled = true;
        this.lastCourseId = courseId;
        return {
            id: courseId,
            title: 'Test Course',
            exercises: []
        };
    }

    async getExerciseDetails(exerciseId: number) {
        this.getExerciseDetailsCalled = true;
        this.lastExerciseId = exerciseId;
        return {
            exercise: {
                id: exerciseId,
                title: 'Test Exercise',
                type: 'programming'
            }
        };
    }
}

suite('AppStateManager Test Suite', () => {
    let stateManager: AppStateManager;
    let mockContext: MockExtensionContext;
    let mockAuthManager: MockAuthManager;
    let mockApiService: MockArtemisApiService;

    setup(() => {
        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);
        stateManager = new AppStateManager(mockApiService);
    });

    test('should transition to dashboard state', async () => {
        const userInfo = { username: 'test', serverUrl: 'https://test.artemis.de' };
        await stateManager.showDashboard(userInfo);

        assert.strictEqual(stateManager.currentState, 'dashboard');
        assert.strictEqual(stateManager.userInfo?.username, 'test');
    });

    test('should transition to course-detail state', () => {
        const courseData = { course: { id: 123, title: 'Test Course' } };
        stateManager.showCourseDetail(courseData);

        assert.strictEqual(stateManager.currentState, 'course-detail');
        assert.strictEqual(stateManager.currentCourseData, courseData);
    });

    test('should fetch and show archived course detail', async () => {
        await stateManager.showArchivedCourseDetail(123);

        assert.strictEqual(stateManager.currentState, 'course-detail');
        assert.ok(mockApiService.getCourseDetailsCalled);
        assert.strictEqual(mockApiService.lastCourseId, 123);
    });

    test('should transition to exercise-detail state', async () => {
        await stateManager.showExerciseDetail(456);

        assert.strictEqual(stateManager.currentState, 'exercise-detail');
        assert.ok(mockApiService.getExerciseDetailsCalled);
        assert.strictEqual(mockApiService.lastExerciseId, 456);
    });
});
