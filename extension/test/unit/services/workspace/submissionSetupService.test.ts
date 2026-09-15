import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExerciseDetailsResponse } from '@shared/types';

import type { GitService } from '@extension/services/workspace/gitService';
import { SubmissionSetupService } from '@extension/services/workspace/submissionSetupService';
import type { ExerciseSource } from '@extension/services/workspace/workspaceDetectionService';

const GRADED_URL = 'https://artemis.example.com/git/COURSE/exercise-ge38nac.git';
const PRACTICE_URL = 'https://artemis.example.com/git/COURSE/exercise-practice-ge38nac.git';

/**
 * A git double whose every answer is the healthy one, so each test states only
 * the thing it is about. Every method the service calls is stubbed: a real
 * GitService here would shell out to git in whatever directory the test runner
 * happens to sit in.
 */
function fakeGit(overrides: Partial<Record<keyof GitService, unknown>> = {}): GitService {
    const base = {
        getVersion: sinon.stub().resolves('2.45.1'),
        readIdentity: sinon.stub().resolves({ name: 'Alex Example', email: 'alex@tum.de' }),
        isInsideWorkTree: sinon.stub().resolves(true),
        getRemoteUrl: sinon.stub().resolves(GRADED_URL),
        getPushUrls: sinon.stub().resolves([]),
        getCurrentBranch: sinon.stub().resolves('main'),
        getConfigValue: sinon.stub().resolves('origin'),
        probeRemoteAccess: sinon.stub().resolves('ok'),
    };
    return { ...base, ...overrides } as unknown as GitService;
}

/** The catalog's view: one exercise, carrying the graded repository URL. */
const SOURCES: ExerciseSource[] = [
    { id: 7, title: 'Sorting Algorithms', repositoryUri: GRADED_URL },
];

function detailsWith(participations: Array<{ id: number; repositoryUri: string }>): ExerciseDetailsResponse {
    return {
        exercise: {
            id: 7,
            title: 'Sorting Algorithms',
            studentParticipations: participations,
        },
    } as unknown as ExerciseDetailsResponse;
}

function makeService(
    git: GitService,
    opts: {
        folder?: string | undefined;
        sources?: ExerciseSource[];
        details?: () => Promise<ExerciseDetailsResponse>;
    } = {},
) {
    return new SubmissionSetupService({
        git,
        getWorkspaceFolder: () => ('folder' in opts ? opts.folder : '/tmp/exercise'),
        getExerciseSources: () => opts.sources ?? SOURCES,
        getExerciseDetails: opts.details
            ?? (async () => detailsWith([{ id: 99, repositoryUri: GRADED_URL }])),
    });
}

suite('SubmissionSetupService', () => {
    test('reports every check in order when the workspace is a healthy exercise checkout', async () => {
        const snapshot = await makeService(fakeGit()).buildSnapshot();

        assert.strictEqual(snapshot.git.state, 'ok');
        assert.strictEqual(snapshot.git.version, '2.45.1');
        assert.strictEqual(snapshot.identity.state, 'ok');
        assert.strictEqual(snapshot.repository.state, 'ok');
        assert.strictEqual(snapshot.repository.participationId, 99);
        assert.strictEqual(snapshot.repository.exerciseTitle, 'Sorting Algorithms');
        assert.strictEqual(snapshot.access.state, 'ok');
    });

    test('stops at the git row when git is missing, instead of deriving three more failures from it', async () => {
        const git = fakeGit({ getVersion: sinon.stub().resolves(undefined) });
        const probe = (git as unknown as { probeRemoteAccess: sinon.SinonStub }).probeRemoteAccess;

        const snapshot = await makeService(git).buildSnapshot();

        assert.strictEqual(snapshot.git.state, 'problem');
        assert.strictEqual(snapshot.repository.blocker, 'no-git');
        assert.strictEqual(snapshot.identity.state, 'unknown');
        assert.strictEqual(snapshot.access.reason, 'not-checked');
        sinon.assert.notCalled(probe);
    });

    test('separates no folder, no repository and no origin, which the git helpers collapse into one null', async () => {
        const noFolder = await makeService(fakeGit(), { folder: undefined }).buildSnapshot();
        assert.strictEqual(noFolder.repository.blocker, 'no-folder');

        const notARepo = await makeService(fakeGit({ isInsideWorkTree: sinon.stub().resolves(false) })).buildSnapshot();
        assert.strictEqual(notARepo.repository.blocker, 'not-a-repo');

        const noOrigin = await makeService(fakeGit({ getRemoteUrl: sinon.stub().resolves(undefined) })).buildSnapshot();
        assert.strictEqual(noOrigin.repository.blocker, 'no-origin');
    });

    test('reports a missing identity without touching the other rows', async () => {
        const git = fakeGit({ readIdentity: sinon.stub().resolves({ name: '', email: '' }) });

        const snapshot = await makeService(git).buildSnapshot();

        assert.strictEqual(snapshot.identity.state, 'problem');
        assert.strictEqual(snapshot.repository.state, 'ok');
    });

    test('resolves the practice participation for a practice checkout, not the graded one', async () => {
        // The catalog only knows the graded URL; the practice remote matches it
        // by degrading. If the lookup stopped there, renewal would mint a token
        // for the wrong repository.
        const git = fakeGit({ getRemoteUrl: sinon.stub().resolves(PRACTICE_URL) });
        const details = async () => detailsWith([
            { id: 99, repositoryUri: GRADED_URL },
            { id: 123, repositoryUri: PRACTICE_URL },
        ]);

        const snapshot = await makeService(git, { details }).buildSnapshot();

        assert.strictEqual(snapshot.repository.participationId, 123);
    });

    test('refuses to guess when no participation matches the remote exactly', async () => {
        const git = fakeGit({ getRemoteUrl: sinon.stub().resolves(PRACTICE_URL) });
        const details = async () => detailsWith([{ id: 99, repositoryUri: GRADED_URL }]);

        const snapshot = await makeService(git, { details }).buildSnapshot();

        assert.strictEqual(snapshot.repository.state, 'unknown');
        assert.strictEqual(snapshot.repository.blocker, 'unmatched');
        assert.strictEqual(snapshot.repository.participationId, undefined);
    });

    test('an unreachable details endpoint leaves the row unknown rather than "not an exercise"', async () => {
        const details = async () => { throw new Error('network down'); };

        const snapshot = await makeService(fakeGit(), { details }).buildSnapshot();

        assert.strictEqual(snapshot.repository.state, 'unknown');
        assert.strictEqual(snapshot.access.reason, 'not-checked');
    });

    test('refuses an SSH remote instead of probing it', async () => {
        const git = fakeGit({ getRemoteUrl: sinon.stub().resolves('git@artemis.example.com:COURSE/exercise.git') });
        const probe = (git as unknown as { probeRemoteAccess: sinon.SinonStub }).probeRemoteAccess;

        const snapshot = await makeService(git).buildSnapshot();

        assert.strictEqual(snapshot.repository.blocker, 'ssh-remote');
        assert.strictEqual(snapshot.repository.state, 'problem');
        sinon.assert.notCalled(probe);
    });

    test('refuses several push URLs, a detached HEAD, a branch with no remote, and a foreign remote', async () => {
        const several = await makeService(fakeGit({
            getPushUrls: sinon.stub().resolves([GRADED_URL, PRACTICE_URL]),
        })).buildSnapshot();
        assert.strictEqual(several.repository.blocker, 'multiple-push-urls');

        const detached = await makeService(fakeGit({
            getCurrentBranch: sinon.stub().resolves(undefined),
        })).buildSnapshot();
        assert.strictEqual(detached.repository.blocker, 'no-push-upstream');

        const noUpstream = await makeService(fakeGit({
            getConfigValue: sinon.stub().resolves(undefined),
        })).buildSnapshot();
        assert.strictEqual(noUpstream.repository.blocker, 'no-push-upstream');

        const otherRemote = await makeService(fakeGit({
            getConfigValue: sinon.stub().resolves('upstream'),
        })).buildSnapshot();
        assert.strictEqual(otherRemote.repository.blocker, 'other-push-remote');
    });

    test('refuses a push URL that is a different repository than the participation', async () => {
        // Resolution reads the fetch URL; a push follows the push URL. Repairing
        // the one we matched would leave the one that matters untouched.
        const git = fakeGit({ getPushUrls: sinon.stub().resolves(['https://example.com/mirror.git']) });

        const snapshot = await makeService(git).buildSnapshot();

        assert.strictEqual(snapshot.repository.blocker, 'foreign-push-url');
    });

    test('probes the push URL when one is configured, and origin by name when none is', async () => {
        const withPushUrl = fakeGit({ getPushUrls: sinon.stub().resolves([GRADED_URL]) });
        await makeService(withPushUrl).buildSnapshot();
        sinon.assert.calledWith(
            (withPushUrl as unknown as { probeRemoteAccess: sinon.SinonStub }).probeRemoteAccess,
            '/tmp/exercise', GRADED_URL,
        );

        const plain = fakeGit();
        await makeService(plain).buildSnapshot();
        sinon.assert.calledWith(
            (plain as unknown as { probeRemoteAccess: sinon.SinonStub }).probeRemoteAccess,
            '/tmp/exercise', undefined,
        );
    });

    test('a refused probe is a problem, an unreachable one is not', async () => {
        const refused = await makeService(fakeGit({
            probeRemoteAccess: sinon.stub().resolves('refused'),
        })).buildSnapshot();
        assert.strictEqual(refused.access.state, 'problem');
        assert.strictEqual(refused.access.reason, 'refused');

        const offline = await makeService(fakeGit({
            probeRemoteAccess: sinon.stub().resolves('unreachable'),
        })).buildSnapshot();
        assert.strictEqual(offline.access.state, 'unknown');
        assert.strictEqual(offline.access.reason, 'unreachable');
    });

    test('resolveParticipation answers only for a repository the page may repair', async () => {
        const resolved = await makeService(fakeGit()).resolveParticipation();
        assert.strictEqual(resolved?.participationId, 99);
        // The raw server URL, not the normalized comparison form.
        assert.strictEqual(resolved?.repositoryUri, GRADED_URL);

        const refusedSetup = await makeService(fakeGit({
            getPushUrls: sinon.stub().resolves([GRADED_URL, PRACTICE_URL]),
        })).resolveParticipation();
        assert.strictEqual(refusedSetup, undefined);
    });
});
