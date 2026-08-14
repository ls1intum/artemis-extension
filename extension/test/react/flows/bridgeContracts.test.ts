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
    createGitCredentialsPayload,
    createRecommendedExtensionsPayload,
    createServiceStatusPayload,
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

    describe('git-credentials (gitIdentityInfo)', () => {
        it('has type discriminant "gitIdentityInfo"', () => {
            const payload = createGitCredentialsPayload();
            expect(payload.type).toBe('gitIdentityInfo');
        });

        it('passes isExtensionMessage() type guard', () => {
            const payload = createGitCredentialsPayload();
            expect(isExtensionMessage(payload)).toBe(true);
        });

        it('payload.name is a string', () => {
            const payload = createGitCredentialsPayload();
            expect(typeof payload.name).toBe('string');
        });

        it('payload.email is a string', () => {
            const payload = createGitCredentialsPayload();
            expect(typeof payload.email).toBe('string');
        });

        it('custom credentials flow through via overrides', () => {
            const payload = createGitCredentialsPayload({
                name: 'Jane Doe',
                email: 'jane@tum.de',
            });
            expect(payload.name).toBe('Jane Doe');
            expect(payload.email).toBe('jane@tum.de');
        });
    });

});
