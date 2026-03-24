import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitCommandOptions {
    cwd: string;
    timeout?: number;
}

export interface GitIdentity {
    name: string;
    email: string;
}

export class GitService {
    /**
     * Check if git is installed and available
     */
    public async isGitAvailable(): Promise<boolean> {
        try {
            await execFileAsync('git', ['--version']);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Pull changes with rebase
     */
    public async pullWithRebase(options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['pull', '--rebase'], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    /**
     * Stage all changes
     */
    public async addAll(options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['add', '-A'], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    /**
     * Commit changes with a message
     */
    public async commit(message: string, options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['commit', '-m', message], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    /**
     * Push changes to remote
     */
    public async push(options: GitCommandOptions): Promise<void> {
        await execFileAsync('git', ['push'], {
            cwd: options.cwd,
            timeout: options.timeout
        });
    }

    /**
     * Get a git config value (local or global)
     */
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

    /**
     * Set a git config value globally
     */
    public async setGlobalConfig(key: string, value: string): Promise<void> {
        await execFileAsync('git', ['config', '--global', key, value]);
    }

    /**
     * Get the current git identity (name and email)
     */
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

    /**
     * Set git identity globally
     */
    public async setGlobalIdentity(identity: GitIdentity): Promise<void> {
        await this.setGlobalConfig('user.name', identity.name);
        await this.setGlobalConfig('user.email', identity.email);
    }

    /**
     * Ensure git credential helper is configured
     */
    public async ensureCredentialHelper(): Promise<void> {
        try {
            const { stdout } = await execFileAsync('git', ['config', '--global', '--get', 'credential.helper']);
            if (!stdout.includes('store')) {
                await execFileAsync('git', ['config', '--global', 'credential.helper', 'store']);
            }
        } catch {
            // If getting the config fails, set it
            await execFileAsync('git', ['config', '--global', 'credential.helper', 'store']);
        }
    }

    /**
     * Store git credentials using git credential approve
     */
    public async storeCredentials(url: string, username: string, password: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('git', ['credential', 'approve']);

            const credentials = `protocol=https\nhost=${new URL(url).host}\nusername=${username}\npassword=${password}\n\n`;

            child.stdin.write(credentials);
            child.stdin.end();

            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Git credential approve failed with code ${code}`));
                }
            });

            child.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Check if there are uncommitted changes in the repository
     */
    public async hasUncommittedChanges(options: GitCommandOptions): Promise<boolean> {
        try {
            const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
                cwd: options.cwd,
                timeout: options.timeout
            });
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get the current branch name
     */
    public async getCurrentBranch(options: GitCommandOptions): Promise<string | undefined> {
        try {
            const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
                cwd: options.cwd,
                timeout: options.timeout
            });
            return stdout.trim();
        } catch {
            return undefined;
        }
    }

    /**
     * Check if the repository is clean (no uncommitted changes and up to date with remote)
     */
    public async isClean(options: GitCommandOptions): Promise<boolean> {
        const hasChanges = await this.hasUncommittedChanges(options);
        return !hasChanges;
    }
}
