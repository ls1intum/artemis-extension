import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface GitCommandOptions {
    cwd: string;
    timeout?: number;
}

interface GitIdentity {
    name: string;
    email: string;
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
