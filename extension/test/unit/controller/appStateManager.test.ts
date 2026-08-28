import * as assert from 'assert';

import { AppStateManager } from '@extension/controller/appStateManager';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { CourseDashboardResponse, ExerciseDetailsResponse } from '@extension/types';

/** Minimal mock that satisfies AppStateManager's usage of CourseCatalog */
function createMockCache(initialData?: CourseDashboardResponse): CourseCatalog {
    let data = initialData;
    return {
        get: () => data,
        clear: () => { data = undefined; },
    } as unknown as CourseCatalog;
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

    test('should read courses data from CourseCatalog', () => {
        const coursesData = { courses: [{ course: { id: 1, title: 'Test Course' } }] };
        stateManager.setCourseCatalog(createMockCache(coursesData));

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
        // currentCourseData is strict to the 'course' variant: undefined while in exercise view
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
        stateManager.setCourseCatalog(cache);

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

    suite('workspace mode', () => {
        /** Puts an exercise on screen, which is what a mode record has to name to be accepted. */
        function openExercise(id: number): void {
            stateManager.showCourseDetail({ course: { id: 1, title: 'Course' } });
            stateManager.showExerciseDetail({ exercise: { id } } as ExerciseDetailsResponse);
        }

        test('knows nothing until a probe reports', () => {
            openExercise(456);
            assert.strictEqual(stateManager.workspaceIsPractice, false);
        });

        test('a failing newer probe cannot silence an older one that succeeded', () => {
            // The interleaving a rollback-based counter gets wrong: probe 2 is outstanding when
            // probe 1 lands, and then never reports at all. Refusing probe 1 for being older would
            // leave the mode unknown forever.
            openExercise(456);
            const first = stateManager.beginWorkspaceModeProbe();
            stateManager.beginWorkspaceModeProbe();

            assert.deepStrictEqual(stateManager.recordWorkspaceMode(first, 456, true), { accepted: true });
            assert.strictEqual(stateManager.workspaceIsPractice, true);
        });

        test('the later detection wins when both succeed', () => {
            openExercise(456);
            const first = stateManager.beginWorkspaceModeProbe();
            const second = stateManager.beginWorkspaceModeProbe();

            stateManager.recordWorkspaceMode(first, 456, true);
            stateManager.recordWorkspaceMode(second, 456, false);

            assert.strictEqual(stateManager.workspaceIsPractice, false);
        });

        test('an older detection landing last is refused', () => {
            openExercise(456);
            const first = stateManager.beginWorkspaceModeProbe();
            const second = stateManager.beginWorkspaceModeProbe();

            stateManager.recordWorkspaceMode(second, 456, true);

            assert.deepStrictEqual(stateManager.recordWorkspaceMode(first, 456, false), { accepted: false });
            assert.strictEqual(stateManager.workspaceIsPractice, true);
        });

        test('the oldest probe still counts when every newer one fails', () => {
            openExercise(456);
            const first = stateManager.beginWorkspaceModeProbe();
            stateManager.beginWorkspaceModeProbe();
            stateManager.beginWorkspaceModeProbe();

            assert.strictEqual(stateManager.recordWorkspaceMode(first, 456, true).accepted, true);
            assert.strictEqual(stateManager.workspaceIsPractice, true);
        });

        test('a result for an exercise the user has left is refused', () => {
            // Its side effects must not be applied either: UpdateRepoStatus carries no exercise id,
            // so an accepted stale probe would rewrite the new exercise's repository state.
            openExercise(456);
            const ticket = stateManager.beginWorkspaceModeProbe();
            openExercise(789);

            assert.deepStrictEqual(stateManager.recordWorkspaceMode(ticket, 456, true), { accepted: false });
            assert.strictEqual(stateManager.workspaceIsPractice, false);
        });

        test('a probe cannot report about an exercise the student has navigated away from', () => {
            // `showCourseList` leaves the exercise payload in place, so checking the payload alone
            // would accept this and leave a stale mode for the next time the exercise is opened.
            openExercise(456);
            const ticket = stateManager.beginWorkspaceModeProbe();
            stateManager.showCourseList();

            assert.strictEqual(stateManager.recordWorkspaceMode(ticket, 456, true).accepted, false);
        });

        test('a signed-out session leaves nothing behind for the next one', () => {
            openExercise(456);
            stateManager.recordWorkspaceMode(stateManager.beginWorkspaceModeProbe(), 456, true);

            stateManager.showLogin();
            openExercise(456);

            assert.strictEqual(stateManager.workspaceIsPractice, false);
        });

        test('a record for another exercise is not evidence about this one', () => {
            openExercise(456);
            stateManager.recordWorkspaceMode(stateManager.beginWorkspaceModeProbe(), 456, true);

            openExercise(789);

            assert.strictEqual(stateManager.workspaceIsPractice, false);
        });

        test('survives the same-exercise refresh that showExerciseDetail performs', () => {
            // refreshFromServer re-enters showExerciseDetail for the exercise already on screen, so
            // a mode cleared there would fall back to graded on every WebSocket result.
            openExercise(456);
            stateManager.recordWorkspaceMode(stateManager.beginWorkspaceModeProbe(), 456, true);

            stateManager.showExerciseDetail({ exercise: { id: 456 } } as ExerciseDetailsResponse);

            assert.strictEqual(stateManager.workspaceIsPractice, true);
        });

        test('only a real change asks for a re-render', () => {
            // Opening a graded exercise must not schedule a second render on top of the one
            // navigation already scheduled; opening a practice one must, because the first was wrong.
            openExercise(456);
            let fired = 0;
            stateManager.onWorkspaceModeChange = () => { fired++; };

            stateManager.recordWorkspaceMode(stateManager.beginWorkspaceModeProbe(), 456, false);
            assert.strictEqual(fired, 0);

            stateManager.recordWorkspaceMode(stateManager.beginWorkspaceModeProbe(), 456, true);
            assert.strictEqual(fired, 1);
        });
    });
});
