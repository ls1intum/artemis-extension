import * as vscode from 'vscode';
import { InactivityPattern } from './types';

/**
 * Service that detects and classifies user inactivity patterns.
 * Helps identify when a student might be confused or giving up.
 */
export class InactivityService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _lastEditTimestamp: number = Date.now();
    /**
     * Weak activity timestamp for cursor movements.
     * Cursor movement counts as 'weak activity' - it prevents transition
     * from 'active' to 'thinking', but does NOT reset deeper inactivity states.
     * This follows research showing cursor movement without editing often
     * indicates confusion/reading rather than productive work.
     */
    private _lastWeakActivityTimestamp: number = Date.now();
    private _currentPattern: InactivityPattern = 'active';
    private _patternCheckTimer: NodeJS.Timeout | undefined;

    /** Pattern check interval (5 seconds) */
    private static readonly PATTERN_CHECK_INTERVAL_MS = 5000;

    /**
     * Thresholds for inactivity patterns (in milliseconds).
     * Based on Gorson et al.'s research showing productive pauses are typically < 90s,
     * with longer pauses indicating potential confusion or disengagement.
     */
    private static readonly THRESHOLDS = {
        ACTIVE: 30 * 1000,           // < 30 seconds
        THINKING: 90 * 1000,         // 30s - 90 seconds (Gorson et al.: productive pauses < 90s)
        CONFUSION: 5 * 60 * 1000,    // 90s - 5 minutes
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

        // Track cursor movement as WEAK activity only
        // Cursor movement prevents 'active' -> 'thinking' transition
        // but does NOT reset deeper inactivity states ('thinking' -> 'confusion' or 'confusion' -> 'giving-up')
        // Research shows cursor movement without editing often indicates confusion/reading
        const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor.document.uri.scheme === 'file') {
                this._recordWeakActivity();
            }
        });
        this._disposables.push(selectionListener);
    }

    /**
     * Record strong user activity (actual edits/saves).
     * This fully resets all inactivity timers.
     */
    private _recordActivity(): void {
        const now = Date.now();
        this._lastEditTimestamp = now;
        this._lastWeakActivityTimestamp = now;
        const newPattern = this._classifyPattern();

        if (newPattern !== this._currentPattern) {
            this._currentPattern = newPattern;
            this._onDidChangePattern.fire(this._currentPattern);
        }
    }

    /**
     * Record weak user activity (cursor movement without editing).
     * Only prevents transition from 'active' to 'thinking'.
     * Does NOT reset deeper inactivity states.
     * 
     * Rationale: Cursor movement during confusion/struggle often indicates
     * the student is reading/scrolling without making progress, not productive work.
     */
    private _recordWeakActivity(): void {
        this._lastWeakActivityTimestamp = Date.now();
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
     * Classify the current inactivity pattern based on activity timestamps.
     * 
     * Uses graduated activity tracking:
     * - 'active': Recent strong activity (edits) OR weak activity (cursor)
     * - 'thinking': No recent activity, but within productive pause window (< 90s from last edit)
     * - 'confusion': Extended inactivity (90s - 5min from last edit)
     * - 'giving-up': Prolonged inactivity (> 5min from last edit)
     * 
     * Weak activity (cursor movement) only prevents 'active' -> 'thinking' transition.
     */
    private _classifyPattern(): InactivityPattern {
        const now = Date.now();
        const elapsedSinceEdit = now - this._lastEditTimestamp;
        const elapsedSinceWeakActivity = now - this._lastWeakActivityTimestamp;

        // For 'active' state: consider BOTH strong and weak activity
        // This prevents cursor movement from being completely ignored
        if (elapsedSinceEdit < InactivityService.THRESHOLDS.ACTIVE ||
            elapsedSinceWeakActivity < InactivityService.THRESHOLDS.ACTIVE) {
            return 'active';
        }
        
        // For deeper states: use only strong activity (edits)
        // Cursor movement during confusion doesn't indicate progress
        if (elapsedSinceEdit < InactivityService.THRESHOLDS.THINKING) {
            return 'thinking';
        } else if (elapsedSinceEdit < InactivityService.THRESHOLDS.CONFUSION) {
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
     * Get time elapsed since last edit in milliseconds.
     * Only considers strong activity (edits/saves) — used for pattern classification.
     */
    public getTimeSinceLastEdit(): number {
        return Date.now() - this._lastEditTimestamp;
    }

    /**
     * Get time elapsed since last activity of any kind (edit, save, cursor, selection).
     * Paper (P11): Idle = "no code edit, caret movement, or selection change."
     * Used for idle-trigger detection (all activity resets idle).
     */
    public getTimeSinceLastActivity(): number {
        return Date.now() - Math.max(this._lastEditTimestamp, this._lastWeakActivityTimestamp);
    }

    /**
     * Reset the last edit timestamp (e.g., when starting a new session)
     */
    public reset(): void {
        const now = Date.now();
        this._lastEditTimestamp = now;
        this._lastWeakActivityTimestamp = now;
        this._currentPattern = 'active';
    }

    /**
     * TEST ONLY: Record activity manually (bypasses document scheme check)
     * Used by test runner to simulate edits on untitled documents.
     */
    public _testRecordActivity(): void {
        this._recordActivity();
    }
}
