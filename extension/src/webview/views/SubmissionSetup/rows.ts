import type { RepositoryBlocker, SubmissionSetupSnapshot } from '@shared/types/submissionSetup';

/**
 * The copy for each row, kept out of the component so the wording can be read
 * and tested as data. Every string answers the same two questions in order:
 * what is true, and what the student can do about it.
 */

export type RowId = 'git' | 'identity' | 'repository' | 'access';

export interface Row {
    id: RowId;
    title: string;
    detail: string;
    state: 'ok' | 'problem' | 'unknown';
}

const BLOCKER_DETAIL: Record<RepositoryBlocker, string> = {
    'no-folder': 'No folder is open. Open your exercise folder, or clone an exercise first.',
    'no-git': 'Git is missing, so this cannot be checked.',
    'not-a-repo': 'This folder is not a Git repository, so it is not an exercise checkout.',
    'no-origin': 'This repository has no "origin" remote, so there is nowhere to submit to.',
    'ssh-remote': 'This repository uses an SSH remote. The extension manages HTTPS access only, so it will not change anything here.',
    'other-push-remote': 'Your current branch pushes to a remote other than "origin", so the extension leaves it alone.',
    'multiple-push-urls': 'This repository has several push URLs configured. That is a deliberate setup, so the extension leaves it alone.',
    'foreign-push-url': 'Your pushes go to a different repository than the Artemis one this folder fetches from, so the extension leaves it alone.',
    'no-push-upstream': 'This branch has no upstream, so a push cannot work yet. Check out the branch you cloned, or set an upstream.',
    'unmatched': 'This folder is a Git repository, but none of your Artemis exercises matches it.',
};

function repositoryDetail(snapshot: SubmissionSetupSnapshot): string {
    const { exerciseTitle, blocker } = snapshot.repository;
    if (exerciseTitle) { return exerciseTitle; }
    if (blocker) { return BLOCKER_DETAIL[blocker]; }
    return 'Could not tell what this folder is.';
}

function accessDetail(snapshot: SubmissionSetupSnapshot): string {
    switch (snapshot.access.reason) {
        case 'refused':
            // Never "your token expired": a refusal can equally be a repository
            // that moved or was deleted, and the student cannot tell the
            // difference from here either.
            return 'Artemis refused access to this repository. Renew to get a fresh access token.';
        case 'unreachable':
            return 'Could not reach Artemis. Check your connection, then recheck.';
        case 'not-checked':
            return 'Nothing to check without an exercise repository.';
        default:
            return 'Git can reach your repository.';
    }
}

/** The four rows, worst first. Within a group the canonical order is kept, so the page never reshuffles. */
export function buildRows(snapshot: SubmissionSetupSnapshot): Row[] {
    const rows: Row[] = [
        {
            id: 'git',
            title: 'Git installed',
            detail: snapshot.git.version
                ? snapshot.git.version
                : 'Git is not installed. Install it from git-scm.com, then reload the window.',
            state: snapshot.git.state,
        },
        {
            id: 'identity',
            title: 'Your identity',
            detail: snapshot.identity.state === 'ok'
                ? `${snapshot.identity.name} · ${snapshot.identity.email}`
                : 'Git has no name and email on this computer, so it cannot record who wrote a submission.',
            state: snapshot.identity.state,
        },
        {
            id: 'repository',
            title: 'Exercise repository',
            detail: repositoryDetail(snapshot),
            state: snapshot.repository.state,
        },
        {
            id: 'access',
            title: 'Artemis access',
            detail: accessDetail(snapshot),
            state: snapshot.access.state,
        },
    ];

    const rank = { problem: 0, unknown: 1, ok: 2 } as const;
    return [...rows].sort((a, b) => rank[a.state] - rank[b.state]);
}

/** The one-line verdict above the rows. */
export function buildBanner(snapshot: SubmissionSetupSnapshot): { text: string; tone: 'ok' | 'problem' | 'idle' } {
    const problems = [snapshot.git, snapshot.identity, snapshot.repository, snapshot.access]
        .filter(check => check.state === 'problem').length;

    if (problems > 0) {
        return {
            text: problems === 1
                ? 'One thing needs fixing before your next submission.'
                : `${problems} things need fixing before your next submission.`,
            tone: 'problem',
        };
    }
    if (snapshot.repository.state !== 'ok') {
        return { text: 'Your computer is set up. Open an exercise to check its Artemis access.', tone: 'idle' };
    }
    return { text: 'You are ready to submit.', tone: 'ok' };
}
