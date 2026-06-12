import * as vscode from 'vscode';

import { type SensorHub, VsCodeSensorHub } from '@extension/services/sensing';

import { InactivityPattern, SessionResettable, SessionStartContext } from './types';

/**
 * Service that detects and classifies user inactivity patterns.
 * Helps identify when a student might be confused or giving up.
 */
export class InactivityService implements vscode.Disposable, SessionResettable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _hub: SensorHub;
    private readonly _ownsHub: boolean;
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

    /**
     * Fires once when the user resumes activity after being idle (>= ACTIVE threshold).
     * Used by BoundaryTriggerEmitter to re-arm the one-shot idle timer.
     */
    private readonly _onDidResumeActivity = new vscode.EventEmitter<void>();
    public readonly onDidResumeActivity = this._onDidResumeActivity.event;

    constructor(sensorHub?: SensorHub) {
        this._hub = sensorHub ?? new VsCodeSensorHub();
        this._ownsHub = sensorHub === undefined;
        this._startTracking(this._hub);
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

        if (this._ownsHub) {
            this._hub.dispose();
        }
    }

    /**
     * Start listening to document changes
     */
    private _startTracking(hub: SensorHub): void {
        const changeListener = hub.onDidChangeTextDocument(({ event }) => {
            // Ignore non-file schemes and empty changes
            if (event.document.uri.scheme !== 'file' || event.contentChanges.length === 0) {
                return;
            }
            this._recordActivity();
        });
        this._disposables.push(changeListener);

        // Also track when user saves
        const saveListener = hub.onDidSaveTextDocument(({ document }) => {
            if (document.uri.scheme === 'file') {
                this._recordActivity();
            }
        });
        this._disposables.push(saveListener);

        // Track cursor movement as WEAK activity only
        // Cursor movement prevents 'active' -> 'thinking' transition
        // but does NOT reset deeper inactivity states ('thinking' -> 'confusion' or 'confusion' -> 'giving-up')
        // Research shows cursor movement without editing often indicates confusion/reading
        const selectionListener = hub.onDidChangeTextEditorSelection(({ event }) => {
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

    /**
     * Record weak user activity (cursor movement without editing).
     * Only prevents transition from 'active' to 'thinking'.
     * Does NOT reset deeper inactivity states.
     *
     * Rationale: Cursor movement during confusion/struggle often indicates
     * the student is reading/scrolling without making progress, not productive work.
     */
    protected _recordWeakActivity(): void {
        const wasIdle = this.getTimeSinceLastActivity() >= InactivityService.THRESHOLDS.ACTIVE;
        this._lastWeakActivityTimestamp = Date.now();
        this._currentPattern = this._classifyPattern();

        if (wasIdle) {
            this._onDidResumeActivity.fire();
        }
    }

    /**
     * Start periodic pattern checking
     */
    private _startPatternCheck(): void {
        this._patternCheckTimer = setInterval(() => {
            this._currentPattern = this._classifyPattern();
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
     * SessionResettable — delegates to existing reset().
     */
    public onSessionStart(_context: SessionStartContext): void {
        this.reset();
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

}
