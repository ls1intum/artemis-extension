/**
 * Bridge contract tests for all AppStateManager state transitions.
 *
 * These tests verify runtime payload shape contracts, complementing the
 * compile-time type-drift detection in messageContracts.test.ts.
 *
 * Rules:
 * - No React components rendered here
 * - Pure data shape verification only
 * - One describe block per state transition
 */
import { describe, expect, it } from 'vitest';

import { isExtensionMessage } from '@shared/messageContracts';

import {
    createCourseDetailPayload,
    createCourseListPayload,
    createDashboardPayload,
    createExerciseDetailPayload,
    createSubmissionSetupPayload,
} from '@test/react/fixtures';

describe('Bridge Contracts', () => {

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

    describe('submission-setup (submissionSetupInfo)', () => {
        it('has type discriminant "submissionSetupInfo"', () => {
            const payload = createSubmissionSetupPayload();
            expect(payload.type).toBe('submissionSetupInfo');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createSubmissionSetupPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('carries all four checks', () => {
            const payload = createSubmissionSetupPayload();
            expect(Object.keys(payload.snapshot).sort())
                .toEqual(['access', 'git', 'identity', 'repository']);
        });

        it('a blocked repository carries the reason instead of a title', () => {
            const payload = createSubmissionSetupPayload({
                repository: { state: 'problem', blocker: 'ssh-remote' },
            });
            expect(payload.snapshot.repository.blocker).toBe('ssh-remote');
            expect(payload.snapshot.repository.exerciseTitle).toBeUndefined();
        });
    });

});
