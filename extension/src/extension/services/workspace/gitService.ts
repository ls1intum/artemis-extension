import { execFile } from 'child_process';
import { promisify } from 'util';

import { extractRedactedErrorMessage } from '@extension/utils';

const execFileAsync = promisify(execFile);

/** How long a remote-touching probe may run before it counts as unreachable. */
const REMOTE_PROBE_TIMEOUT_MS = 10_000;

interface GitCommandOptions {
    cwd: string;
    timeout?: number;
}

interface GitIdentity {
    name: string;
    email: string;
}

/**
 * What a credential got us when we asked the remote.
 *
 * `refused` is the remote answering "not with this credential", `unreachable`
 * is never having got an answer at all. They must not collapse into one: only
 * the first is worth offering a repair for, and telling an offline student that
 * their access is broken sends them fixing something that works.
 */
export type RemoteAccess = 'ok' | 'refused' | 'unreachable';

/**
 * Git failures that mean the remote rejected the credential.
 *
 * A 404 sits in this list on purpose: a private repository answers an
 * unauthorized request with "not found" as often as with "forbidden", so the
 * text cannot tell the two apart. The copy that reports this says the remote
 * refused access, never that a token expired.
 */
const AUTH_FAILURE_PATTERN =
    /authentication failed|invalid username|access denied|http basic|could not read username|repository not found|\b401\b|\b403\b|\b404\b/i;

/** True when a git failure is the remote rejecting the credential rather than a transport problem. */
export function isAuthFailureText(text: string): boolean {
    return AUTH_FAILURE_PATTERN.test(text);
}

export class GitService {
    public async isGitAvailable(): Promise<boolean> {
        try {
            await execFileAsync('git', ['--version']);
            return true;
        } catch {
            return false;
        }
    }

    public async pullWithRebase(options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['pull', '--rebase'], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    public async addAll(options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['add', '-A'], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    public async commit(message: string, options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['commit', '-m', message], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    public async push(options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['push'], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    /**
     * The single seam every new git call goes through, so a test can stub one
     * method instead of the child-process module.
     *
     * `env` is merged over the inherited environment rather than replacing it:
     * a student's proxy settings, credential configuration and `PATH` all live
     * there, and a probe that ran without them would answer a different
     * question than the one the submit flow asks.
     */
    public async runGit(
        args: string[],
        options: GitCommandOptions & { env?: NodeJS.ProcessEnv },
    ): Promise<{ stdout: string; stderr: string }> {
        const { stdout, stderr } = await execFileAsync('git', args, {
            cwd: options.cwd,
            timeout: options.timeout,
            env: options.env ? { ...process.env, ...options.env } : undefined,
        });
        return { stdout: stdout.toString(), stderr: stderr.toString() };
    }

    /** The installed git version, or undefined when git is not on the PATH. */
    public async getVersion(cwd: string): Promise<string | undefined> {
        try {
            const { stdout } = await this.runGit(['--version'], { cwd });
            // "git version 2.45.1" -> "2.45.1"
            return stdout.trim().replace(/^git version\s*/i, '') || undefined;
        } catch {
            return undefined;
        }
    }

    /** Whether `cwd` is inside a git working tree. False for a plain folder, and when git is missing. */
    public async isInsideWorkTree(cwd: string): Promise<boolean> {
        try {
            const { stdout } = await this.runGit(['rev-parse', '--is-inside-work-tree'], { cwd });
            return stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    /** The fetch URL of `origin`, or undefined when there is no such remote. */
    public async getRemoteUrl(cwd: string, remote = 'origin'): Promise<string | undefined> {
        try {
            const { stdout } = await this.runGit(['remote', 'get-url', remote], { cwd });
            return stdout.trim() || undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Every configured push URL of `origin`.
     *
     * Empty when none is configured, which is the normal case and means pushes
     * follow the fetch URL. More than one is a deliberate hand-built setup the
     * caller must refuse to rewrite rather than guess at.
     */
    public async getPushUrls(cwd: string, remote = 'origin'): Promise<string[]> {
        try {
            const { stdout } = await this.runGit(['config', '--get-all', `remote.${remote}.pushurl`], { cwd });
            return stdout.split('\n').map(line => line.trim()).filter(Boolean);
        } catch {
            return [];
        }
    }

    /**
     * The checked-out branch, or undefined on a detached HEAD.
     *
     * A detached HEAD is not an error state here, it is a reason the page must
     * stop: `git push` with no branch fails whatever the credential says.
     */
    public async getCurrentBranch(cwd: string): Promise<string | undefined> {
        try {
            const { stdout } = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
            const branch = stdout.trim();
            return branch && branch !== 'HEAD' ? branch : undefined;
        } catch {
            return undefined;
        }
    }

    /** The URL a push to `origin` would actually use: its push URL when one is configured, else the fetch URL. */
    public async getEffectivePushUrl(cwd: string, remote = 'origin'): Promise<string | undefined> {
        const pushUrls = await this.getPushUrls(cwd, remote);
        return pushUrls[0] ?? await this.getRemoteUrl(cwd, remote);
    }

    /**
     * Ask a remote whether the credential we have still works.
     *
     * Deliberately `ls-remote` without `--exit-code` and without a ref: with
     * `--exit-code` git answers 2 for "ref not found", so an empty or
     * freshly-created repository, which authenticates perfectly well, would be
     * reported as broken.
     *
     * The prompts are neutralised rather than trusted to stay quiet: without
     * `GIT_TERMINAL_PROMPT=0` git can block forever on a password prompt in a
     * child process with no terminal, and `GIT_ASKPASS=echo` answers an empty
     * string instead of opening the platform's credential dialog. Disabling the
     * credential helper keeps the macOS keychain from silently supplying some
     * other credential and answering a question we did not ask.
     */
    public async probeRemoteAccess(cwd: string, url?: string): Promise<RemoteAccess> {
        try {
            await this.runGit(['-c', 'credential.helper=', 'ls-remote', url ?? 'origin'], {
                cwd,
                timeout: REMOTE_PROBE_TIMEOUT_MS,
                env: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
            });
            return 'ok';
        } catch (error: unknown) {
            return isAuthFailureText(extractRedactedErrorMessage(error)) ? 'refused' : 'unreachable';
        }
    }

    /**
     * Point `origin` at `url`, keeping fetch and push in step.
     *
     * Atomic by contract: the fetch URL is read before the first write and put
     * back if the push write throws, so no caller can observe a remote whose
     * fetch URL carries a fresh token while its push URL keeps the dead one. The
     * push URL itself needs no capture: the only write that can fail is the one
     * that would have changed it. A rollback that fails is surfaced, not
     * swallowed, because the repository is then in a state only the student can
     * fix.
     */
    public async setRemoteUrl(cwd: string, url: string, options: { alsoPush: boolean }): Promise<void> {
        const previousFetch = await this.getRemoteUrl(cwd);

        await this.runGit(['remote', 'set-url', 'origin', url], { cwd });

        if (!options.alsoPush) {
            return;
        }

        try {
            await this.runGit(['remote', 'set-url', '--push', 'origin', url], { cwd });
        } catch (error: unknown) {
            if (previousFetch) {
                try {
                    await this.runGit(['remote', 'set-url', 'origin', previousFetch], { cwd });
                } catch (rollbackError: unknown) {
                    throw new Error(
                        `${extractRedactedErrorMessage(error)} (and the fetch URL could not be restored: `
                        + `${extractRedactedErrorMessage(rollbackError)})`,
                    );
                }
            }
            throw new Error(extractRedactedErrorMessage(error));
        }
    }

    public async getConfigValue(key: string, options: GitCommandOptions, globalScope = false): Promise<string | undefined> {
        try {
            const args = globalScope
                ? ['config', '--global', '--get', key]
                : ['config', '--get', key];

            const { stdout } = await execFileAsync('git', args, {
                cwd: options.cwd,
                timeout: options.timeout
            });
            return stdout.trim();
        } catch {
            return undefined;
        }
    }

    public async setGlobalConfig(key: string, value: string): Promise<void> {
        await execFileAsync('git', ['config', '--global', key, value]);
    }

    public async getIdentity(options: GitCommandOptions): Promise<GitIdentity | undefined> {
        const name = await this.getConfigValue('user.name', options);
        const email = await this.getConfigValue('user.email', options);

        if (name && email) {
            return { name, email };
        }
        return undefined;
    }

    /**
     * Read git identity with local-then-global fallback per field.
     * Always returns both fields (empty string if not configured).
     */
    public async readIdentity(cwd: string): Promise<GitIdentity> {
        const opts: GitCommandOptions = { cwd };
        const name = await this.getConfigValue('user.name', opts)
            || await this.getConfigValue('user.name', opts, true)
            || '';
        const email = await this.getConfigValue('user.email', opts)
            || await this.getConfigValue('user.email', opts, true)
            || '';
        return { name, email };
    }

    public async setGlobalIdentity(identity: GitIdentity): Promise<void> {
        await this.setGlobalConfig('user.name', identity.name);
        await this.setGlobalConfig('user.email', identity.email);
    }

}
