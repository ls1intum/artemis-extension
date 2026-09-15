import * as path from 'path';

import type { ExerciseDetailsResponse } from '@shared/types';
import type { RepositoryBlocker, SubmissionSetupSnapshot } from '@shared/types/submissionSetup';

import { LogCategory, logger } from '@extension/services/loggingService';

import type { GitService } from './gitService';
import {
    type ExerciseSource,
    findExerciseByRepositoryUrl,
    normalizeRepositoryUrl,
} from './workspaceDetectionService';

/**
 * The participation that owns the remote in the open folder.
 *
 * Renewal needs both halves: the id to ask Artemis for a token, and the
 * server's own `repositoryUri` to build the new remote URL from. The workspace
 * remote is not usable for that second job, because the only form of it we can
 * compare with has been normalized (lowercased, `.git` stripped, http rewritten
 * to https) and writing that back would produce a URL git may not accept.
 */
export interface ResolvedParticipation {
    participationId: number;
    repositoryUri: string;
    exerciseTitle: string;
}

export interface SubmissionSetupDeps {
    git: GitService;
    /** The open folder, or undefined when no folder is open. */
    getWorkspaceFolder(): string | undefined;
    /** Everything this account's catalog knows about, for the exercise-id lookup. */
    getExerciseSources(): ExerciseSource[];
    getExerciseDetails(exerciseId: number): Promise<ExerciseDetailsResponse>;
}

/** What the repository inspection concluded, either a blocker or a resolved participation. */
type RepositoryOutcome =
    /** `blocker` is absent when git itself failed to answer, which is not one of the known shapes. */
    | { kind: 'blocked'; blocker?: RepositoryBlocker }
    | { kind: 'resolved'; participation: ResolvedParticipation; probeUrl: string | undefined };

/** Blockers that are an absence rather than something the student broke. */
const NEUTRAL_BLOCKERS: ReadonlySet<RepositoryBlocker> = new Set<RepositoryBlocker>([
    'no-folder', 'no-git', 'not-a-repo', 'no-origin', 'unmatched',
]);

function isHttpUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

/**
 * Computes the Submission Setup snapshot: the four preconditions for a push to
 * reach Artemis, plus enough context for the page to offer a repair.
 *
 * Nothing here caches. Every field answers the question "what is true right
 * now", and the two things that can change behind the extension's back, git
 * config and the remote's answer, are exactly the two the student comes to this
 * page to check.
 */
export class SubmissionSetupService {
    constructor(private readonly deps: SubmissionSetupDeps) {}

    public async buildSnapshot(): Promise<SubmissionSetupSnapshot> {
        const folder = this.deps.getWorkspaceFolder();
        const cwd = folder ?? process.cwd();

        const version = await this.deps.git.getVersion(cwd);
        if (!version) {
            // Without git nothing below can be measured, and every row would
            // report its own derived failure. Say the one true thing instead.
            return {
                git: { state: 'problem' },
                identity: { state: 'unknown', name: '', email: '' },
                repository: { state: 'unknown', blocker: 'no-git' },
                access: { state: 'unknown', reason: 'not-checked' },
            };
        }

        const identity = await this.deps.git.readIdentity(cwd);
        const repository = folder
            ? await this.inspectRepository(folder)
            : { kind: 'blocked' as const, blocker: 'no-folder' as const };

        const snapshot: SubmissionSetupSnapshot = {
            git: { state: 'ok', version },
            identity: {
                state: identity.name && identity.email ? 'ok' : 'problem',
                name: identity.name,
                email: identity.email,
            },
            repository: repository.kind === 'resolved'
                ? {
                    state: 'ok',
                    exerciseTitle: repository.participation.exerciseTitle,
                    folderName: folder ? path.basename(folder) : undefined,
                    participationId: repository.participation.participationId,
                }
                : {
                    state: !repository.blocker || NEUTRAL_BLOCKERS.has(repository.blocker) ? 'unknown' : 'problem',
                    folderName: folder ? path.basename(folder) : undefined,
                    blocker: repository.blocker,
                },
            access: { state: 'unknown', reason: 'not-checked' },
        };

        if (repository.kind === 'resolved') {
            const access = await this.deps.git.probeRemoteAccess(cwd, repository.probeUrl);
            snapshot.access = access === 'ok'
                ? { state: 'ok', checkedAt: Date.now() }
                : {
                    state: access === 'refused' ? 'problem' : 'unknown',
                    reason: access,
                    checkedAt: Date.now(),
                };
        }

        return snapshot;
    }

    /**
     * Re-resolve the participation for the open folder.
     *
     * Renewal calls this rather than trusting an id from the webview: the page
     * is the least authoritative thing in the chain, and the id ends up in a
     * request for a credential.
     */
    public async resolveParticipation(): Promise<ResolvedParticipation | undefined> {
        const folder = this.deps.getWorkspaceFolder();
        if (!folder) { return undefined; }
        const outcome = await this.inspectRepository(folder);
        return outcome.kind === 'resolved' ? outcome.participation : undefined;
    }

    /**
     * Everything the repository row needs, in the order a failure makes the
     * later questions meaningless.
     *
     * The push-side checks come before the participation lookup on purpose: a
     * checkout whose pushes go somewhere else is not a repository this page may
     * repair, and finding out which Artemis exercise its fetch URL belongs to
     * would only make the refusal look like an offer.
     */
    private async inspectRepository(folder: string): Promise<RepositoryOutcome> {
        try {
            return await this.inspectRepositoryOrThrow(folder);
        } catch (error: unknown) {
            // A git query that fails for an unexpected reason (an unreadable
            // config, a broken working copy) is not one of the shapes below, and
            // guessing which one it resembles would put a repair button on a
            // repository nobody has understood.
            logger.warn('Submission setup: a git query failed', LogCategory.VIEW, error);
            return { kind: 'blocked' };
        }
    }

    private async inspectRepositoryOrThrow(folder: string): Promise<RepositoryOutcome> {
        const git = this.deps.git;

        if (!await git.isInsideWorkTree(folder)) {
            return { kind: 'blocked', blocker: 'not-a-repo' };
        }

        const originUrl = await git.getRemoteUrl(folder);
        if (!originUrl) {
            return { kind: 'blocked', blocker: 'no-origin' };
        }

        // Git allows several `remote.origin.url` values and pushes to all of
        // them, so repairing the first would leave the rest dead.
        const originUrls = await git.getAllRemoteUrls(folder);
        const pushUrls = await git.getPushUrls(folder);
        if (pushUrls.length > 1 || originUrls.length > 1) {
            return { kind: 'blocked', blocker: 'multiple-push-urls' };
        }

        const effectivePushUrl = pushUrls[0] ?? originUrl;
        if (!isHttpUrl(originUrl) || !isHttpUrl(effectivePushUrl)) {
            return { kind: 'blocked', blocker: 'ssh-remote' };
        }

        const branch = await git.getCurrentBranch(folder);
        if (!branch) {
            return { kind: 'blocked', blocker: 'no-push-upstream' };
        }
        const branchRemote = await git.getConfigValue(`branch.${branch}.remote`, { cwd: folder });
        if (!branchRemote) {
            return { kind: 'blocked', blocker: 'no-push-upstream' };
        }
        if (branchRemote !== 'origin') {
            return { kind: 'blocked', blocker: 'other-push-remote' };
        }
        // A remote without a `merge` ref is a branch with no upstream: under the
        // default `push.default=simple` a plain `git push` refuses, and no
        // credential repair would change that.
        const branchMerge = await git.getConfigValue(`branch.${branch}.merge`, { cwd: folder });
        if (!branchMerge) {
            return { kind: 'blocked', blocker: 'no-push-upstream' };
        }

        const participation = await this.resolveParticipationFor(originUrl);
        if (!participation) {
            return { kind: 'blocked', blocker: 'unmatched' };
        }

        // The participation was resolved from the fetch URL, but a push follows
        // the push URL. If they are different repositories, repairing the one we
        // matched would leave the one that matters untouched, and rewriting the
        // push URL would redirect a deliberate setup at Artemis.
        if (pushUrls.length === 1
            && normalizeRepositoryUrl(pushUrls[0]) !== normalizeRepositoryUrl(participation.repositoryUri)) {
            return { kind: 'blocked', blocker: 'foreign-push-url' };
        }

        return {
            kind: 'resolved',
            participation,
            // Probe `origin` by name when nothing overrides it, so no tokenised
            // URL has to be spelled out in an argument list.
            probeUrl: pushUrls.length === 1 ? pushUrls[0] : undefined,
        };
    }

    /**
     * The exercise id comes from the catalog, the participation from the server.
     *
     * Two steps, because one is not enough: the catalog keeps a single
     * representative participation per exercise, normally the graded one, and a
     * practice checkout matches it only by degrading its URL. Stopping there
     * would hand a practice folder the graded participation, and renewal would
     * install a token minted for the wrong repository.
     */
    private async resolveParticipationFor(originUrl: string): Promise<ResolvedParticipation | undefined> {
        const match = findExerciseByRepositoryUrl(originUrl, this.deps.getExerciseSources());
        if (!match) { return undefined; }

        let details: ExerciseDetailsResponse;
        try {
            details = await this.deps.getExerciseDetails(match.id);
        } catch (error: unknown) {
            logger.warn('Submission setup: could not load exercise details', LogCategory.VIEW, error);
            return undefined;
        }

        const target = normalizeRepositoryUrl(originUrl);
        const participation = (details.exercise?.studentParticipations ?? []).find(
            p => typeof p.repositoryUri === 'string' && normalizeRepositoryUrl(p.repositoryUri) === target,
        );
        if (!participation || typeof participation.id !== 'number' || typeof participation.repositoryUri !== 'string') {
            return undefined;
        }

        return {
            participationId: participation.id,
            repositoryUri: participation.repositoryUri,
            exerciseTitle: details.exercise?.title ?? match.title,
        };
    }
}
