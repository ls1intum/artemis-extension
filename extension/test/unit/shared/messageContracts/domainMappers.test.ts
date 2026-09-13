import * as assert from 'assert';

import { toCourseDetailData } from '@shared/messageContracts/domainMappers';
import type { CourseDashboardCourse } from '@shared/types/apiResponses';

suite('toCourseDetailData', () => {
    test('returns null when course is undefined', () => {
        assert.strictEqual(toCourseDetailData(undefined), null);
    });

    test('returns null when course.id is undefined', () => {
        const course: CourseDashboardCourse = { title: 'X' };
        assert.strictEqual(toCourseDetailData(course), null);
    });

    test('returns null when course.id is null', () => {
        const course = { id: null as unknown as number, title: 'X' } as CourseDashboardCourse;
        assert.strictEqual(toCourseDetailData(course), null);
    });

    test('returns null when course.id is a string', () => {
        const course = { id: '1' as unknown as number, title: 'X' } as CourseDashboardCourse;
        assert.strictEqual(toCourseDetailData(course), null);
    });

    test('maps a valid course preserving id and explicit fields', () => {
        const course: CourseDashboardCourse = {
            id: 42,
            title: 'Algorithms',
            description: 'desc',
            semester: 'WS25/26',
            color: '#abcdef',
            numberOfStudents: 120,
            instructorGroupName: 'instructors',
            shortName: 'alg',
            startDate: '2026-04-15T10:00:00Z',
        };
        const result = toCourseDetailData(course);
        assert.ok(result);
        assert.strictEqual(result.course.id, 42);
        assert.strictEqual(result.course.title, 'Algorithms');
        assert.strictEqual(result.course.description, 'desc');
        assert.strictEqual(result.course.semester, 'WS25/26');
        assert.strictEqual(result.course.color, '#abcdef');
        assert.strictEqual(result.course.numberOfStudents, 120);
        assert.strictEqual(result.course.instructorGroupName, 'instructors');
        assert.strictEqual(result.course.shortName, 'alg');
        assert.strictEqual(result.course.startDate, '2026-04-15T10:00:00Z');
        assert.strictEqual(result.course.isArchived, undefined);
    });

    test('falls back to "Untitled Course" when title is missing', () => {
        const result = toCourseDetailData({ id: 1 });
        assert.ok(result);
        assert.strictEqual(result.course.title, 'Untitled Course');
    });

    test('drops unknown server keys from the result', () => {
        // A key the mapper does NOT special-case: `exams` is stripped
        // explicitly, so it would pass either way. `serverOnlyField` is
        // fictional and proves the explicit field list drops unknown keys.
        const raw = { id: 1, title: 'X', serverOnlyField: 'leak' } as CourseDashboardCourse;
        const result = toCourseDetailData(raw);
        assert.ok(result);
        assert.strictEqual((result.course as Record<string, unknown>).serverOnlyField, undefined);
    });

    test('drops exams (exam mode is unsupported)', () => {
        const raw = { id: 1, title: 'X', exams: [{ id: 9 }] } as CourseDashboardCourse;
        const result = toCourseDetailData(raw);
        assert.ok(result);
        assert.strictEqual((result.course as Record<string, unknown>).exams, undefined);
    });

    test('propagates isArchived from opts', () => {
        const result = toCourseDetailData({ id: 1, title: 'X' }, { isArchived: true });
        assert.ok(result);
        assert.strictEqual(result.course.isArchived, true);
    });

    test('result type does not allow arbitrary index-signature access', () => {
        const raw: CourseDashboardCourse & { exams: unknown[] } = { id: 1, exams: [] };
        const detail = toCourseDetailData(raw)!;

        // @ts-expect-error CourseDetailData.course must not expose server-only keys.
        void detail.course.exams;

        assert.strictEqual((detail.course as Record<string, unknown>).exams, undefined);
    });
});
