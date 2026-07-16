/**
 * Minimal vscode module stub for vitest.
 * Only provides the symbols transitively needed by replay engine tests.
 */
export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
}

export const Uri = {
    parse(value: string) {
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            return { scheme: '', authority: '', path: value, fsPath: value, toString: () => value };
        }
        const path = decodeURIComponent(url.pathname);
        return { scheme: url.protocol.replace(':', ''), authority: url.host, path, fsPath: path, toString: () => value };
    },
};

export const commands = {
    executeCommand: async (..._args: unknown[]): Promise<undefined> => undefined,
};
