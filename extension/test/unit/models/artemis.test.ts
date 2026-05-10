import * as assert from 'assert';
import {
    ApiError,
    parseProfileInfo,
    parseArtemisFeedback,
    parseArtemisUser,
    parseArtemisResult,
    parseArtemisParticipation,
    parseIrisHealthStatus,
    parseProgrammingSubmission,
    parseSubmissionProcessingMessage,
    parseResultDTO,
    parseBuildLogEntry,
} from '../../../src/extension/types';

suite('ApiError', () => {
    test('extends Error with status and detail', () => {
        const err = new ApiError('Not found', 404, 'Resource missing');
        assert.ok(err instanceof Error);
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.name, 'ApiError');
        assert.strictEqual(err.message, 'Not found');
        assert.strictEqual(err.status, 404);
        assert.strictEqual(err.detail, 'Resource missing');
    });

    test('works without detail', () => {
        const err = new ApiError('Unauthorized', 401);
        assert.strictEqual(err.status, 401);
        assert.strictEqual(err.detail, undefined);
    });

    test('is catchable as Error', () => {
        try {
            throw new ApiError('fail', 500);
        } catch (e) {
            assert.ok(e instanceof Error);
            assert.ok(e instanceof ApiError);
        }
    });
});

suite('ProfileInfo', () => {
    test('parses complete valid JSON', () => {
        const p = parseProfileInfo({
            activeProfiles: ['prod', 'iris'],
            ribbonEnv: 'prod',
            inProduction: true,
            openApiEnabled: false,
        });
        assert.ok(p);
        assert.deepStrictEqual(p.activeProfiles, ['prod', 'iris']);
        assert.strictEqual(p.ribbonEnv, 'prod');
        assert.strictEqual(p.inProduction, true);
        assert.strictEqual(p.openApiEnabled, false);
    });

    test('handles missing optional fields', () => {
        const p = parseProfileInfo({ activeProfiles: ['dev'] });
        assert.deepStrictEqual(p.activeProfiles, ['dev']);
        assert.strictEqual(p.ribbonEnv, undefined);
        assert.strictEqual(p.inProduction, undefined);
        assert.strictEqual(p.openApiEnabled, undefined);
    });

    test('defaults activeProfiles to empty array', () => {
        const p = parseProfileInfo({});
        assert.deepStrictEqual(p.activeProfiles, []);
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseProfileInfo(null), /Invalid/);
        assert.throws(() => parseProfileInfo(undefined), /Invalid/);
    });
});

suite('ArtemisFeedback', () => {
    test('parses complete valid JSON', () => {
        const f = parseArtemisFeedback({
            id: 1, text: 'Good', detailText: 'Well done',
            reference: 'ref1', credits: 5, type: 'MANUAL', positive: true,
        });
        assert.ok(f);
        assert.strictEqual(f.id, 1);
        assert.strictEqual(f.text, 'Good');
        assert.strictEqual(f.detailText, 'Well done');
        assert.strictEqual(f.reference, 'ref1');
        assert.strictEqual(f.credits, 5);
        assert.strictEqual(f.type, 'MANUAL');
        assert.strictEqual(f.positive, true);
    });

    test('handles missing optional fields', () => {
        const f = parseArtemisFeedback({});
        assert.strictEqual(f.id, undefined);
        assert.strictEqual(f.text, undefined);
        assert.strictEqual(f.detailText, undefined);
        assert.strictEqual(f.credits, undefined);
        assert.strictEqual(f.type, undefined);
        assert.strictEqual(f.positive, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseArtemisFeedback(null), /Invalid/);
        assert.throws(() => parseArtemisFeedback(undefined), /Invalid/);
    });
});

suite('ArtemisUser', () => {
    test('parses complete valid JSON', () => {
        const u = parseArtemisUser({
            login: 'student1', id: 42, firstName: 'Max', lastName: 'Mustermann',
            email: 'max@example.com', activated: true, langKey: 'de',
            authorities: ['ROLE_USER'],
        });
        assert.ok(u);
        assert.strictEqual(u.login, 'student1');
        assert.strictEqual(u.id, 42);
        assert.strictEqual(u.firstName, 'Max');
        assert.strictEqual(u.lastName, 'Mustermann');
        assert.strictEqual(u.email, 'max@example.com');
        assert.strictEqual(u.activated, true);
        assert.strictEqual(u.langKey, 'de');
        assert.deepStrictEqual(u.authorities, ['ROLE_USER']);
    });

    test('handles missing optional fields', () => {
        const u = parseArtemisUser({ login: 'student1' });
        assert.strictEqual(u.login, 'student1');
        assert.strictEqual(u.id, undefined);
        assert.strictEqual(u.firstName, undefined);
        assert.strictEqual(u.lastName, undefined);
        assert.strictEqual(u.email, undefined);
        assert.strictEqual(u.activated, undefined);
        assert.strictEqual(u.authorities, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseArtemisUser(null), /Invalid/);
        assert.throws(() => parseArtemisUser(undefined), /Invalid/);
    });
});

suite('ArtemisResult', () => {
    test('parses complete valid JSON', () => {
        const r = parseArtemisResult({
            id: 1, completionDate: '2025-01-15', successful: true,
            score: 85.5, rated: true,
        });
        assert.ok(r);
        assert.strictEqual(r.id, 1);
        assert.strictEqual(r.completionDate, '2025-01-15');
        assert.strictEqual(r.successful, true);
        assert.strictEqual(r.score, 85.5);
        assert.strictEqual(r.rated, true);
    });

    test('handles missing optional fields', () => {
        const r = parseArtemisResult({ id: 1 });
        assert.strictEqual(r.completionDate, undefined);
        assert.strictEqual(r.successful, undefined);
        assert.strictEqual(r.feedbacks, undefined);
        assert.strictEqual(r.participation, undefined);
        assert.strictEqual(r.assessor, undefined);
    });

    test('parses nested feedbacks, participation, assessor', () => {
        const r = parseArtemisResult({
            id: 1,
            feedbacks: [{ id: 10, text: 'Good', credits: 5 }],
            participation: { id: 2, type: 'student' },
            assessor: { login: 'tutor1' },
        });
        assert.ok(Array.isArray(r.feedbacks));
        assert.strictEqual(r.feedbacks!.length, 1);
        assert.strictEqual(r.feedbacks![0].id, 10);
        assert.ok(r.participation);
        assert.strictEqual(r.participation!.id, 2);
        assert.ok(r.assessor);
        assert.strictEqual(r.assessor!.login, 'tutor1');
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseArtemisResult(null), /Invalid/);
        assert.throws(() => parseArtemisResult(undefined), /Invalid/);
    });
});

suite('ArtemisParticipation', () => {
    test('parses complete valid JSON', () => {
        const p = parseArtemisParticipation({
            id: 1, type: 'student',
            repositoryUri: 'https://example.com/repo.git',
            buildPlanId: 'plan-1',
        });
        assert.ok(p);
        assert.strictEqual(p.id, 1);
        assert.strictEqual(p.type, 'student');
        assert.strictEqual(p.repositoryUri, 'https://example.com/repo.git');
        assert.strictEqual(p.buildPlanId, 'plan-1');
    });

    test('handles missing optional fields', () => {
        const p = parseArtemisParticipation({ id: 1, type: 'template' });
        assert.strictEqual(p.student, undefined);
        assert.strictEqual(p.exercise, undefined);
        assert.strictEqual(p.repositoryUri, undefined);
        assert.strictEqual(p.results, undefined);
    });

    test('parses nested student, exercise, results', () => {
        const p = parseArtemisParticipation({
            id: 1, type: 'student',
            student: { login: 'student1', id: 42 },
            exercise: { id: 5, title: 'Ex5', shortName: 'E5', type: 'programming' },
            results: [{ id: 10, score: 90 }],
        });
        assert.ok(p.student);
        assert.strictEqual(p.student!.login, 'student1');
        assert.ok(p.exercise);
        assert.strictEqual(p.exercise!.id, 5);
        assert.ok(Array.isArray(p.results));
        assert.strictEqual(p.results!.length, 1);
        assert.strictEqual(p.results![0].score, 90);
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseArtemisParticipation(null), /Invalid/);
        assert.throws(() => parseArtemisParticipation(undefined), /Invalid/);
    });
});

suite('IrisHealthStatus', () => {
    test('parses complete valid JSON', () => {
        const h = parseIrisHealthStatus({ active: true });
        assert.ok(h);
        assert.strictEqual(h.active, true);
    });

    test('handles missing optional rateLimitInfo', () => {
        const h = parseIrisHealthStatus({ active: false });
        assert.strictEqual(h.active, false);
        assert.strictEqual(h.rateLimitInfo, undefined);
    });

    test('parses nested rateLimitInfo', () => {
        const h = parseIrisHealthStatus({
            active: true,
            rateLimitInfo: { currentMessageCount: 3, rateLimit: 50, rateLimitTimeframeHours: 12 },
        });
        assert.ok(h.rateLimitInfo);
        assert.strictEqual(h.rateLimitInfo!.currentMessageCount, 3);
        assert.strictEqual(h.rateLimitInfo!.rateLimit, 50);
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseIrisHealthStatus(null), /Invalid/);
        assert.throws(() => parseIrisHealthStatus(undefined), /Invalid/);
    });
});

suite('ProgrammingSubmission', () => {
    test('parses complete valid JSON', () => {
        const s = parseProgrammingSubmission({
            id: 1, commitHash: 'abc123', buildArtifact: true,
            submissionDate: '2025-01-15', type: 'AUTOMATIC', buildFailed: false,
        });
        assert.ok(s);
        assert.strictEqual(s.id, 1);
        assert.strictEqual(s.commitHash, 'abc123');
        assert.strictEqual(s.buildArtifact, true);
        assert.strictEqual(s.submissionDate, '2025-01-15');
        assert.strictEqual(s.buildFailed, false);
    });

    test('handles missing optional fields', () => {
        const s = parseProgrammingSubmission({ id: 1 });
        assert.strictEqual(s.commitHash, undefined);
        assert.strictEqual(s.buildArtifact, undefined);
        assert.strictEqual(s.submissionDate, undefined);
        assert.strictEqual(s.participation, undefined);
    });

    test('parses nested participation and results', () => {
        const s = parseProgrammingSubmission({
            id: 1,
            participation: { id: 2, type: 'student' },
            results: [{ id: 10 }],
        });
        assert.ok(s.participation);
        assert.strictEqual(s.results![0].id, 10);
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseProgrammingSubmission(null), /Invalid/);
        assert.throws(() => parseProgrammingSubmission(undefined), /Invalid/);
    });
});

suite('SubmissionProcessingMessage', () => {
    test('parses complete valid JSON', () => {
        const m = parseSubmissionProcessingMessage({
            participationId: 1, exerciseId: 5, commitHash: 'abc',
            submissionDate: '2025-01-15', buildStartDate: '2025-01-15T10:00:00Z',
            estimatedCompletionDate: '2025-01-15T10:05:00Z',
            submissionState: 'BUILDING',
        });
        assert.ok(m);
        assert.strictEqual(m.participationId, 1);
        assert.strictEqual(m.exerciseId, 5);
        assert.strictEqual(m.commitHash, 'abc');
        assert.strictEqual(m.submissionState, 'BUILDING');
    });

    test('handles missing optional fields', () => {
        const m = parseSubmissionProcessingMessage({ participationId: 1 });
        assert.strictEqual(m.exerciseId, undefined);
        assert.strictEqual(m.commitHash, undefined);
        assert.strictEqual(m.submission, undefined);
        assert.strictEqual(m.buildTimingInfo, undefined);
    });

    test('parses nested submission and buildTimingInfo', () => {
        const m = parseSubmissionProcessingMessage({
            participationId: 1,
            submission: { id: 10, commitHash: 'def456' },
            buildTimingInfo: { buildStartDate: '2025-01-15T10:00:00Z' },
        });
        assert.ok(m.submission);
        assert.strictEqual(m.submission!.id, 10);
        assert.strictEqual(m.submission!.commitHash, 'def456');
        assert.ok(m.buildTimingInfo);
        assert.strictEqual(m.buildTimingInfo!.buildStartDate, '2025-01-15T10:00:00Z');
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseSubmissionProcessingMessage(null), /Invalid/);
        assert.throws(() => parseSubmissionProcessingMessage(undefined), /Invalid/);
    });
});

suite('ResultDTO', () => {
    test('parses complete valid JSON', () => {
        const r = parseResultDTO({
            id: 1, completionDate: '2025-01-15', successful: true,
            score: 95, rated: true, assessmentType: 'AUTOMATIC',
            testCaseCount: 10, passedTestCaseCount: 9, codeIssueCount: 1,
        });
        assert.ok(r);
        assert.strictEqual(r.id, 1);
        assert.strictEqual(r.successful, true);
        assert.strictEqual(r.score, 95);
        assert.strictEqual(r.assessmentType, 'AUTOMATIC');
        assert.strictEqual(r.testCaseCount, 10);
        assert.strictEqual(r.passedTestCaseCount, 9);
        assert.strictEqual(r.codeIssueCount, 1);
    });

    test('handles missing optional fields', () => {
        const r = parseResultDTO({ id: 1 });
        assert.strictEqual(r.completionDate, undefined);
        assert.strictEqual(r.successful, undefined);
        assert.strictEqual(r.participation, undefined);
        assert.strictEqual(r.feedbacks, undefined);
        assert.strictEqual(r.submission, undefined);
    });

    test('parses inline participation and submission objects', () => {
        const r = parseResultDTO({
            id: 1,
            participation: { id: 2, type: 'student' },
            submission: { id: 3, buildFailed: true },
        });
        assert.deepStrictEqual(r.participation, { id: 2, type: 'student' });
        assert.deepStrictEqual(r.submission, { id: 3, buildFailed: true });
    });

    test('parses nested feedbacks', () => {
        const r = parseResultDTO({
            id: 1,
            feedbacks: [{ id: 10, text: 'Good', credits: 5 }],
        });
        assert.ok(Array.isArray(r.feedbacks));
        assert.strictEqual(r.feedbacks!.length, 1);
        assert.strictEqual(r.feedbacks![0].text, 'Good');
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseResultDTO(null), /Invalid/);
        assert.throws(() => parseResultDTO(undefined), /Invalid/);
    });
});

suite('BuildLogEntry', () => {
    test('parses complete valid JSON', () => {
        const e = parseBuildLogEntry({
            id: 1, time: '2025-01-15T10:00:00Z', log: 'Build started',
        });
        assert.ok(e);
        assert.strictEqual(e.id, 1);
        assert.strictEqual(e.time, '2025-01-15T10:00:00Z');
        assert.strictEqual(e.log, 'Build started');
    });

    test('coerces fields via String()/Number()', () => {
        const e = parseBuildLogEntry({ id: '1', time: 123, log: 456 });
        assert.strictEqual(e.id, 1);
        assert.strictEqual(e.time, '123');
        assert.strictEqual(e.log, '456');
    });

    test('throws on invalid input', () => {
        assert.throws(() => parseBuildLogEntry(null), /Invalid/);
        assert.throws(() => parseBuildLogEntry(undefined), /Invalid/);
    });
});

