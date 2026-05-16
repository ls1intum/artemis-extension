import * as assert from 'assert';
import { AppStateManager } from '@extension/controller/appStateManager';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseDetailsResponse, CourseDashboardResponse } from '@extension/types';

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
        const courseData = { course: { id: 123, title: 'Parent Course' } };
        const exerciseData = {
            exercise: { id: 456, title: 'Test Exercise', type: 'programming' }
        } as ExerciseDetailsResponse;

        stateManager.showCourseDetail(courseData);
        stateManager.showExerciseDetail(exerciseData);

        assert.strictEqual(stateManager.currentState, 'exercise-detail');
        assert.strictEqual(stateManager.currentExerciseData, exerciseData);
    });

    test('backToCourseDetails restores course payload after exercise view', () => {
        const courseData = { course: { id: 123, title: 'Parent Course' } };
        const exerciseData = { exercise: { id: 456 } } as ExerciseDetailsResponse;

        stateManager.showCourseDetail(courseData);
        stateManager.showExerciseDetail(exerciseData);
        // currentCourseData is strict to the 'course' variant — undefined while in exercise view
        assert.strictEqual(stateManager.currentCourseData, undefined);

        stateManager.backToCourseDetails();

        assert.strictEqual(stateManager.currentState, 'course-detail');
        assert.strictEqual(stateManager.currentCourseData, courseData);
    });

    test('chained exercise→exercise navigation preserves parent course', () => {
        const courseData = { course: { id: 123, title: 'Parent Course' } };
        const exerciseA = { exercise: { id: 1 } } as ExerciseDetailsResponse;
        const exerciseB = { exercise: { id: 2 } } as ExerciseDetailsResponse;

        stateManager.showCourseDetail(courseData);
        stateManager.showExerciseDetail(exerciseA);
        stateManager.showExerciseDetail(exerciseB); // no back in between

        stateManager.backToCourseDetails();
        assert.strictEqual(stateManager.currentCourseData, courseData);
    });

    test('showExerciseDetail throws without course in scope', () => {
        const exerciseData = { exercise: { id: 1 } } as ExerciseDetailsResponse;
        assert.throws(
            () => stateManager.showExerciseDetail(exerciseData),
            /requires a course in scope/,
        );
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
