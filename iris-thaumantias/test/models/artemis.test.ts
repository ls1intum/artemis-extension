import * as assert from 'assert';
import {
    ProfileInfo,
    LoginCredentials,
    ArtemisFeedback,
    ArtemisUser,
    ArtemisCourse,
    ArtemisExercise,
    ArtemisResult,
    ArtemisParticipation,
    AuthenticationResult,
    IrisRateLimitInfo,
    IrisHealthStatus,
    BuildTimingInfo,
    ArtemisSubmission,
    ProgrammingSubmission,
    SubmissionProcessingMessage,
    ResultDTO,
    BuildLogEntry,
    ParsedBuildError,
    WebviewMessage,
    LoginMessage,
    LogoutMessage,
    LoginSuccessMessage,
    LoginErrorMessage,
    LogoutSuccessMessage,
} from '../../src/models';

suite('ProfileInfo', () => {
    test('parses complete valid JSON', () => {
        const p = ProfileInfo.fromJSON({
            activeProfiles: ['prod', 'iris'],
            ribbonEnv: 'prod',
            inProduction: true,
            openApiEnabled: false,
        });
        assert.ok(p instanceof ProfileInfo);
        assert.deepStrictEqual(p.activeProfiles, ['prod', 'iris']);
        assert.strictEqual(p.ribbonEnv, 'prod');
        assert.strictEqual(p.inProduction, true);
        assert.strictEqual(p.openApiEnabled, false);
    });

    test('handles missing optional fields', () => {
        const p = ProfileInfo.fromJSON({ activeProfiles: ['dev'] });
        assert.deepStrictEqual(p.activeProfiles, ['dev']);
        assert.strictEqual(p.ribbonEnv, undefined);
        assert.strictEqual(p.inProduction, undefined);
        assert.strictEqual(p.openApiEnabled, undefined);
    });

    test('defaults activeProfiles to empty array', () => {
        const p = ProfileInfo.fromJSON({});
        assert.deepStrictEqual(p.activeProfiles, []);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ProfileInfo.fromJSON(null), /Invalid/);
        assert.throws(() => ProfileInfo.fromJSON(undefined), /Invalid/);
    });
});

suite('LoginCredentials', () => {
    test('constructs with all fields', () => {
        const c = new LoginCredentials('user', 'pass', true);
        assert.ok(c instanceof LoginCredentials);
        assert.strictEqual(c.username, 'user');
        assert.strictEqual(c.password, 'pass');
        assert.strictEqual(c.rememberMe, true);
    });

    test('constructs without optional rememberMe', () => {
        const c = new LoginCredentials('user', 'pass');
        assert.strictEqual(c.rememberMe, undefined);
    });
});

suite('ArtemisFeedback', () => {
    test('parses complete valid JSON', () => {
        const f = ArtemisFeedback.fromJSON({
            id: 1, text: 'Good', detailText: 'Well done',
            reference: 'ref1', credits: 5, type: 'MANUAL', positive: true,
        });
        assert.ok(f instanceof ArtemisFeedback);
        assert.strictEqual(f.id, 1);
        assert.strictEqual(f.text, 'Good');
        assert.strictEqual(f.detailText, 'Well done');
        assert.strictEqual(f.reference, 'ref1');
        assert.strictEqual(f.credits, 5);
        assert.strictEqual(f.type, 'MANUAL');
        assert.strictEqual(f.positive, true);
    });

    test('handles missing optional fields', () => {
        const f = ArtemisFeedback.fromJSON({});
        assert.strictEqual(f.id, undefined);
        assert.strictEqual(f.text, undefined);
        assert.strictEqual(f.detailText, undefined);
        assert.strictEqual(f.credits, undefined);
        assert.strictEqual(f.type, undefined);
        assert.strictEqual(f.positive, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ArtemisFeedback.fromJSON(null), /Invalid/);
        assert.throws(() => ArtemisFeedback.fromJSON(undefined), /Invalid/);
    });
});

suite('ArtemisUser', () => {
    test('parses complete valid JSON', () => {
        const u = ArtemisUser.fromJSON({
            login: 'student1', id: 42, firstName: 'Max', lastName: 'Mustermann',
            email: 'max@example.com', activated: true, langKey: 'de',
            authorities: ['ROLE_USER'],
        });
        assert.ok(u instanceof ArtemisUser);
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
        const u = ArtemisUser.fromJSON({ login: 'student1' });
        assert.strictEqual(u.login, 'student1');
        assert.strictEqual(u.id, undefined);
        assert.strictEqual(u.firstName, undefined);
        assert.strictEqual(u.lastName, undefined);
        assert.strictEqual(u.email, undefined);
        assert.strictEqual(u.activated, undefined);
        assert.strictEqual(u.authorities, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ArtemisUser.fromJSON(null), /Invalid/);
        assert.throws(() => ArtemisUser.fromJSON(undefined), /Invalid/);
    });
});

suite('ArtemisCourse', () => {
    test('parses complete valid JSON', () => {
        const c = ArtemisCourse.fromJSON({
            id: 10, title: 'Intro CS', shortName: 'CS1',
            description: 'A course', startDate: '2025-01-01', endDate: '2025-07-01',
            semester: 'WS25', studentGroupName: 'students',
            teachingAssistantGroupName: 'tutors', editorGroupName: 'editors',
            instructorGroupName: 'instructors',
        });
        assert.ok(c instanceof ArtemisCourse);
        assert.strictEqual(c.id, 10);
        assert.strictEqual(c.title, 'Intro CS');
        assert.strictEqual(c.shortName, 'CS1');
        assert.strictEqual(c.description, 'A course');
        assert.strictEqual(c.semester, 'WS25');
    });

    test('handles missing optional fields', () => {
        const c = ArtemisCourse.fromJSON({ id: 1, title: 'T', shortName: 'S' });
        assert.strictEqual(c.id, 1);
        assert.strictEqual(c.title, 'T');
        assert.strictEqual(c.shortName, 'S');
        assert.strictEqual(c.description, undefined);
        assert.strictEqual(c.startDate, undefined);
        assert.strictEqual(c.semester, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ArtemisCourse.fromJSON(null), /Invalid/);
        assert.throws(() => ArtemisCourse.fromJSON(undefined), /Invalid/);
    });
});

suite('ArtemisExercise', () => {
    test('parses complete valid JSON', () => {
        const e = ArtemisExercise.fromJSON({
            id: 1, title: 'Ex1', shortName: 'E1', type: 'programming',
            releaseDate: '2025-01-01', dueDate: '2025-02-01',
            assessmentDueDate: '2025-03-01', maxPoints: 100, bonusPoints: 10,
        });
        assert.ok(e instanceof ArtemisExercise);
        assert.strictEqual(e.id, 1);
        assert.strictEqual(e.title, 'Ex1');
        assert.strictEqual(e.type, 'programming');
        assert.strictEqual(e.maxPoints, 100);
        assert.strictEqual(e.bonusPoints, 10);
    });

    test('handles missing optional fields', () => {
        const e = ArtemisExercise.fromJSON({ id: 1, title: 'Ex1', shortName: 'E1', type: 'quiz' });
        assert.strictEqual(e.releaseDate, undefined);
        assert.strictEqual(e.dueDate, undefined);
        assert.strictEqual(e.maxPoints, undefined);
        assert.strictEqual(e.course, undefined);
    });

    test('parses nested course', () => {
        const e = ArtemisExercise.fromJSON({
            id: 1, title: 'Ex1', shortName: 'E1', type: 'programming',
            course: { id: 10, title: 'CS1', shortName: 'C1' },
        });
        assert.ok(e.course instanceof ArtemisCourse);
        assert.strictEqual(e.course!.id, 10);
        assert.strictEqual(e.course!.title, 'CS1');
    });

    test('throws on invalid input', () => {
        assert.throws(() => ArtemisExercise.fromJSON(null), /Invalid/);
        assert.throws(() => ArtemisExercise.fromJSON(undefined), /Invalid/);
    });
});

suite('ArtemisResult', () => {
    test('parses complete valid JSON', () => {
        const r = ArtemisResult.fromJSON({
            id: 1, completionDate: '2025-01-15', successful: true,
            score: 85.5, rated: true,
        });
        assert.ok(r instanceof ArtemisResult);
        assert.strictEqual(r.id, 1);
        assert.strictEqual(r.completionDate, '2025-01-15');
        assert.strictEqual(r.successful, true);
        assert.strictEqual(r.score, 85.5);
        assert.strictEqual(r.rated, true);
    });

    test('handles missing optional fields', () => {
        const r = ArtemisResult.fromJSON({ id: 1 });
        assert.strictEqual(r.completionDate, undefined);
        assert.strictEqual(r.successful, undefined);
        assert.strictEqual(r.feedbacks, undefined);
        assert.strictEqual(r.participation, undefined);
        assert.strictEqual(r.assessor, undefined);
    });

    test('parses nested feedbacks, participation, assessor', () => {
        const r = ArtemisResult.fromJSON({
            id: 1,
            feedbacks: [{ id: 10, text: 'Good', credits: 5 }],
            participation: { id: 2, type: 'student' },
            assessor: { login: 'tutor1' },
        });
        assert.ok(Array.isArray(r.feedbacks));
        assert.strictEqual(r.feedbacks!.length, 1);
        assert.ok(r.feedbacks![0] instanceof ArtemisFeedback);
        assert.strictEqual(r.feedbacks![0].id, 10);
        assert.ok(r.participation instanceof ArtemisParticipation);
        assert.strictEqual(r.participation!.id, 2);
        assert.ok(r.assessor instanceof ArtemisUser);
        assert.strictEqual(r.assessor!.login, 'tutor1');
    });

    test('throws on invalid input', () => {
        assert.throws(() => ArtemisResult.fromJSON(null), /Invalid/);
        assert.throws(() => ArtemisResult.fromJSON(undefined), /Invalid/);
    });
});

suite('ArtemisParticipation', () => {
    test('parses complete valid JSON', () => {
        const p = ArtemisParticipation.fromJSON({
            id: 1, type: 'student',
            repositoryUri: 'https://example.com/repo.git',
            buildPlanId: 'plan-1',
        });
        assert.ok(p instanceof ArtemisParticipation);
        assert.strictEqual(p.id, 1);
        assert.strictEqual(p.type, 'student');
        assert.strictEqual(p.repositoryUri, 'https://example.com/repo.git');
        assert.strictEqual(p.buildPlanId, 'plan-1');
    });

    test('handles missing optional fields', () => {
        const p = ArtemisParticipation.fromJSON({ id: 1, type: 'template' });
        assert.strictEqual(p.student, undefined);
        assert.strictEqual(p.exercise, undefined);
        assert.strictEqual(p.repositoryUri, undefined);
        assert.strictEqual(p.results, undefined);
    });

    test('parses nested student, exercise, results', () => {
        const p = ArtemisParticipation.fromJSON({
            id: 1, type: 'student',
            student: { login: 'student1', id: 42 },
            exercise: { id: 5, title: 'Ex5', shortName: 'E5', type: 'programming' },
            results: [{ id: 10, score: 90 }],
        });
        assert.ok(p.student instanceof ArtemisUser);
        assert.strictEqual(p.student!.login, 'student1');
        assert.ok(p.exercise instanceof ArtemisExercise);
        assert.strictEqual(p.exercise!.id, 5);
        assert.ok(Array.isArray(p.results));
        assert.strictEqual(p.results!.length, 1);
        assert.ok(p.results![0] instanceof ArtemisResult);
        assert.strictEqual(p.results![0].score, 90);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ArtemisParticipation.fromJSON(null), /Invalid/);
        assert.throws(() => ArtemisParticipation.fromJSON(undefined), /Invalid/);
    });
});

suite('AuthenticationResult', () => {
    test('parses complete valid JSON', () => {
        const a = AuthenticationResult.fromJSON({
            success: true, token: 'jwt-token', cookie: 'session=abc',
        });
        assert.ok(a instanceof AuthenticationResult);
        assert.strictEqual(a.success, true);
        assert.strictEqual(a.token, 'jwt-token');
        assert.strictEqual(a.cookie, 'session=abc');
    });

    test('handles missing optional fields', () => {
        const a = AuthenticationResult.fromJSON({ success: false });
        assert.strictEqual(a.success, false);
        assert.strictEqual(a.token, undefined);
        assert.strictEqual(a.cookie, undefined);
        assert.strictEqual(a.user, undefined);
    });

    test('parses nested user', () => {
        const a = AuthenticationResult.fromJSON({
            success: true,
            user: { login: 'student1', id: 1 },
        });
        assert.ok(a.user instanceof ArtemisUser);
        assert.strictEqual(a.user!.login, 'student1');
    });

    test('throws on invalid input', () => {
        assert.throws(() => AuthenticationResult.fromJSON(null), /Invalid/);
        assert.throws(() => AuthenticationResult.fromJSON(undefined), /Invalid/);
    });
});

suite('IrisRateLimitInfo', () => {
    test('parses complete valid JSON', () => {
        const r = IrisRateLimitInfo.fromJSON({
            currentMessageCount: 5, rateLimit: 100, rateLimitTimeframeHours: 24,
        });
        assert.ok(r instanceof IrisRateLimitInfo);
        assert.strictEqual(r.currentMessageCount, 5);
        assert.strictEqual(r.rateLimit, 100);
        assert.strictEqual(r.rateLimitTimeframeHours, 24);
    });

    test('coerces non-number fields via Number()', () => {
        const r = IrisRateLimitInfo.fromJSON({
            currentMessageCount: '5', rateLimit: '100', rateLimitTimeframeHours: '24',
        });
        assert.strictEqual(r.currentMessageCount, 5);
        assert.strictEqual(r.rateLimit, 100);
        assert.strictEqual(r.rateLimitTimeframeHours, 24);
    });

    test('throws on invalid input', () => {
        assert.throws(() => IrisRateLimitInfo.fromJSON(null), /Invalid/);
        assert.throws(() => IrisRateLimitInfo.fromJSON(undefined), /Invalid/);
    });
});

suite('IrisHealthStatus', () => {
    test('parses complete valid JSON', () => {
        const h = IrisHealthStatus.fromJSON({ active: true });
        assert.ok(h instanceof IrisHealthStatus);
        assert.strictEqual(h.active, true);
    });

    test('handles missing optional rateLimitInfo', () => {
        const h = IrisHealthStatus.fromJSON({ active: false });
        assert.strictEqual(h.active, false);
        assert.strictEqual(h.rateLimitInfo, undefined);
    });

    test('parses nested rateLimitInfo', () => {
        const h = IrisHealthStatus.fromJSON({
            active: true,
            rateLimitInfo: { currentMessageCount: 3, rateLimit: 50, rateLimitTimeframeHours: 12 },
        });
        assert.ok(h.rateLimitInfo instanceof IrisRateLimitInfo);
        assert.strictEqual(h.rateLimitInfo!.currentMessageCount, 3);
        assert.strictEqual(h.rateLimitInfo!.rateLimit, 50);
    });

    test('throws on invalid input', () => {
        assert.throws(() => IrisHealthStatus.fromJSON(null), /Invalid/);
        assert.throws(() => IrisHealthStatus.fromJSON(undefined), /Invalid/);
    });
});

suite('BuildTimingInfo', () => {
    test('parses complete valid JSON', () => {
        const b = BuildTimingInfo.fromJSON({
            buildStartDate: '2025-01-01T10:00:00Z',
            estimatedCompletionDate: '2025-01-01T10:05:00Z',
        });
        assert.ok(b instanceof BuildTimingInfo);
        assert.strictEqual(b.buildStartDate, '2025-01-01T10:00:00Z');
        assert.strictEqual(b.estimatedCompletionDate, '2025-01-01T10:05:00Z');
    });

    test('handles missing optional fields', () => {
        const b = BuildTimingInfo.fromJSON({});
        assert.strictEqual(b.buildStartDate, undefined);
        assert.strictEqual(b.estimatedCompletionDate, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => BuildTimingInfo.fromJSON(null), /Invalid/);
        assert.throws(() => BuildTimingInfo.fromJSON(undefined), /Invalid/);
    });
});

suite('ArtemisSubmission', () => {
    test('parses complete valid JSON', () => {
        const s = ArtemisSubmission.fromJSON({
            id: 1, submissionDate: '2025-01-15', type: 'MANUAL', buildFailed: false,
        });
        assert.ok(s instanceof ArtemisSubmission);
        assert.strictEqual(s.id, 1);
        assert.strictEqual(s.submissionDate, '2025-01-15');
        assert.strictEqual(s.type, 'MANUAL');
        assert.strictEqual(s.buildFailed, false);
    });

    test('handles missing optional fields', () => {
        const s = ArtemisSubmission.fromJSON({ id: 1 });
        assert.strictEqual(s.submissionDate, undefined);
        assert.strictEqual(s.type, undefined);
        assert.strictEqual(s.participation, undefined);
        assert.strictEqual(s.results, undefined);
        assert.strictEqual(s.buildFailed, undefined);
    });

    test('parses nested participation and results', () => {
        const s = ArtemisSubmission.fromJSON({
            id: 1,
            participation: { id: 2, type: 'student' },
            results: [{ id: 10, score: 75 }],
        });
        assert.ok(s.participation instanceof ArtemisParticipation);
        assert.strictEqual(s.participation!.id, 2);
        assert.ok(Array.isArray(s.results));
        assert.strictEqual(s.results!.length, 1);
        assert.ok(s.results![0] instanceof ArtemisResult);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ArtemisSubmission.fromJSON(null), /Invalid/);
        assert.throws(() => ArtemisSubmission.fromJSON(undefined), /Invalid/);
    });
});

suite('ProgrammingSubmission', () => {
    test('parses complete valid JSON', () => {
        const s = ProgrammingSubmission.fromJSON({
            id: 1, commitHash: 'abc123', buildArtifact: true,
            submissionDate: '2025-01-15', type: 'AUTOMATIC', buildFailed: false,
        });
        assert.ok(s instanceof ProgrammingSubmission);
        assert.ok(s instanceof ArtemisSubmission);
        assert.strictEqual(s.id, 1);
        assert.strictEqual(s.commitHash, 'abc123');
        assert.strictEqual(s.buildArtifact, true);
        assert.strictEqual(s.submissionDate, '2025-01-15');
        assert.strictEqual(s.buildFailed, false);
    });

    test('handles missing optional fields', () => {
        const s = ProgrammingSubmission.fromJSON({ id: 1 });
        assert.strictEqual(s.commitHash, undefined);
        assert.strictEqual(s.buildArtifact, undefined);
        assert.strictEqual(s.submissionDate, undefined);
        assert.strictEqual(s.participation, undefined);
    });

    test('parses nested participation and results', () => {
        const s = ProgrammingSubmission.fromJSON({
            id: 1,
            participation: { id: 2, type: 'student' },
            results: [{ id: 10 }],
        });
        assert.ok(s.participation instanceof ArtemisParticipation);
        assert.ok(s.results![0] instanceof ArtemisResult);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ProgrammingSubmission.fromJSON(null), /Invalid/);
        assert.throws(() => ProgrammingSubmission.fromJSON(undefined), /Invalid/);
    });
});

suite('SubmissionProcessingMessage', () => {
    test('parses complete valid JSON', () => {
        const m = SubmissionProcessingMessage.fromJSON({
            participationId: 1, exerciseId: 5, commitHash: 'abc',
            submissionDate: '2025-01-15', buildStartDate: '2025-01-15T10:00:00Z',
            estimatedCompletionDate: '2025-01-15T10:05:00Z',
            submissionState: 'BUILDING',
        });
        assert.ok(m instanceof SubmissionProcessingMessage);
        assert.strictEqual(m.participationId, 1);
        assert.strictEqual(m.exerciseId, 5);
        assert.strictEqual(m.commitHash, 'abc');
        assert.strictEqual(m.submissionState, 'BUILDING');
    });

    test('handles missing optional fields', () => {
        const m = SubmissionProcessingMessage.fromJSON({ participationId: 1 });
        assert.strictEqual(m.exerciseId, undefined);
        assert.strictEqual(m.commitHash, undefined);
        assert.strictEqual(m.submission, undefined);
        assert.strictEqual(m.buildTimingInfo, undefined);
    });

    test('parses nested submission and buildTimingInfo', () => {
        const m = SubmissionProcessingMessage.fromJSON({
            participationId: 1,
            submission: { id: 10, commitHash: 'def456' },
            buildTimingInfo: { buildStartDate: '2025-01-15T10:00:00Z' },
        });
        assert.ok(m.submission instanceof ProgrammingSubmission);
        assert.strictEqual(m.submission!.id, 10);
        assert.strictEqual(m.submission!.commitHash, 'def456');
        assert.ok(m.buildTimingInfo instanceof BuildTimingInfo);
        assert.strictEqual(m.buildTimingInfo!.buildStartDate, '2025-01-15T10:00:00Z');
    });

    test('throws on invalid input', () => {
        assert.throws(() => SubmissionProcessingMessage.fromJSON(null), /Invalid/);
        assert.throws(() => SubmissionProcessingMessage.fromJSON(undefined), /Invalid/);
    });
});

suite('ResultDTO', () => {
    test('parses complete valid JSON', () => {
        const r = ResultDTO.fromJSON({
            id: 1, completionDate: '2025-01-15', successful: true,
            score: 95, rated: true, assessmentType: 'AUTOMATIC',
            testCaseCount: 10, passedTestCaseCount: 9, codeIssueCount: 1,
        });
        assert.ok(r instanceof ResultDTO);
        assert.strictEqual(r.id, 1);
        assert.strictEqual(r.successful, true);
        assert.strictEqual(r.score, 95);
        assert.strictEqual(r.assessmentType, 'AUTOMATIC');
        assert.strictEqual(r.testCaseCount, 10);
        assert.strictEqual(r.passedTestCaseCount, 9);
        assert.strictEqual(r.codeIssueCount, 1);
    });

    test('handles missing optional fields', () => {
        const r = ResultDTO.fromJSON({ id: 1 });
        assert.strictEqual(r.completionDate, undefined);
        assert.strictEqual(r.successful, undefined);
        assert.strictEqual(r.participation, undefined);
        assert.strictEqual(r.feedbacks, undefined);
        assert.strictEqual(r.submission, undefined);
    });

    test('parses inline participation and submission objects', () => {
        const r = ResultDTO.fromJSON({
            id: 1,
            participation: { id: 2, type: 'student' },
            submission: { id: 3, buildFailed: true },
        });
        assert.deepStrictEqual(r.participation, { id: 2, type: 'student' });
        assert.deepStrictEqual(r.submission, { id: 3, buildFailed: true });
    });

    test('parses nested feedbacks', () => {
        const r = ResultDTO.fromJSON({
            id: 1,
            feedbacks: [{ id: 10, text: 'Good', credits: 5 }],
        });
        assert.ok(Array.isArray(r.feedbacks));
        assert.strictEqual(r.feedbacks!.length, 1);
        assert.ok(r.feedbacks![0] instanceof ArtemisFeedback);
        assert.strictEqual(r.feedbacks![0].text, 'Good');
    });

    test('throws on invalid input', () => {
        assert.throws(() => ResultDTO.fromJSON(null), /Invalid/);
        assert.throws(() => ResultDTO.fromJSON(undefined), /Invalid/);
    });
});

suite('BuildLogEntry', () => {
    test('parses complete valid JSON', () => {
        const e = BuildLogEntry.fromJSON({
            id: 1, time: '2025-01-15T10:00:00Z', log: 'Build started',
        });
        assert.ok(e instanceof BuildLogEntry);
        assert.strictEqual(e.id, 1);
        assert.strictEqual(e.time, '2025-01-15T10:00:00Z');
        assert.strictEqual(e.log, 'Build started');
    });

    test('coerces fields via String()/Number()', () => {
        const e = BuildLogEntry.fromJSON({ id: '1', time: 123, log: 456 });
        assert.strictEqual(e.id, 1);
        assert.strictEqual(e.time, '123');
        assert.strictEqual(e.log, '456');
    });

    test('throws on invalid input', () => {
        assert.throws(() => BuildLogEntry.fromJSON(null), /Invalid/);
        assert.throws(() => BuildLogEntry.fromJSON(undefined), /Invalid/);
    });
});

suite('ParsedBuildError', () => {
    test('parses complete valid JSON', () => {
        const e = ParsedBuildError.fromJSON({
            filePath: 'src/Main.java', line: 15, message: 'syntax error', column: 10,
        });
        assert.ok(e instanceof ParsedBuildError);
        assert.strictEqual(e.filePath, 'src/Main.java');
        assert.strictEqual(e.line, 15);
        assert.strictEqual(e.message, 'syntax error');
        assert.strictEqual(e.column, 10);
    });

    test('handles missing optional column', () => {
        const e = ParsedBuildError.fromJSON({
            filePath: 'src/Main.java', line: 15, message: 'error',
        });
        assert.strictEqual(e.column, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ParsedBuildError.fromJSON(null), /Invalid/);
        assert.throws(() => ParsedBuildError.fromJSON(undefined), /Invalid/);
    });
});

suite('WebviewMessage', () => {
    test('parses complete valid JSON', () => {
        const m = WebviewMessage.fromJSON({ command: 'test' });
        assert.ok(m instanceof WebviewMessage);
        assert.strictEqual(m.command, 'test');
    });

    test('throws on invalid input', () => {
        assert.throws(() => WebviewMessage.fromJSON(null), /Invalid/);
        assert.throws(() => WebviewMessage.fromJSON(undefined), /Invalid/);
    });
});

suite('LoginMessage', () => {
    test('parses complete valid JSON', () => {
        const m = LoginMessage.fromJSON({
            username: 'student1', password: 'secret', rememberMe: true,
        });
        assert.ok(m instanceof LoginMessage);
        assert.ok(m instanceof WebviewMessage);
        assert.strictEqual(m.command, 'login');
        assert.strictEqual(m.username, 'student1');
        assert.strictEqual(m.password, 'secret');
        assert.strictEqual(m.rememberMe, true);
    });

    test('sets command to login automatically', () => {
        const m = LoginMessage.fromJSON({
            command: 'ignored', username: 'u', password: 'p', rememberMe: false,
        });
        assert.strictEqual(m.command, 'login');
    });

    test('throws on invalid input', () => {
        assert.throws(() => LoginMessage.fromJSON(null), /Invalid/);
        assert.throws(() => LoginMessage.fromJSON(undefined), /Invalid/);
    });
});

suite('LogoutMessage', () => {
    test('parses valid JSON', () => {
        const m = LogoutMessage.fromJSON({});
        assert.ok(m instanceof LogoutMessage);
        assert.ok(m instanceof WebviewMessage);
        assert.strictEqual(m.command, 'logout');
    });

    test('throws on invalid input', () => {
        assert.throws(() => LogoutMessage.fromJSON(null), /Invalid/);
        assert.throws(() => LogoutMessage.fromJSON(undefined), /Invalid/);
    });
});

suite('LoginSuccessMessage', () => {
    test('parses complete valid JSON', () => {
        const m = LoginSuccessMessage.fromJSON({
            username: 'student1', serverUrl: 'https://artemis.example.com',
        });
        assert.ok(m instanceof LoginSuccessMessage);
        assert.ok(m instanceof WebviewMessage);
        assert.strictEqual(m.command, 'loginSuccess');
        assert.strictEqual(m.username, 'student1');
        assert.strictEqual(m.serverUrl, 'https://artemis.example.com');
    });

    test('handles missing optional user', () => {
        const m = LoginSuccessMessage.fromJSON({
            username: 'student1', serverUrl: 'https://artemis.example.com',
        });
        assert.strictEqual(m.user, undefined);
    });

    test('parses nested user', () => {
        const m = LoginSuccessMessage.fromJSON({
            username: 'student1', serverUrl: 'https://artemis.example.com',
            user: { login: 'student1', id: 42 },
        });
        assert.ok(m.user instanceof ArtemisUser);
        assert.strictEqual(m.user!.login, 'student1');
        assert.strictEqual(m.user!.id, 42);
    });

    test('throws on invalid input', () => {
        assert.throws(() => LoginSuccessMessage.fromJSON(null), /Invalid/);
        assert.throws(() => LoginSuccessMessage.fromJSON(undefined), /Invalid/);
    });
});

suite('LoginErrorMessage', () => {
    test('parses complete valid JSON', () => {
        const m = LoginErrorMessage.fromJSON({ error: 'Invalid credentials' });
        assert.ok(m instanceof LoginErrorMessage);
        assert.ok(m instanceof WebviewMessage);
        assert.strictEqual(m.command, 'loginError');
        assert.strictEqual(m.error, 'Invalid credentials');
    });

    test('throws on invalid input', () => {
        assert.throws(() => LoginErrorMessage.fromJSON(null), /Invalid/);
        assert.throws(() => LoginErrorMessage.fromJSON(undefined), /Invalid/);
    });
});

suite('LogoutSuccessMessage', () => {
    test('parses valid JSON', () => {
        const m = LogoutSuccessMessage.fromJSON({});
        assert.ok(m instanceof LogoutSuccessMessage);
        assert.ok(m instanceof WebviewMessage);
        assert.strictEqual(m.command, 'logoutSuccess');
    });

    test('throws on invalid input', () => {
        assert.throws(() => LogoutSuccessMessage.fromJSON(null), /Invalid/);
        assert.throws(() => LogoutSuccessMessage.fromJSON(undefined), /Invalid/);
    });
});
