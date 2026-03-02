/**
 * Bridge contract tests for all AppStateManager state transitions.
 *
 * These tests verify runtime payload shape contracts — complementing the
 * compile-time type-drift detection in messageContracts.test.ts.
 *
 * Rules:
 * - No React components rendered here
 * - Pure data shape verification only
 * - One describe block per state transition
 */
import { describe, it, expect } from 'vitest';
import { isExtensionMessage } from '../../../src/shared/messageContracts';
import {
    createDashboardPayload,
    createCourseListPayload,
    createCourseDetailPayload,
    createExerciseDetailPayload,
    createExamStartPayload,
    createExamConductionPayload,
    createExamExerciseDetailPayload,
    createServiceStatusPayload,
    createGitCredentialsPayload,
    createRecommendedExtensionsPayload,
    createLogoutPayload,
    createGenericInitPayload,
} from '../fixtures';

describe('Bridge Contracts', () => {

    // =========================================================================
    // 1. showLogin() → login state → logoutSuccess
    // =========================================================================

    describe('login (logoutSuccess)', () => {
        it('has type discriminant "logoutSuccess"', () => {
            const payload = createLogoutPayload();
            expect(payload.type).toBe('logoutSuccess');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createLogoutPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('has no payload field', () => {
            const payload = createLogoutPayload();
            expect('payload' in payload).toBe(false);
        });
    });

    // =========================================================================
    // 2. showDashboard() → dashboard state → dashboardInit
    // =========================================================================

    describe('dashboard (dashboardInit)', () => {
        it('has type discriminant "dashboardInit"', () => {
            const payload = createDashboardPayload();
            expect(payload.type).toBe('dashboardInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createDashboardPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.courses is an array', () => {
            const payload = createDashboardPayload();
            expect(Array.isArray(payload.courses)).toBe(true);
        });

        it('custom courses flow through via overrides', () => {
            const customCourses = [
                {
                    courseData: { course: { id: 42, title: 'Algorithms' } },
                    exercises: [],
                },
            ];
            const payload = createDashboardPayload({ courses: customCourses });
            expect(payload.courses).toHaveLength(1);
            expect(payload.courses[0].courseData.course.id).toBe(42);
        });
    });

    // =========================================================================
    // 3. showCourseList() → course-list state → courseListInit
    // =========================================================================

    describe('course-list (courseListInit)', () => {
        it('has type discriminant "courseListInit"', () => {
            const payload = createCourseListPayload();
            expect(payload.type).toBe('courseListInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createCourseListPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.courses is an array', () => {
            const payload = createCourseListPayload();
            expect(Array.isArray(payload.courses)).toBe(true);
        });

        it('payload.archivedCourses is an array', () => {
            const payload = createCourseListPayload();
            expect(Array.isArray(payload.archivedCourses)).toBe(true);
        });

        it('custom courses flow through via overrides', () => {
            const customCourses = [{ course: { id: 7, title: 'Test Course' } }];
            const payload = createCourseListPayload({ courses: customCourses });
            expect(payload.courses[0].course.id).toBe(7);
        });
    });

    // =========================================================================
    // 4 & 5. showCourseDetail() / showArchivedCourseDetail() → course-detail → courseDetailInit
    // =========================================================================

    describe('course-detail (courseDetailInit)', () => {
        it('has type discriminant "courseDetailInit"', () => {
            const payload = createCourseDetailPayload();
            expect(payload.type).toBe('courseDetailInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createCourseDetailPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.courseData.course.id is a number', () => {
            const payload = createCourseDetailPayload();
            expect(typeof payload.courseData.course.id).toBe('number');
        });

        it('custom courseData flows through via overrides', () => {
            const payload = createCourseDetailPayload({
                courseData: { course: { id: 99, title: 'Archived Course', isArchived: true } },
            });
            expect(payload.courseData.course.id).toBe(99);
            expect(payload.courseData.course.isArchived).toBe(true);
        });

        it('hideDeveloperTools defaults to false', () => {
            const payload = createCourseDetailPayload();
            expect(payload.hideDeveloperTools).toBe(false);
        });
    });

    // =========================================================================
    // 6. showExerciseDetail() → exercise-detail state → exerciseDetailInit
    // =========================================================================

    describe('exercise-detail (exerciseDetailInit)', () => {
        it('has type discriminant "exerciseDetailInit"', () => {
            const payload = createExerciseDetailPayload();
            expect(payload.type).toBe('exerciseDetailInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createExerciseDetailPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.exerciseData is an object', () => {
            const payload = createExerciseDetailPayload();
            expect(typeof payload.exerciseData).toBe('object');
            expect(payload.exerciseData).not.toBeNull();
        });

        it('payload.hideDeveloperTools is a boolean', () => {
            const payload = createExerciseDetailPayload();
            expect(typeof payload.hideDeveloperTools).toBe('boolean');
        });

        it('custom exerciseData flows through via overrides', () => {
            const payload = createExerciseDetailPayload({
                exerciseData: { exercise: { id: 55, title: 'Custom Exercise' } },
                hideDeveloperTools: true,
            });
            expect(payload.exerciseData.exercise?.id).toBe(55);
            expect(payload.hideDeveloperTools).toBe(true);
        });
    });

    // =========================================================================
    // 7. showAiConfig() → ai-config state → init (generic)
    // =========================================================================

    describe('ai-config (init generic)', () => {
        it('has type discriminant "init"', () => {
            const payload = createGenericInitPayload('ai-config');
            expect(payload.type).toBe('init');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createGenericInitPayload('ai-config');
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('view is "ai-config"', () => {
            const payload = createGenericInitPayload('ai-config');
            expect(payload.view).toBe('ai-config');
        });

        it('payload is a Record object', () => {
            const payload = createGenericInitPayload('ai-config');
            expect(typeof payload.payload).toBe('object');
            expect(payload.payload).not.toBeNull();
        });
    });

    // =========================================================================
    // 8. showServiceStatus() → service-status state → serviceStatusInit
    // =========================================================================

    describe('service-status (serviceStatusInit)', () => {
        it('has type discriminant "serviceStatusInit"', () => {
            const payload = createServiceStatusPayload();
            expect(payload.type).toBe('serviceStatusInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createServiceStatusPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.serverUrl is a string', () => {
            const payload = createServiceStatusPayload();
            expect(typeof payload.serverUrl).toBe('string');
        });

        it('custom serverUrl flows through via overrides', () => {
            const payload = createServiceStatusPayload({ serverUrl: 'https://custom.artemis.tum.de' });
            expect(payload.serverUrl).toBe('https://custom.artemis.tum.de');
        });
    });

    // =========================================================================
    // 9. showStruggleDetection() → struggle-detection state → init (generic)
    // =========================================================================

    describe('struggle-detection (init generic)', () => {
        it('has type discriminant "init"', () => {
            const payload = createGenericInitPayload('struggle-detection');
            expect(payload.type).toBe('init');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createGenericInitPayload('struggle-detection');
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('view is "struggle-detection"', () => {
            const payload = createGenericInitPayload('struggle-detection');
            expect(payload.view).toBe('struggle-detection');
        });

        it('payload is a Record object', () => {
            const payload = createGenericInitPayload('struggle-detection');
            expect(typeof payload.payload).toBe('object');
            expect(payload.payload).not.toBeNull();
        });
    });

    // =========================================================================
    // 10. showRecommendedExtensions() → recommended-extensions → recommendedExtensionsInit
    // =========================================================================

    describe('recommended-extensions (recommendedExtensionsInit)', () => {
        it('has type discriminant "recommendedExtensionsInit"', () => {
            const payload = createRecommendedExtensionsPayload();
            expect(payload.type).toBe('recommendedExtensionsInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createRecommendedExtensionsPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.categories is an array', () => {
            const payload = createRecommendedExtensionsPayload();
            expect(Array.isArray(payload.categories)).toBe(true);
        });

        it('custom categories flow through via overrides', () => {
            const customCategories = [
                {
                    id: 'java',
                    name: 'Java',
                    description: 'Java dev tools',
                    extensions: [],
                },
            ];
            const payload = createRecommendedExtensionsPayload({ categories: customCategories });
            expect(payload.categories).toHaveLength(1);
            expect(payload.categories[0].id).toBe('java');
        });
    });

    // =========================================================================
    // 11. showGitCredentials() → git-credentials state → gitCredentialsInit
    // =========================================================================

    describe('git-credentials (gitCredentialsInit)', () => {
        it('has type discriminant "gitCredentialsInit"', () => {
            const payload = createGitCredentialsPayload();
            expect(payload.type).toBe('gitCredentialsInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createGitCredentialsPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.currentName is a string', () => {
            const payload = createGitCredentialsPayload();
            expect(typeof payload.currentName).toBe('string');
        });

        it('payload.currentEmail is a string', () => {
            const payload = createGitCredentialsPayload();
            expect(typeof payload.currentEmail).toBe('string');
        });

        it('custom credentials flow through via overrides', () => {
            const payload = createGitCredentialsPayload({
                currentName: 'Jane Doe',
                currentEmail: 'jane@tum.de',
            });
            expect(payload.currentName).toBe('Jane Doe');
            expect(payload.currentEmail).toBe('jane@tum.de');
        });
    });

    // =========================================================================
    // 12. showExamStart() → exam-start state → examStartInit
    // =========================================================================

    describe('exam-start (examStartInit)', () => {
        it('has type discriminant "examStartInit"', () => {
            const payload = createExamStartPayload();
            expect(payload.type).toBe('examStartInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createExamStartPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.studentExam is an object', () => {
            const payload = createExamStartPayload();
            expect(typeof payload.studentExam).toBe('object');
            expect(payload.studentExam).not.toBeNull();
        });

        it('payload.courseId is a number', () => {
            const payload = createExamStartPayload();
            expect(typeof payload.courseId).toBe('number');
        });

        it('payload.examId is a number', () => {
            const payload = createExamStartPayload();
            expect(typeof payload.examId).toBe('number');
        });

        it('custom exam data flows through via overrides', () => {
            const payload = createExamStartPayload({ courseId: 100, examId: 42 });
            expect(payload.courseId).toBe(100);
            expect(payload.examId).toBe(42);
        });
    });

    // =========================================================================
    // 13. showExamConduction() → exam-conduction state → examConductionInit
    // =========================================================================

    describe('exam-conduction (examConductionInit)', () => {
        it('has type discriminant "examConductionInit"', () => {
            const payload = createExamConductionPayload();
            expect(payload.type).toBe('examConductionInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createExamConductionPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.endTime is a number', () => {
            const payload = createExamConductionPayload();
            expect(typeof payload.endTime).toBe('number');
        });

        it('payload.totalDuration is a number', () => {
            const payload = createExamConductionPayload();
            expect(typeof payload.totalDuration).toBe('number');
        });

        it('payload.workspaceExerciseId is null by default', () => {
            const payload = createExamConductionPayload();
            expect(payload.workspaceExerciseId).toBeNull();
        });

        it('custom timing data flows through via overrides', () => {
            const endTime = 1_800_000_000_000;
            const startTime = 1_800_000_000_000 - 3_600_000;
            const payload = createExamConductionPayload({ endTime, startTime, totalDuration: 3600 });
            expect(payload.endTime).toBe(endTime);
            expect(payload.startTime).toBe(startTime);
        });
    });

    // =========================================================================
    // Bonus: showExamExerciseDetail() → examExerciseDetailInit
    // =========================================================================

    describe('exam-exercise-detail (examExerciseDetailInit)', () => {
        it('has type discriminant "examExerciseDetailInit"', () => {
            const payload = createExamExerciseDetailPayload();
            expect(payload.type).toBe('examExerciseDetailInit');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createExamExerciseDetailPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.examContext.courseId is a number', () => {
            const payload = createExamExerciseDetailPayload();
            expect(typeof payload.examContext.courseId).toBe('number');
        });

        it('payload.examContext.examId is a number', () => {
            const payload = createExamExerciseDetailPayload();
            expect(typeof payload.examContext.examId).toBe('number');
        });

        it('payload.exerciseData is an object', () => {
            const payload = createExamExerciseDetailPayload();
            expect(typeof payload.exerciseData).toBe('object');
            expect(payload.exerciseData).not.toBeNull();
        });

        it('custom examContext data flows through via overrides', () => {
            const payload = createExamExerciseDetailPayload({
                examContext: {
                    courseId: 200,
                    examId: 99,
                    studentExam: { id: 5 },
                    endTime: 9999999999,
                    startTime: 8888888888,
                    totalDuration: 7200,
                },
            });
            expect(payload.examContext.courseId).toBe(200);
            expect(payload.examContext.examId).toBe(99);
        });
    });

});
