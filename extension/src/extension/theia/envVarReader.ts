import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

const ENV_READ_TIMEOUT_MS = 5_000;

/**
 * Reads an environment variable reliably across VS Code and Theia.
 *
 * In some Theia deployments, `process.env` is not populated with the host
 * environment variables (Scorpio issue #124). This function uses `printenv`
 * via child_process as the primary method and falls back to `process.env`.
 */
export async function readEnvVar(name: string): Promise<string | undefined> {
    // Validate name to prevent command injection
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return undefined;
    }

    try {
        const { stdout } = await execFileAsync('printenv', [name], {
            timeout: ENV_READ_TIMEOUT_MS,
        });
        const value = stdout.trim();
        return value || undefined;
    } catch {
        // printenv returns exit code 1 when the variable is not set,
        // or may fail entirely — fall back to process.env
        return process.env[name] || undefined;
    }
}

/**
 * Reads multiple environment variables in parallel.
 * Returns a record mapping variable names to their values (or undefined).
 */
export async function readEnvVars<T extends string>(
    names: readonly T[],
): Promise<Record<T, string | undefined>> {
    const entries = await Promise.all(
        names.map(async (name) => [name, await readEnvVar(name)] as const),
    );
    return Object.fromEntries(entries) as Record<T, string | undefined>;
}
