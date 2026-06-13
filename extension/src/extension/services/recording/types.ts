/**
 * Event type definitions for session recording.
 *
 * All events form a discriminated union on `type` with a shared `timestamp` field.
 * Serialized as one JSON object per line in JSONL files.
 */

// ── Recorded-event vocabulary ─────────────────────────────────────────
// These trigger/intervention vocabularies are referenced by the recorded
// `intervention` event (legacy, parse-only) and shared with the rest of the
// recording schema. They were the last survivors of the deleted v1 telemetry
// layer (PR 2c); the declarations now live here, fully self-contained, so the
// viewer's sync-types.mjs can inline recording/types.ts without resolving any
// '@extension/...' alias.

/**
 * Active intervention levels (excludes 'none').
 */
export const INTERVENTION_LEVELS = ['subtle', 'notification', 'proactive'] as const;
export type InterventionLevel = typeof INTERVENTION_LEVELS[number];

/**
 * Trigger types from Pu et al. 2025 [P11, Section 4, Figure 4]
 */
export const TRIGGER_TYPES = ['execution-error', 'multiline-paste', 'idle', 'selection-maintained'] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

/**
 * Reason why an intervention was blocked (i.e. rawWanted=true but shouldIntervene=false).
 *
 * - 'cooldown'        — internal cooldown (notification/proactive only)
 * - 'warmup'          — Exercise hasn't reached the 5-minute warmup yet
 * - 'recent-progress' — Student made progress within the 2-minute grace period
 * - 'session-limit'   — Max interventions per session exceeded
 * - 'last-dismissed'  — Previous intervention was dismissed (non-proactive blocked)
 * - 'low-confidence'  — EQ above threshold but confidence gate is 'insufficient'
 */
export const INTERVENTION_BLOCKED_REASONS = [
    'cooldown',
    'warmup',
    'session-limit',
    'low-confidence',
    'recent-progress',
    'last-dismissed',
] as const;
export type InterventionBlockedReason = typeof INTERVENTION_BLOCKED_REASONS[number];

/**
 * Reason why an intervention was dismissed.
 *
 * - 'user-action'  — User explicitly clicked "Not now" / "Later"
 * - 'hidden'       — Hint was hidden implicitly (e.g. build succeeded, session ended)
 * - 'replaced'     — A newer intervention replaced the current one
 * - 'session-end'  — Session ended while intervention was pending
 */
export const INTERVENTION_DISMISS_REASONS = ['user-action', 'hidden', 'replaced', 'session-end'] as const;
export type InterventionDismissReason = typeof INTERVENTION_DISMISS_REASONS[number];

/**
 * Reason a wanted intervention was suppressed without being delivered to the user.
 * Currently only one reason exists; left as a union so future suppression sources
 * (e.g. per-condition study mode) can extend it cleanly.
 */
export const INTERVENTION_SUPPRESSION_REASONS = ['user-disabled'] as const;
export type InterventionSuppressionReason = typeof INTERVENTION_SUPPRESSION_REASONS[number];

// ── Serialization helpers ─────────────────────────────────────────────

export interface SerializedRange {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
}

export interface SerializedDiagnostic {
    code: string | number | undefined;
    message: string;
    severity: number;
    range: SerializedRange;
    source: string | undefined;
}

// ── Individual event types ────────────────────────────────────────────

export interface TextChangeEvent {
    type: 'textChange';
    timestamp: number;
    uri: string;
    changes: {
        range: SerializedRange;
        rangeOffset: number;
        rangeLength: number;
        text: string;
    }[];
}

export interface SaveEvent {
    type: 'save';
    timestamp: number;
    uri: string;
}

export interface FileSwitchEvent {
    type: 'fileSwitch';
    timestamp: number;
    fromUri: string | undefined;
    toUri: string | undefined;
}

export interface DiagnosticsEvent {
    type: 'diagnostics';
    timestamp: number;
    uri: string;
    diagnostics: SerializedDiagnostic[];
}

export interface BuildResultEvent {
    type: 'buildResult';
    timestamp: number;
    successful: boolean | undefined;
    errorCount: number;
    /** Legacy: flat array of detailText strings for failed test feedbacks. Kept for backwards compat. */
    failedTests: string[];
    buildFailed: boolean;
    buildErrorFamilies?: string[];
    // Scoping fields (added in Block F)
    exerciseId?: number;
    participationId?: number;
    submissionId?: number;
    /** Structured failed-test details carrying both the test name and the failure message. */
    failedTestDetails?: { testName: string; detail: string }[];
}

export interface WindowFocusEvent {
    type: 'windowFocus';
    timestamp: number;
    focused: boolean;
}

export interface FileSnapshotEvent {
    type: 'fileSnapshot';
    timestamp: number;
    uri: string;
    snapshotPath: string;
}

export interface SessionStartEvent {
    type: 'sessionStart';
    timestamp: number;
    exerciseId: number;
    participantId: string | undefined;
    exerciseRoot?: string;
    /** Schema version for forward-compat parsing. Block AB introduces version 2. */
    schemaVersion?: number;
}

export interface SessionEndEvent {
    type: 'sessionEnd';
    timestamp: number;
    exerciseId: number;
}

/**
 * Emitted when user consent is downgraded (or upgraded) mid-session.
 * Minimal payload — carries no user data — acts as a marker only. The
 * downgraded path is followed by a `sessionEnd` and metadata finalisation.
 */
export interface ConsentChangeEvent {
    type: 'consentChange';
    timestamp: number;
    level: 'downgraded' | 'upgraded';
}

/**
 * Marker event indicating that all synchronous startup work (snapshots,
 * initial diagnostics, initial-state events, startup contributors) has been
 * flushed to the event stream. Consumers can use this as a cut-point for
 * deterministic "seed state vs. runtime events" separation.
 */
export interface StartupPhaseCompleteEvent {
    type: 'startupPhaseComplete';
    timestamp: number;
}

/**
 * Provenance event emitted once during the startup-contributor phase before
 * `startupPhaseComplete`. Captures the values of struggle-detection settings
 * at session start so analysis can classify control vs treatment sessions.
 */
export interface ConfigurationSnapshotEvent {
    type: 'configurationSnapshot';
    timestamp: number;
    struggleDetectionEnabled: boolean;
    showInterventions: boolean;
    /** Decision engine version live at session start (Engine v2 from PR 2c). */
    engineVersion?: 'v2';
}

/**
 * Provenance event emitted whenever one of the recorded struggle-detection
 * settings changes mid-session. Each property is only present when its value
 * changed in the triggering configuration event.
 */
export interface ConfigurationChangeEvent {
    type: 'configurationChange';
    timestamp: number;
    changes: {
        struggleDetectionEnabled?: boolean;
        showInterventions?: boolean;
    };
}

export interface IrisChatMessageEvent {
    type: 'irisChatMessage';
    timestamp: number;
    direction: 'sent' | 'received';
    content: string;
    // Added in Block H: optional metadata from server response / WebSocket payload
    messageId?: string;
    sessionId?: string;
    sentAt?: number;
}

/**
 * Records a send attempt lifecycle: pending (before API call), sent (on success),
 * or failed (on error). Emitted in addition to irisChatMessage so that:
 *  - Failed sends (which produce no irisChatMessage) are still visible in the recording.
 *  - The pending→sent timing is available for latency analysis.
 *
 * Lifecycle: pending → sent  OR  pending → failed
 */
export interface IrisChatSendAttemptEvent {
    type: 'irisChatSendAttempt';
    timestamp: number;
    content: string;
    status: 'pending' | 'sent' | 'failed';
    errorMessage?: string;
}

/**
 * Records a helpful/unhelpful rating submitted by the user for a received
 * Iris message. Wired up when the webview's feedback UI fires the event.
 */
export interface IrisChatFeedbackEvent {
    type: 'irisChatFeedback';
    timestamp: number;
    messageId: string;
    helpful: boolean;
}

export interface EqSnapshotEvent {
    type: 'eqSnapshot';
    timestamp: number;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    source: 'save' | 'build' | 'trigger';
    triggerType?: string;
}

export interface SerializedErrorSnapshot {
    timestamp: number;
    hasErrors: boolean;
    errorFamilies: string[];
    errorCount: number;
}

export interface EqEngineStateEvent {
    type: 'eqEngineState';
    timestamp: number;
    snapshots: SerializedErrorSnapshot[];
    currentEQ: number;
    pairCount: number;
    confidence: 'sufficient' | 'insufficient';
}

/**
 * Recorded intervention action. Recording-specific (the live decision side has
 * no 'action' concept). The trigger/blocked/dismiss/suppression vocabularies it
 * references are declared at the top of this file (formerly in the v1 telemetry layer).
 */
export const INTERVENTION_RECORD_ACTIONS = ['shown', 'accepted', 'dismissed', 'blocked', 'suppressed'] as const;
export type InterventionRecordAction = typeof INTERVENTION_RECORD_ACTIONS[number];

export interface InterventionEvent {
    type: 'intervention';
    timestamp: number;
    action: InterventionRecordAction;
    level: InterventionLevel;
    /** True for shown/accepted/dismissed/suppressed; false for blocked. */
    shouldIntervene: boolean;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    triggerType?: TriggerType;
    /** Populated when action='blocked'. Identifies why the intervention was blocked. */
    blockedReason?: InterventionBlockedReason;
    /** Populated when action='suppressed'. Identifies the suppression source. */
    suppressionReason?: InterventionSuppressionReason;
    /** Populated when action='dismissed'. Identifies how the intervention was dismissed. */
    dismissReason?: InterventionDismissReason;
    /**
     * Whether the EQ was above the severity threshold, regardless of confidence/guardrails.
     * Populated when action='blocked' to explain the signal that was suppressed.
     */
    rawWanted?: boolean;
}

export interface ViewNavigationEvent {
    type: 'viewNavigation';
    timestamp: number;
    from: string;
    to: string;
}

export interface PanelVisibilityEvent {
    type: 'panelVisibility';
    timestamp: number;
    panel: 'artemis' | 'chat';
    visible: boolean;
}

export interface ProblemStatementScrollEvent {
    type: 'problemStatementScroll';
    timestamp: number;
    /** Page scroll position — the ExerciseDetail webview scrolls as a whole page. */
    scrollTop: number;
    scrollHeight: number;
    viewportHeight: number;
    /** Geometry of the statement container, document-relative, integer CSS px. */
    statementTop: number;
    statementHeight: number;
}

export interface ProblemStatementSelectionEvent {
    type: 'problemStatementSelection';
    timestamp: number;
    /** Selected text, capped at 500 chars (see `truncated`). */
    selectedText: string;
    /** Uncapped selection length. */
    selectionLength: number;
    truncated: boolean;
    /** Bounding box of the selection, document-relative, integer CSS px. */
    selectionTop: number;
    selectionLeft: number;
    selectionWidth: number;
    selectionHeight: number;
}

export interface SelectionChangeEvent {
    type: 'selectionChange';
    timestamp: number;
    uri: string;
    selections: SerializedRange[];
    kind: 'keyboard' | 'mouse' | 'command' | undefined;
}

export interface VisibleRangeChangeEvent {
    type: 'visibleRangeChange';
    timestamp: number;
    uri: string;
    visibleRanges: SerializedRange[];
}

export interface TerminalCommandEvent {
    type: 'terminalCommand';
    timestamp: number;
    command: string;
    exitCode: number | undefined;
    output: string;
    outputTruncated: boolean;
    cwd: string | undefined;
    terminalName: string;
    durationMs: number;
}

export interface TerminalOpenCloseEvent {
    type: 'terminalOpenClose';
    timestamp: number;
    action: 'opened' | 'closed';
    terminalName: string;
}

/**
 * Emitted once per URI after three consecutive snapshot-write failures.
 * Acts as a permanent "give up" marker so consumers know a snapshot is
 * missing and why. Written via `_writeLifecycleEvent` (bypass phase gate)
 * only while recording is active.
 */
export interface FileSnapshotErrorEvent {
    type: 'fileSnapshotError';
    timestamp: number;
    uri: string;
    /** Short human-readable reason, e.g. 'snapshot-write-failed-after-3-retries' or an fs error message. */
    reason: string;
}

// ── Block K: Workspace file events (schemaVersion 2) ─────────────────

export interface FileCreateEvent {
    type: 'fileCreate';
    timestamp: number;
    uri: string;
}

export interface FileDeleteEvent {
    type: 'fileDelete';
    timestamp: number;
    uri: string;
}

export interface FileRenameEvent {
    type: 'fileRename';
    timestamp: number;
    oldUri: string;
    newUri: string;
}

export interface TextDocumentOpenEvent {
    type: 'textDocumentOpen';
    timestamp: number;
    uri: string;
}

export interface TextDocumentCloseEvent {
    type: 'textDocumentClose';
    timestamp: number;
    uri: string;
}

/**
 * Two-step-discriminator view events: `type` identifies the view, `action`
 * picks the opened/closed arm. Each arm is named so it can be imported and
 * reused in consumer signatures. Schema on the wire is unchanged.
 */
export interface TestResultsOverviewViewOpenedEvent {
    type: 'testResultsOverviewView';
    action: 'opened';
    timestamp: number;
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
}

export interface TestResultsOverviewViewClosedEvent {
    type: 'testResultsOverviewView';
    action: 'closed';
    timestamp: number;
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    durationMs: number;
    closeReason: 'button' | 'escape';
}

export type TestResultsOverviewViewEvent =
    | TestResultsOverviewViewOpenedEvent
    | TestResultsOverviewViewClosedEvent;

export interface TaskFeedbackViewOpenedEvent {
    type: 'taskFeedbackView';
    action: 'opened';
    timestamp: number;
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    taskName: string;
    testIds: number[];
    totalTests: number;
    passedTests: number;
    failedTests: number;
    notExecutedTests?: number;
}

export interface TaskFeedbackViewClosedEvent {
    type: 'taskFeedbackView';
    action: 'closed';
    timestamp: number;
    viewId: string;
    exerciseId: number;
    participationId?: number;
    resultId?: number;
    taskName: string;
    durationMs: number;
    closeReason: 'button' | 'escape';
}

export type TaskFeedbackViewEvent =
    | TaskFeedbackViewOpenedEvent
    | TaskFeedbackViewClosedEvent;

// ── Debugger events ───────────────────────────────────────────────────

export interface DebugSessionEvent {
    type: 'debugSession';
    timestamp: number;
    action: 'started' | 'terminated' | 'activeChanged';
    // Present for started / terminated, and for activeChanged when a session
    // became active. Omitted for activeChanged -> no active session.
    sessionId?: string;
    sessionName?: string;
    sessionType?: string;
    parentSessionId?: string;
}

export interface BreakpointChangeEvent {
    type: 'breakpointChange';
    timestamp: number;
    action: 'added' | 'removed' | 'changed';
    breakpoints: {
        id: string;            // vscode.Breakpoint.id, stable; correlates add/remove/change
        uri: string;           // absolute file:// URI (SourceBreakpoint only)
        line: number;          // 0-based, from location.range.start.line; consistent with SerializedRange
        column: number;        // 0-based, from location.range.start.character (always populated by the collector)
        enabled: boolean;
        condition?: string;
        hitCondition?: string;
        logMessage?: string;
    }[];
}

// ── Submission events ─────────────────────────────────────────────────

export type SubmissionFailureReason =
    | 'no-workspace' | 'no-changes' | 'git-identity-missing'
    | 'merge-conflict' | 'push-failed' | 'other';

/**
 * A student's Submit action. Recorded as a lifecycle (mirrors irisChatSendAttempt):
 * `started` at the click instant, then `succeeded` after a successful push or
 * `failed` with a categorised reason. Standalone but correlatable to the later
 * `buildResult` by `participationId` + timestamp ordering (the server-assigned
 * submissionId does not exist at submit time).
 */
export interface SubmissionEvent {
    type: 'submission';
    timestamp: number;
    status: 'started' | 'succeeded' | 'failed';
    /** Correlation key with buildResult. Required (submitExercise payload guarantees it). */
    participationId: number;
    /** Stamped by the recorder from the active session, consistent with buildResult. */
    exerciseId?: number;
    /** Raw intended text on `started`; resolved committed text on `succeeded`; omitted on `failed`. */
    commitMessage?: string;
    /** Present only on status === 'failed'. */
    failureReason?: SubmissionFailureReason;
}

/**
 * Data the submit command emits about a submission. The recorder stamps
 * `timestamp` and `exerciseId`; everything else comes from the command.
 * Pick keeps the field types a single source of truth with SubmissionEvent.
 */
export type SubmissionPayload = Pick<SubmissionEvent, 'status' | 'participationId' | 'commitMessage' | 'failureReason'>;

// ── Block L: Engine v2 score + alert events (schemaVersion 3) ────────
/** Boundary types as recorded (mirror of services/struggle BoundaryType). */
export type RecordedBoundaryType = 'FM' | 'FM_PLUS' | 'E4' | 'N1' | 'STATE';

/** Engine v2 per-tick score sample (every 10 s). */
export interface StruggleScoreEvent {
    type: 'struggleScore';
    timestamp: number;
    /** Session-relative tick time (s). */
    t: number;
    s: number;
    v: number;
    fTyping: number;
    fGap: number;
    fN4: number;
    fFb: number;
    fA8: number;
    fN2: number;
    typingRate: number;
    longestGapS: number;
    n4Ratio: number;
}

/** Engine v2 emitted alert. */
export interface AlertEvent {
    type: 'alert';
    timestamp: number;
    t: number;
    v: number;
    types: RecordedBoundaryType[];
    primary: RecordedBoundaryType;
    path: 'armed' | 'e6';
    inWarmup: boolean;
    inGrace: boolean;
    theta: number;
}

// ── Discriminated union ───────────────────────────────────────────────

export type RecordedEvent =
    | TextChangeEvent
    | SaveEvent
    | FileSwitchEvent
    | DiagnosticsEvent
    | BuildResultEvent
    | WindowFocusEvent
    | FileSnapshotEvent
    | SessionStartEvent
    | SessionEndEvent
    | ConsentChangeEvent
    | ConfigurationSnapshotEvent
    | ConfigurationChangeEvent
    | StartupPhaseCompleteEvent
    | IrisChatMessageEvent
    | IrisChatSendAttemptEvent
    | IrisChatFeedbackEvent
    | EqSnapshotEvent
    | EqEngineStateEvent
    | InterventionEvent
    | ViewNavigationEvent
    | PanelVisibilityEvent
    | ProblemStatementScrollEvent
    | ProblemStatementSelectionEvent
    | SelectionChangeEvent
    | VisibleRangeChangeEvent
    | TerminalCommandEvent
    | TerminalOpenCloseEvent
    | FileSnapshotErrorEvent
    | FileCreateEvent
    | FileDeleteEvent
    | FileRenameEvent
    | TextDocumentOpenEvent
    | TextDocumentCloseEvent
    | TestResultsOverviewViewEvent
    | TaskFeedbackViewEvent
    | DebugSessionEvent
    | BreakpointChangeEvent
    | SubmissionEvent
    | StruggleScoreEvent
    | AlertEvent;

// ── Session metadata ──────────────────────────────────────────────────

export interface SessionMetadata {
    sessionId: string;
    exerciseId: number;
    participantId: string | undefined;
    startTime: number;
    endTime: number | null | undefined;
    eventCount: number;
    /** Schema version for forward-compat parsing. Block D introduces version 2. */
    schemaVersion?: number;
    /** Recorder version string, set by storageWriter at write time. */
    recorderVersion?: string;
}
