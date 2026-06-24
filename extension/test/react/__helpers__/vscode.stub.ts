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

/** Minimal disposable matching the vscode.Disposable shape. */
export interface Disposable {
    dispose(): void;
}

export const Disposable = {
    from(...disposables: Disposable[]): Disposable {
        return { dispose: () => { for (const d of disposables) { d.dispose(); } } };
    },
};

type Listener<T> = (e: T) => void;

/**
 * Real-enough EventEmitter so extension-host code that constructs
 * vscode.EventEmitter (e.g. StruggleEngine's onDidTick/onDidAlert, the test
 * sensor hub) is constructable and behaves correctly under vitest. Mirrors the
 * subset of the vscode.EventEmitter contract those consumers use: subscribe via
 * `.event`, emit via `.fire(value)`, tear down via `.dispose()`.
 */
export class EventEmitter<T> {
    private readonly _listeners = new Set<Listener<T>>();

    readonly event = (listener: Listener<T>): Disposable => {
        this._listeners.add(listener);
        return { dispose: () => { this._listeners.delete(listener); } };
    };

    fire(data: T): void {
        // Test-oriented: one listener throwing must not stop the others (the
        // real event-bus property), but the first error is rethrown after all
        // listeners run so assertions inside a listener stay visible under vitest.
        let firstError: unknown;
        for (const listener of [...this._listeners]) {
            try {
                listener(data);
            } catch (err) {
                if (firstError === undefined) {
                    firstError = err;
                }
            }
        }
        if (firstError !== undefined) {
            throw firstError;
        }
    }

    dispose(): void {
        this._listeners.clear();
    }
}
