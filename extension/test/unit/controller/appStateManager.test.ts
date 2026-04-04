import * as assert from 'assert';
import { AppStateManager } from '../../../src/extension/controller/appStateManager';
import type { CourseDataCache } from '../../../src/extension/services/courseDataCache';
import type { ExerciseDetailsResponse, CourseDashboardResponse } from '../../../src/extension/types';

/** Minimal mock that satisfies AppStateManager's usage of CourseDataCache */
function createMockCache(initialData?: CourseDashboardResponse): CourseDataCache {
    let data = initialData;
    return {
        get: () => data,
        clear: () => { data = undefined; },
    } as unknown as CourseDataCache;
}

suite('AppStateManager Test Suite', () => {
    let stateManager: AppStateManager;

    setup(() => {
        stateManager = new AppStateManager();
    });

    test('should transition to dashboard state', () => {
        const userInfo = { username: 'test', serverUrl: 'https://test.artemis.de' };
        stateManager.showDashboard(userInfo);

        assert.strictEqual(stateManager.currentState, 'dashboard');
        assert.strictEqual(stateManager.userInfo?.username, 'test');
    });

    test('should read courses data from CourseDataCache', () => {
        const coursesData = { courses: [{ course: { id: 1, title: 'Test Course' } }] };
        stateManager.setCourseDataCache(createMockCache(coursesData));

        assert.strictEqual(stateManager.coursesData, coursesData);
    });

    test('should return undefined coursesData without cache', () => {
        assert.strictEqual(stateManager.coursesData, undefined);
    });

    test('should transition to course-detail state', () => {
        const courseData = { course: { id: 123, title: 'Test Course' } };
        stateManager.showCourseDetail(courseData);

        assert.strictEqual(stateManager.currentState, 'course-detail');
        assert.strictEqual(stateManager.currentCourseData, courseData);
    });

    test('should transition to exercise-detail state with data', () => {
        const exerciseData = {
            exercise: { id: 456, title: 'Test Exercise', type: 'programming' }
        } as ExerciseDetailsResponse;
        stateManager.showExerciseDetail(exerciseData);

        assert.strictEqual(stateManager.currentState, 'exercise-detail');
        assert.strictEqual(stateManager.currentExerciseData, exerciseData);
    });

    test('should transition to course-list state', () => {
        stateManager.showCourseList();
        assert.strictEqual(stateManager.currentState, 'course-list');
    });

    test('should set archived courses', () => {
        const archived = [{ id: 1, title: 'Old Course' }];
        stateManager.setArchivedCourses(archived);

        assert.strictEqual(stateManager.archivedCoursesData, archived);
    });

    test('should clear state on showLogin', () => {
        const coursesData = { courses: [{ course: { id: 1, title: 'Test' } }] };
        const cache = createMockCache(coursesData);
        stateManager.setCourseDataCache(cache);

        const userInfo = { username: 'test', serverUrl: 'https://test.artemis.de' };
        stateManager.showDashboard(userInfo);
        stateManager.showLogin();

        assert.strictEqual(stateManager.currentState, 'login');
        assert.strictEqual(stateManager.userInfo, undefined);
        assert.strictEqual(stateManager.coursesData, undefined);
    });

    test('should fire onStateChange callback', () => {
        const transitions: { from: string; to: string }[] = [];
        stateManager.onStateChange = (from, to) => { transitions.push({ from, to }); };

        stateManager.showDashboard({ username: 'test', serverUrl: 'https://test.artemis.de' });
        stateManager.showCourseList();

        assert.strictEqual(transitions.length, 2);
        assert.strictEqual(transitions[0].from, 'login');
        assert.strictEqual(transitions[0].to, 'dashboard');
        assert.strictEqual(transitions[1].from, 'dashboard');
        assert.strictEqual(transitions[1].to, 'course-list');
    });
});
