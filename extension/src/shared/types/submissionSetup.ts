/**
 * What the Submission Setup page shows: the four things that have to be true
 * before `git push` can carry a solution to Artemis, and, where one of them is
 * false, enough to act on it.
 *
 * The snapshot never carries a repository URL or a token. Every URL the
 * extension installs has a VCS access token in it, so putting one on the wire
 * would publish a credential to a webview that has no use for it.
 */

/**
 * `unknown` is not a third kind of failure, it is the absence of an answer: a
 * server we could not reach, or a folder we could not classify. It exists so an
 * offline student is never told their access is broken, the same reason
 * `DetectionOutcome` has `unavailable`.
 */
export type CheckState = 'ok' | 'problem' | 'unknown';

/**
 * Why the repository row cannot answer.
 *
 * The first four are plain absences. The last five are refusals: setups where
 * the page could technically write a new remote URL but must not, because doing
 * so would overwrite something the student built by hand, or would repair a
 * remote that is not the one their push uses.
 */
export type RepositoryBlocker =
    /** No folder is open. */
    | 'no-folder'
    /** Git is not installed, so nothing below it can be answered either. */
    | 'no-git'
    /** The open folder is not a git working tree. */
    | 'not-a-repo'
    /** A git repository, but without an `origin` remote. */
    | 'no-origin'
    /** `origin` (or the push URL) is not http(s); the extension only installs HTTPS token URLs. */
    | 'ssh-remote'
    /** The current branch pushes to a remote other than `origin`. */
    | 'other-push-remote'
    /** `origin` has several push URLs configured. */
    | 'multiple-push-urls'
    /** The configured push URL is a different repository than the participation we resolved. */
    | 'foreign-push-url'
    /** Detached HEAD, or a branch with no upstream: a plain `git push` fails regardless of credentials. */
    | 'no-push-upstream'
    /** A normal Artemis-looking remote that no exercise of this account matches. */
    | 'unmatched';

/** Why the access probe did not come back `ok`. */
export type AccessProblem =
    /** The remote answered, and refused the credential. */
    | 'refused'
    /** No answer at all: offline, DNS, timeout. */
    | 'unreachable'
    /** Not asked, because there is no repository to ask about. */
    | 'not-checked';

export interface SubmissionSetupSnapshot {
    git: { state: CheckState; version?: string };
    identity: { state: CheckState; name: string; email: string };
    repository: {
        state: CheckState;
        exerciseTitle?: string;
        folderName?: string;
        /** Present only when exactly one participation matched this remote; renewal needs it. */
        participationId?: number;
        blocker?: RepositoryBlocker;
    };
    access: { state: CheckState; reason?: AccessProblem; checkedAt?: number };
}
