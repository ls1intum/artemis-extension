import * as vscode from 'vscode';
import * as crypto from 'crypto';

import { SessionResettable, SessionStartContext, TrackedDiagnostic } from './types';

/**
 * Service that tracks VS Code Language Server diagnostics over time.
 * Monitors how long errors persist and counts repeated occurrences.
 */
export class DiagnosticPersistenceService implements vscode.Disposable, SessionResettable {
    private readonly _disposables: vscode.Disposable[] = [];
    protected readonly _trackedDiagnostics: Map<string, TrackedDiagnostic> = new Map();
    private _cleanupTimer: NodeJS.Timeout | undefined;

    /** Delay before cleaning up resolved diagnostics (5 seconds) */
    private static readonly CLEANUP_DELAY_MS = 5000;
    /** Cleanup interval (30 seconds) */
    private static readonly CLEANUP_INTERVAL_MS = 30000;

    protected readonly _onDidUpdateDiagnostics = new vscode.EventEmitter<TrackedDiagnostic[]>();
    public readonly onDidUpdateDiagnostics = this._onDidUpdateDiagnostics.event;

    constructor() {
        this._startTracking();
        this._startCleanupTimer();
    }

    public dispose(): void {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = undefined;
        }

        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }

        this._onDidUpdateDiagnostics.dispose();
        this._trackedDiagnostics.clear();
    }

    private _generateDiagnosticId(uri: vscode.Uri, diagnostic: vscode.Diagnostic): string {
        const data = `${uri.toString()}:${diagnostic.range.start.line}:${diagnostic.code ?? 'unknown'}`;
        return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
    }

    private _startTracking(): void {
        const diagnosticListener = vscode.languages.onDidChangeDiagnostics(event => {
            this._handleDiagnosticChange(event);
        });
        this._disposables.push(diagnosticListener);

        this._processAllWorkspaceDiagnostics();
    }

    private _startCleanupTimer(): void {
        this._cleanupTimer = setInterval(() => {
            this._cleanupResolvedDiagnostics();
        }, DiagnosticPersistenceService.CLEANUP_INTERVAL_MS);
    }

    private _processAllWorkspaceDiagnostics(): void {
        const allDiagnostics = vscode.languages.getDiagnostics();
        for (const [uri, diagnostics] of allDiagnostics) {
            this._updateDiagnosticsForUri(uri, diagnostics);
        }
    }

    private _handleDiagnosticChange(event: vscode.DiagnosticChangeEvent): void {
        for (const uri of event.uris) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            this._updateDiagnosticsForUri(uri, diagnostics);
        }

        this._markMissingDiagnosticsResolved(event.uris);

        this._onDidUpdateDiagnostics.fire(Array.from(this._trackedDiagnostics.values()));
    }

    private _updateDiagnosticsForUri(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): void {
        const now = Date.now();
        const currentIds = new Set<string>();

        for (const diagnostic of diagnostics) {
            if (diagnostic.severity > vscode.DiagnosticSeverity.Warning) {
                continue;
            }

            const id = this._generateDiagnosticId(uri, diagnostic);
            currentIds.add(id);

            const existing = this._trackedDiagnostics.get(id);
            if (existing) {
                existing.lastSeen = now;
                existing.occurrences++;
                existing.resolved = false;
            } else {
                const tracked: TrackedDiagnostic = {
                    id,
                    uri: uri.toString(),
                    range: {
                        startLine: diagnostic.range.start.line,
                        startCharacter: diagnostic.range.start.character,
                        endLine: diagnostic.range.end.line,
                        endCharacter: diagnostic.range.end.character,
                    },
                    code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code,
                    message: diagnostic.message,
                    severity: diagnostic.severity,
                    firstSeen: now,
                    lastSeen: now,
                    occurrences: 1,
                    resolved: false,
                };
                this._trackedDiagnostics.set(id, tracked);
            }
        }

        for (const [id, tracked] of this._trackedDiagnostics) {
            if (tracked.uri === uri.toString() && !currentIds.has(id) && !tracked.resolved) {
                tracked.resolved = true;
            }
        }
    }

    private _markMissingDiagnosticsResolved(changedUris: readonly vscode.Uri[]): void {
        const changedUriStrings = new Set(changedUris.map(u => u.toString()));

        for (const [id, tracked] of this._trackedDiagnostics) {
            if (changedUriStrings.has(tracked.uri) && !tracked.resolved) {
                const uri = vscode.Uri.parse(tracked.uri);
                const currentDiagnostics = vscode.languages.getDiagnostics(uri);
                const stillExists = currentDiagnostics.some(d =>
                    this._generateDiagnosticId(uri, d) === id
                );

                if (!stillExists) {
                    tracked.resolved = true;
                }
            }
        }
    }

    private _cleanupResolvedDiagnostics(): void {
        const now = Date.now();
        const toRemove: string[] = [];

        for (const [id, tracked] of this._trackedDiagnostics) {
            if (tracked.resolved && (now - tracked.lastSeen) > DiagnosticPersistenceService.CLEANUP_DELAY_MS) {
                toRemove.push(id);
            }
        }

        for (const id of toRemove) {
            this._trackedDiagnostics.delete(id);
        }
    }

    /**
     * Drops pre-session workspace diagnostics and re-reads the current
     * snapshot. On the first session of an extension lifetime the map still
     * holds diagnostics the constructor collected at activation; those stale
     * entries can auto-resolve mid-session and trigger a false recordProgress()
     * via TelemetryManager's all-errors-resolved handler.
     *
     * Deliberately does NOT fire onDidUpdateDiagnostics: a fresh clean snapshot
     * would trigger that same false-progress path. Consumers observe the new
     * state on the next real diagnostic change event.
     */
    public onSessionStart(_context: SessionStartContext): void {
        this._trackedDiagnostics.clear();
        this._processAllWorkspaceDiagnostics();
    }

    public onSessionEnd(): void {
        this.reset();
    }

    /** Clears all state so diagnostics from the previous exercise do not leak. */
    public reset(): void {
        this._trackedDiagnostics.clear();
        this._onDidUpdateDiagnostics.fire([]);
    }

}
