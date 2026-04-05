import * as vscode from 'vscode';
import { SessionResettable, SessionStartContext, TrackedDiagnostic } from './types';
import * as crypto from 'crypto';

/**
 * Service that tracks VS Code Language Server diagnostics over time.
 * Monitors how long errors persist and counts repeated occurrences.
 */
export class DiagnosticPersistenceService implements vscode.Disposable, SessionResettable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _trackedDiagnostics: Map<string, TrackedDiagnostic> = new Map();
    private _cleanupTimer: NodeJS.Timeout | undefined;

    /** Delay before cleaning up resolved diagnostics (5 seconds) */
    private static readonly CLEANUP_DELAY_MS = 5000;
    /** Cleanup interval (30 seconds) */
    private static readonly CLEANUP_INTERVAL_MS = 30000;

    private readonly _onDidUpdateDiagnostics = new vscode.EventEmitter<TrackedDiagnostic[]>();
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

    /**
     * Generate a unique ID for a diagnostic based on file, line, and code
     */
    private _generateDiagnosticId(uri: vscode.Uri, diagnostic: vscode.Diagnostic): string {
        const data = `${uri.toString()}:${diagnostic.range.start.line}:${diagnostic.code ?? 'unknown'}`;
        return crypto.createHash('md5').update(data).digest('hex').substring(0, 16);
    }

    /**
     * Start listening to diagnostic changes
     */
    private _startTracking(): void {
        const diagnosticListener = vscode.languages.onDidChangeDiagnostics(event => {
            this._handleDiagnosticChange(event);
        });
        this._disposables.push(diagnosticListener);

        // Process existing diagnostics on startup
        this._processAllWorkspaceDiagnostics();
    }

    /**
     * Start periodic cleanup of resolved diagnostics
     */
    private _startCleanupTimer(): void {
        this._cleanupTimer = setInterval(() => {
            this._cleanupResolvedDiagnostics();
        }, DiagnosticPersistenceService.CLEANUP_INTERVAL_MS);
    }

    /**
     * Process all diagnostics in the workspace
     */
    private _processAllWorkspaceDiagnostics(): void {
        const allDiagnostics = vscode.languages.getDiagnostics();
        for (const [uri, diagnostics] of allDiagnostics) {
            this._updateDiagnosticsForUri(uri, diagnostics);
        }
    }

    /**
     * Handle diagnostic change events
     */
    private _handleDiagnosticChange(event: vscode.DiagnosticChangeEvent): void {
        const now = Date.now();

        for (const uri of event.uris) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            this._updateDiagnosticsForUri(uri, diagnostics);
        }

        // Mark diagnostics that no longer exist as resolved
        this._markMissingDiagnosticsResolved(event.uris, now);

        this._onDidUpdateDiagnostics.fire(Array.from(this._trackedDiagnostics.values()));
    }

    /**
     * Update tracked diagnostics for a specific URI
     */
    private _updateDiagnosticsForUri(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): void {
        const now = Date.now();
        const currentIds = new Set<string>();

        for (const diagnostic of diagnostics) {
            // Only track errors and warnings
            if (diagnostic.severity > vscode.DiagnosticSeverity.Warning) {
                continue;
            }

            const id = this._generateDiagnosticId(uri, diagnostic);
            currentIds.add(id);

            const existing = this._trackedDiagnostics.get(id);
            if (existing) {
                // Update existing diagnostic
                existing.lastSeen = now;
                existing.occurrences++;
                existing.resolved = false;
            } else {
                // Track new diagnostic
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

        // Mark diagnostics from this URI that are no longer present as resolved
        for (const [id, tracked] of this._trackedDiagnostics) {
            if (tracked.uri === uri.toString() && !currentIds.has(id) && !tracked.resolved) {
                tracked.resolved = true;
            }
        }
    }

    /**
     * Mark diagnostics that are no longer present as resolved
     */
    private _markMissingDiagnosticsResolved(changedUris: readonly vscode.Uri[], now: number): void {
        const changedUriStrings = new Set(changedUris.map(u => u.toString()));

        for (const [id, tracked] of this._trackedDiagnostics) {
            if (changedUriStrings.has(tracked.uri) && !tracked.resolved) {
                // Check if this diagnostic still exists
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

    /**
     * Cleanup resolved diagnostics after delay
     */
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
     * TEST ONLY: Inject diagnostics directly for testing purposes.
     * This bypasses the VS Code diagnostic API and allows tests to simulate diagnostics.
     * @internal
     */
    public _testInjectDiagnostic(diagnostic: TrackedDiagnostic): void {
        this._trackedDiagnostics.set(diagnostic.id, diagnostic);
        this._onDidUpdateDiagnostics.fire(Array.from(this._trackedDiagnostics.values()));
    }

    /**
     * TEST ONLY: Clear a specific diagnostic by ID for testing purposes.
     * @internal
     */
    public _testClearDiagnostic(id: string): void {
        const tracked = this._trackedDiagnostics.get(id);
        if (tracked) {
            tracked.resolved = true;
        }
        this._onDidUpdateDiagnostics.fire(Array.from(this._trackedDiagnostics.values()));
    }

    /**
     * SessionResettable — drop pre-session workspace diagnostics and re-read
     * the current workspace snapshot.
     *
     * Why: when the very first session of the extension lifetime starts,
     * endExerciseSession() was never called, so the map still contains
     * diagnostics that the constructor collected at extension activation.
     * Those stale entries can auto-resolve mid-session and trigger a false
     * recordProgress() via TelemetryManager's all-errors-resolved handler.
     *
     * We intentionally do NOT fire onDidUpdateDiagnostics here — firing a
     * fresh empty/clean snapshot would itself trigger the same false-progress
     * path. Consumers observe the updated state on the next real diagnostic
     * change event.
     */
    public onSessionStart(_context: SessionStartContext): void {
        this._trackedDiagnostics.clear();
        this._processAllWorkspaceDiagnostics();
    }

    /**
     * SessionResettable — clear stale diagnostics when the exercise session ends.
     */
    public onSessionEnd(): void {
        this.reset();
    }

    /**
     * Reset tracked diagnostics for a new exercise session.
     * Clears all state so stale diagnostics from the previous exercise don't leak.
     */
    public reset(): void {
        this._trackedDiagnostics.clear();
        this._onDidUpdateDiagnostics.fire([]);
    }

    /**
     * TEST ONLY: Clear all tracked diagnostics for testing purposes.
     * @internal
     */
    public _testClearAllDiagnostics(): void {
        this.reset();
    }
}
