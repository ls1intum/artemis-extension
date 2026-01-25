import * as vscode from 'vscode';
import { InactivityPattern } from './types';

/**
 * Service that detects and classifies user inactivity patterns.
 * Helps identify when a student might be confused or giving up.
 */
export class InactivityService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _lastEditTimestamp: number = Date.now();
    private _currentPattern: InactivityPattern = 'active';
    private _patternCheckTimer: NodeJS.Timeout | undefined;

    /** Pattern check interval (5 seconds) */
    private static readonly PATTERN_CHECK_INTERVAL_MS = 5000;

    /** Thresholds for inactivity patterns (in milliseconds) */
    private static readonly THRESHOLDS = {
        ACTIVE: 30 * 1000,           // < 30 seconds
        THINKING: 2 * 60 * 1000,     // 30s - 2 minutes
        CONFUSION: 5 * 60 * 1000,    // 2 - 5 minutes
        // > 5 minutes = giving-up
    };

    private readonly _onDidChangePattern = new vscode.EventEmitter<InactivityPattern>();
    public readonly onDidChangePattern = this._onDidChangePattern.event;

    constructor() {
        this._startTracking();
        this._startPatternCheck();
    }

    public dispose(): void {
        if (this._patternCheckTimer) {
            clearInterval(this._patternCheckTimer);
            this._patternCheckTimer = undefined;
        }

        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }

        this._onDidChangePattern.dispose();
    }

    /**
     * Start listening to document changes
     */
    private _startTracking(): void {
        const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
            // Ignore non-file schemes and empty changes
            if (event.document.uri.scheme !== 'file' || event.contentChanges.length === 0) {
                return;
            }
            this._recordActivity();
        });
        this._disposables.push(changeListener);

        // Also track when user saves
        const saveListener = vscode.workspace.onDidSaveTextDocument(document => {
            if (document.uri.scheme === 'file') {
                this._recordActivity();
            }
        });
        this._disposables.push(saveListener);

        // Track cursor movement as a sign of activity
        const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor.document.uri.scheme === 'file') {
                // Only count significant selections/movements
                this._recordActivity();
            }
        });
        this._disposables.push(selectionListener);
    }

    /**
     * Record user activity
     */
    private _recordActivity(): void {
        this._lastEditTimestamp = Date.now();
        const newPattern = this._classifyPattern();
        
        if (newPattern !== this._currentPattern) {
            this._currentPattern = newPattern;
            this._onDidChangePattern.fire(this._currentPattern);
        }
    }

    /**
     * Start periodic pattern checking
     */
    private _startPatternCheck(): void {
        this._patternCheckTimer = setInterval(() => {
            const newPattern = this._classifyPattern();
            
            if (newPattern !== this._currentPattern) {
                this._currentPattern = newPattern;
                this._onDidChangePattern.fire(this._currentPattern);
            }
        }, InactivityService.PATTERN_CHECK_INTERVAL_MS);
    }

    /**
     * Classify the current inactivity pattern based on time since last edit
     */
    private _classifyPattern(): InactivityPattern {
        const elapsed = this.getTimeSinceLastEdit();

        if (elapsed < InactivityService.THRESHOLDS.ACTIVE) {
            return 'active';
        } else if (elapsed < InactivityService.THRESHOLDS.THINKING) {
            return 'thinking';
        } else if (elapsed < InactivityService.THRESHOLDS.CONFUSION) {
            return 'confusion';
        } else {
            return 'giving-up';
        }
    }

    /**
     * Get the current inactivity pattern
     */
    public getCurrentPattern(): InactivityPattern {
        // Always recalculate to ensure accuracy
        this._currentPattern = this._classifyPattern();
        return this._currentPattern;
    }

    /**
     * Get time elapsed since last edit in milliseconds
     */
    public getTimeSinceLastEdit(): number {
        return Date.now() - this._lastEditTimestamp;
    }

    /**
     * Reset the last edit timestamp (e.g., when starting a new session)
     */
    public reset(): void {
        this._lastEditTimestamp = Date.now();
        this._currentPattern = 'active';
    }
}
