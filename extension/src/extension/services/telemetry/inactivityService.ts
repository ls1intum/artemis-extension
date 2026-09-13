import * as vscode from 'vscode';

import { InactivityPattern, SessionResettable, SessionStartContext } from './types';

/**
 * Service that detects and classifies user inactivity patterns.
 * Helps identify when a student might be confused or giving up.
 */
export class InactivityService implements vscode.Disposable, SessionResettable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _lastEditTimestamp: number = Date.now();
    /**
     * Cursor movement counts as 'weak activity': it prevents the transition
     * from 'active' to 'thinking' but does NOT reset deeper inactivity states,
     * because research shows cursor movement without editing often indicates
     * confused reading rather than productive work.
     */
    private _lastWeakActivityTimestamp: number = Date.now();
    private _currentPattern: InactivityPattern = 'active';
    private _patternCheckTimer: NodeJS.Timeout | undefined;

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

    /**
     * Fires once when the user resumes activity after being idle (>= ACTIVE threshold).
     * Used by BoundaryTriggerEmitter to re-arm the one-shot idle timer.
     */
    private readonly _onDidResumeActivity = new vscode.EventEmitter<void>();
    public readonly onDidResumeActivity = this._onDidResumeActivity.event;

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

        this._onDidResumeActivity.dispose();
    }

    private _startTracking(): void {
        const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.scheme !== 'file' || event.contentChanges.length === 0) {
                return;
            }
            this._recordActivity();
        });
        this._disposables.push(changeListener);

        const saveListener = vscode.workspace.onDidSaveTextDocument(document => {
            if (document.uri.scheme === 'file') {
                this._recordActivity();
            }
        });
        this._disposables.push(saveListener);

        // Cursor movement is WEAK activity only (see _lastWeakActivityTimestamp).
        const selectionListener = vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor.document.uri.scheme === 'file') {
                this._recordWeakActivity();
            }
        });
        this._disposables.push(selectionListener);
    }

    /** Strong activity (edits/saves): resets all inactivity timers. */
    protected _recordActivity(): void {
        const wasIdle = this.getTimeSinceLastActivity() >= InactivityService.THRESHOLDS.ACTIVE;
        const now = Date.now();
        this._lastEditTimestamp = now;
        this._lastWeakActivityTimestamp = now;
        this._currentPattern = this._classifyPattern();

        if (wasIdle) {
            this._onDidResumeActivity.fire();
        }
    }

    /** Weak activity (cursor movement): keeps 'active', never resets deeper states. */
    protected _recordWeakActivity(): void {
        const wasIdle = this.getTimeSinceLastActivity() >= InactivityService.THRESHOLDS.ACTIVE;
        this._lastWeakActivityTimestamp = Date.now();
        this._currentPattern = this._classifyPattern();

        if (wasIdle) {
            this._onDidResumeActivity.fire();
        }
    }

    private _startPatternCheck(): void {
        this._patternCheckTimer = setInterval(() => {
            this._currentPattern = this._classifyPattern();
        }, InactivityService.PATTERN_CHECK_INTERVAL_MS);
    }

    /**
     * - 'active': recent strong activity (edits) OR weak activity (cursor)
     * - 'thinking': within the productive pause window (< 90s from last edit)
     * - 'confusion': 90s to 5min from last edit
     * - 'giving-up': > 5min from last edit
     */
    private _classifyPattern(): InactivityPattern {
        const now = Date.now();
        const elapsedSinceEdit = now - this._lastEditTimestamp;
        const elapsedSinceWeakActivity = now - this._lastWeakActivityTimestamp;

        // 'active' considers BOTH strong and weak activity.
        if (elapsedSinceEdit < InactivityService.THRESHOLDS.ACTIVE ||
            elapsedSinceWeakActivity < InactivityService.THRESHOLDS.ACTIVE) {
            return 'active';
        }
        
        // Deeper states use only strong activity: cursor movement during
        // confusion does not indicate progress.
        if (elapsedSinceEdit < InactivityService.THRESHOLDS.THINKING) {
            return 'thinking';
        } else if (elapsedSinceEdit < InactivityService.THRESHOLDS.CONFUSION) {
            return 'confusion';
        } else {
            return 'giving-up';
        }
    }

    public getCurrentPattern(): InactivityPattern {
        // Recalculate: the 5s timer alone leaves the cached value stale.
        this._currentPattern = this._classifyPattern();
        return this._currentPattern;
    }

    /**
     * Time since the last edit or save in milliseconds. Strong activity only,
     * which is what pattern classification uses.
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

    public onSessionStart(_context: SessionStartContext): void {
        this.reset();
    }

    public reset(): void {
        const now = Date.now();
        this._lastEditTimestamp = now;
        this._lastWeakActivityTimestamp = now;
        this._currentPattern = 'active';
    }

}
