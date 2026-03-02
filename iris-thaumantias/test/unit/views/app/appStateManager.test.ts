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

suite('AppStateManager Clear Methods Test Suite', () => {
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

    test('should clear courses data', () => {
        // Set some data first
        stateManager.setCoursesData({ courses: [{ id: 1 }] });
        assert.ok(stateManager.coursesData);

        // Clear it
        stateManager.clearCoursesData();
        assert.strictEqual(stateManager.coursesData, undefined);
    });

    test('should clear dashboard data (same as courses)', () => {
        stateManager.setCoursesData({ courses: [{ id: 1 }] });
        assert.ok(stateManager.coursesData);

        stateManager.clearDashboardData();
        assert.strictEqual(stateManager.coursesData, undefined);
    });

    test('should clear current course data', () => {
        // First set a course
        const courseData = { course: { id: 123, title: 'Test' } };
        stateManager.showCourseDetail(courseData);
        assert.ok(stateManager.currentCourseData);

        // Clear it
        stateManager.clearCurrentCourseData();
        assert.strictEqual(stateManager.currentCourseData, undefined);
    });

    test('should clear current exercise data', async () => {
        // First load an exercise
        await stateManager.showExerciseDetail(456);
        assert.ok(stateManager.currentExerciseData);

        // Clear it
        stateManager.clearCurrentExerciseData();
        assert.strictEqual(stateManager.currentExerciseData, undefined);
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

    test('should force refresh exercise when requested', async () => {
        // Load exercise
        await stateManager.showExerciseDetail(789);
        mockApiService.getExerciseDetailsCalled = false;

        // Force refresh
        stateManager.clearCurrentExerciseData();
        await stateManager.showExerciseDetail(789);

        assert.ok(mockApiService.getExerciseDetailsCalled);
    });

    test('should refresh current exercise', async () => {
        // Load exercise first
        await stateManager.showExerciseDetail(999);
        mockApiService.getExerciseDetailsCalled = false;

        // Refresh current
        await stateManager.refreshCurrentExercise();

        assert.ok(mockApiService.getExerciseDetailsCalled);
        assert.strictEqual(mockApiService.lastExerciseId, 999);
    });
});
