import * as vscode from 'vscode';
import * as crypto from 'crypto';

interface EditRecord {
    uri: string;
    contentHash: string;
    timestamp: number;
}

/**
 * Service that detects edit thrashing patterns (repeated similar edits).
 * Identifies when a student is making the same changes repeatedly,
 * which may indicate confusion or undo/redo cycling.
 */
export class ThrashingDetector implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _editHistory: EditRecord[] = [];
    
    /** Maximum number of edits to keep in history */
    private static readonly HISTORY_SIZE = 20;
    /** Time window to consider for thrashing detection (2 minutes) */
    private static readonly TIME_WINDOW_MS = 2 * 60 * 1000;
    /** Minimum repetitions to consider as thrashing */
    private static readonly MIN_REPETITIONS = 3;

    private readonly _onDidDetectThrashing = new vscode.EventEmitter<number>();
    public readonly onDidDetectThrashing = this._onDidDetectThrashing.event;

    constructor() {
        this._startTracking();
    }

    public dispose(): void {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }

        this._onDidDetectThrashing.dispose();
        this._editHistory.length = 0;
    }

    /**
     * Start tracking document changes
     */
    private _startTracking(): void {
        const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
            // Ignore non-file schemes and empty changes
            if (event.document.uri.scheme !== 'file' || event.contentChanges.length === 0) {
                return;
            }

            this._recordEdit(event.document.uri.toString(), event.document.getText());
        });
        this._disposables.push(changeListener);
    }

    /**
     * Generate a hash of document content
     */
    private _hashContent(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * Record an edit for thrashing detection
     */
    public recordEdit(uri: string, content: string): void {
        this._recordEdit(uri, content);
    }

    /**
     * Internal method to record edits
     */
    private _recordEdit(uri: string, content: string): void {
        const now = Date.now();
        const contentHash = this._hashContent(content);

        // Add to history
        this._editHistory.push({
            uri,
            contentHash,
            timestamp: now,
        });

        // Maintain ring buffer size
        while (this._editHistory.length > ThrashingDetector.HISTORY_SIZE) {
            this._editHistory.shift();
        }

        // Check for thrashing and emit event if score is high
        const score = this.getThrashingScore();
        if (score > 50) {
            this._onDidDetectThrashing.fire(score);
        }
    }

    /**
     * Calculate the thrashing score (0-100)
     * Higher scores indicate more thrashing behavior
     */
    public getThrashingScore(): number {
        const now = Date.now();
        const cutoff = now - ThrashingDetector.TIME_WINDOW_MS;

        // Filter to recent edits within time window
        const recentEdits = this._editHistory.filter(e => e.timestamp >= cutoff);

        if (recentEdits.length < ThrashingDetector.MIN_REPETITIONS) {
            return 0;
        }

        // Group edits by URI
        const editsByUri = new Map<string, EditRecord[]>();
        for (const edit of recentEdits) {
            const existing = editsByUri.get(edit.uri) ?? [];
            existing.push(edit);
            editsByUri.set(edit.uri, existing);
        }

        let maxRepetitionRatio = 0;

        for (const [uri, edits] of editsByUri) {
            if (edits.length < ThrashingDetector.MIN_REPETITIONS) {
                continue;
            }

            // Count unique content hashes
            const uniqueHashes = new Set(edits.map(e => e.contentHash));
            const repetitionRatio = 1 - (uniqueHashes.size / edits.length);

            // Also check for cycling patterns (A -> B -> A -> B)
            const cycleScore = this._detectCyclePattern(edits);

            const combinedRatio = Math.max(repetitionRatio, cycleScore);
            maxRepetitionRatio = Math.max(maxRepetitionRatio, combinedRatio);
        }

        // Convert ratio to score (0-100)
        return Math.round(maxRepetitionRatio * 100);
    }

    /**
     * Detect cycling patterns in edit history (A -> B -> A -> B)
     */
    private _detectCyclePattern(edits: EditRecord[]): number {
        if (edits.length < 4) {
            return 0;
        }

        let cycleCount = 0;
        const hashes = edits.map(e => e.contentHash);

        // Look for alternating patterns
        for (let i = 2; i < hashes.length; i++) {
            if (hashes[i] === hashes[i - 2] && hashes[i] !== hashes[i - 1]) {
                cycleCount++;
            }
        }

        // Calculate cycle ratio
        const maxPossibleCycles = hashes.length - 2;
        return maxPossibleCycles > 0 ? cycleCount / maxPossibleCycles : 0;
    }

    /**
     * Get edit frequency (edits per minute in the last time window)
     */
    public getEditFrequency(): number {
        const now = Date.now();
        const cutoff = now - ThrashingDetector.TIME_WINDOW_MS;
        const recentEdits = this._editHistory.filter(e => e.timestamp >= cutoff);

        const timeWindowMinutes = ThrashingDetector.TIME_WINDOW_MS / (60 * 1000);
        return recentEdits.length / timeWindowMinutes;
    }

    /**
     * Reset the edit history
     */
    public reset(): void {
        this._editHistory.length = 0;
    }
}
