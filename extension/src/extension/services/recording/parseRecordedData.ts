/**
 * Runtime validators for data read off disk in the replay path.
 *
 * Two consumers:
 *   - `parseSessionMetadata` validates a recording's `metadata.json` file.
 *   - `parseRecordedEvent` validates a single line of `events.jsonl`.
 *
 * Both return `null` on any shape failure so the replay command can skip
 * the offending session / line instead of letting downstream code dereference
 * `undefined`. The contract used to be `JSON.parse(...) as SessionMetadata`
 * (a blind cast) — see #183 for the audit that surfaced it.
 *
 * The `RecordedEvent` validator is strict per-variant: every `type` literal in
 * the union has a dedicated validator, wired through the `EVENT_PARSERS` table.
 * That table is `satisfies Record<RecordedEvent['type'], EventParser>`, so
 * adding a new event variant to `recording/types.ts` without adding its parser
 * here fails to compile — schema drift cannot silently land. The same table's
 * keys are re-exported as `KNOWN_EVENT_TYPES` so `scripts/validate-recording.ts`
 * shares one list instead of maintaining its own (see #215).
 */

import type {
    AlertEvent,
    BreakpointChangeEvent,
    BuildResultEvent,
    ConfigurationChangeEvent,
    ConfigurationSnapshotEvent,
    ConsentChangeEvent,
    DebugSessionEvent,
    DiagnosticsEvent,
    FileCreateEvent,
    FileDeleteEvent,
    FileRenameEvent,
    FileSnapshotErrorEvent,
    FileSnapshotEvent,
    FileSwitchEvent,
    IrisChatFeedbackEvent,
    IrisChatMessageEvent,
    IrisChatSendAttemptEvent,
    PanelVisibilityEvent,
    ProblemStatementScrollEvent,
    ProblemStatementSelectionEvent,
    RecordedBoundaryType,
    RecordedEvent,
    SaveEvent,
    SelectionChangeEvent,
    SerializedDiagnostic,
    SerializedRange,
    SessionEndEvent,
    SessionMetadata,
    SessionStartEvent,
    StartupPhaseCompleteEvent,
    StruggleScoreEvent,
    SubmissionEvent,
    TaskFeedbackViewClosedEvent,
    TaskFeedbackViewEvent,
    TaskFeedbackViewOpenedEvent,
    TerminalCommandEvent,
    TerminalOpenCloseEvent,
    TestResultsOverviewViewClosedEvent,
    TestResultsOverviewViewEvent,
    TestResultsOverviewViewOpenedEvent,
    TextChangeEvent,
    TextDocumentCloseEvent,
    TextDocumentOpenEvent,
    ViewNavigationEvent,
    VisibleRangeChangeEvent,
    WindowFocusEvent,
} from './types';

// ── Primitive guards ──────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function isString(v: unknown): v is string {
    return typeof v === 'string';
}

function isBoolean(v: unknown): v is boolean {
    return typeof v === 'boolean';
}

function isOptString(v: unknown): boolean {
    return v === undefined || typeof v === 'string';
}

function isOptFiniteNumber(v: unknown): boolean {
    return v === undefined || (typeof v === 'number' && Number.isFinite(v));
}

function isOptBoolean(v: unknown): boolean {
    return v === undefined || typeof v === 'boolean';
}

function isStringOrUndefined(v: unknown): v is string | undefined {
    return v === undefined || typeof v === 'string';
}

function isOneOf<T extends readonly string[]>(v: unknown, options: T): v is T[number] {
    return typeof v === 'string' && (options as readonly string[]).includes(v);
}

/**
 * Strip keys whose value is `undefined` so the parser's output round-trips
 * cleanly through JSON.stringify. Without this, parsed events would carry
 * explicit `key: undefined` entries that diverge from the on-disk JSONL
 * form (which omits them) and trip `deepStrictEqual` in tests.
 */
function stripUndefined<T extends object>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) {
            out[k] = v;
        }
    }
    return out as T;
}

// ── Sub-shape parsers ─────────────────────────────────────────────────

function parseSerializedRange(data: unknown): SerializedRange | null {
    if (!isObject(data)) { return null; }
    if (!isFiniteNumber(data.startLine) || !isFiniteNumber(data.startCharacter)
        || !isFiniteNumber(data.endLine) || !isFiniteNumber(data.endCharacter)) {
        return null;
    }
    return {
        startLine: data.startLine,
        startCharacter: data.startCharacter,
        endLine: data.endLine,
        endCharacter: data.endCharacter,
    };
}

function parseSerializedDiagnostic(data: unknown): SerializedDiagnostic | null {
    if (!isObject(data)) { return null; }
    if (!isString(data.message)) { return null; }
    if (!isFiniteNumber(data.severity)) { return null; }
    const range = parseSerializedRange(data.range);
    if (!range) { return null; }
    // `code` is `string | number | undefined`: absent is fine, but a
    // present-but-wrong-typed value (object, boolean, etc.) is a schema
    // failure and must reject rather than silently coerce to undefined.
    if (data.code !== undefined && !isString(data.code) && !isFiniteNumber(data.code)) { return null; }
    if (data.source !== undefined && !isString(data.source)) { return null; }
    const code = data.code as string | number | undefined;
    const source = data.source as string | undefined;
    return stripUndefined({ code, message: data.message, severity: data.severity, range, source });
}

// ── Per-variant parsers ───────────────────────────────────────────────
//
// Each takes a pre-validated `Record<string, unknown>` (the dispatcher has
// already confirmed `type` is a string and `timestamp` is finite) and either
// returns the typed event or `null` if any required field is malformed.
// The dispatcher re-asserts `timestamp` per variant by inlining the cast,
// which keeps the per-variant signatures uniform.

function parseTextChange(d: Record<string, unknown>, timestamp: number): TextChangeEvent | null {
    if (!isString(d.uri) || !Array.isArray(d.changes)) { return null; }
    const changes: TextChangeEvent['changes'] = [];
    for (const raw of d.changes) {
        if (!isObject(raw)) { return null; }
        const range = parseSerializedRange(raw.range);
        if (!range) { return null; }
        if (!isFiniteNumber(raw.rangeOffset) || !isFiniteNumber(raw.rangeLength) || !isString(raw.text)) {
            return null;
        }
        changes.push({ range, rangeOffset: raw.rangeOffset, rangeLength: raw.rangeLength, text: raw.text });
    }
    return { type: 'textChange', timestamp, uri: d.uri, changes };
}

function parseSave(d: Record<string, unknown>, timestamp: number): SaveEvent | null {
    if (!isString(d.uri)) { return null; }
    return { type: 'save', timestamp, uri: d.uri };
}

function parseFileSwitch(d: Record<string, unknown>, timestamp: number): FileSwitchEvent | null {
    if (!isStringOrUndefined(d.fromUri) || !isStringOrUndefined(d.toUri)) { return null; }
    return stripUndefined({ type: 'fileSwitch' as const, timestamp, fromUri: d.fromUri, toUri: d.toUri });
}

function parseDiagnostics(d: Record<string, unknown>, timestamp: number): DiagnosticsEvent | null {
    if (!isString(d.uri) || !Array.isArray(d.diagnostics)) { return null; }
    const diagnostics: SerializedDiagnostic[] = [];
    for (const raw of d.diagnostics) {
        const parsed = parseSerializedDiagnostic(raw);
        if (!parsed) { return null; }
        diagnostics.push(parsed);
    }
    return { type: 'diagnostics', timestamp, uri: d.uri, diagnostics };
}

function parseBuildResult(d: Record<string, unknown>, timestamp: number): BuildResultEvent | null {
    if (!isOptBoolean(d.successful)) { return null; }
    if (!isFiniteNumber(d.errorCount)) { return null; }
    if (!Array.isArray(d.failedTests) || !d.failedTests.every(isString)) { return null; }
    if (!isBoolean(d.buildFailed)) { return null; }
    if (!isOptFiniteNumber(d.exerciseId)
        || !isOptFiniteNumber(d.participationId)
        || !isOptFiniteNumber(d.submissionId)
        || !isOptFiniteNumber(d.passedTestCaseCount)
        || !isOptFiniteNumber(d.testCaseCount)) {
        return null;
    }
    let failedTestDetails: BuildResultEvent['failedTestDetails'];
    if (d.failedTestDetails !== undefined) {
        if (!Array.isArray(d.failedTestDetails)) { return null; }
        const list: { testName: string; detail: string }[] = [];
        for (const raw of d.failedTestDetails) {
            if (!isObject(raw) || !isString(raw.testName) || !isString(raw.detail)) { return null; }
            list.push({ testName: raw.testName, detail: raw.detail });
        }
        failedTestDetails = list;
    }
    return stripUndefined({
        type: 'buildResult' as const,
        timestamp,
        successful: d.successful as boolean | undefined,
        errorCount: d.errorCount,
        failedTests: d.failedTests as string[],
        buildFailed: d.buildFailed,
        passedTestCaseCount: d.passedTestCaseCount as number | undefined,
        testCaseCount: d.testCaseCount as number | undefined,
        exerciseId: d.exerciseId as number | undefined,
        participationId: d.participationId as number | undefined,
        submissionId: d.submissionId as number | undefined,
        failedTestDetails,
    });
}

function parseWindowFocus(d: Record<string, unknown>, timestamp: number): WindowFocusEvent | null {
    if (!isBoolean(d.focused)) { return null; }
    return { type: 'windowFocus', timestamp, focused: d.focused };
}

function parseFileSnapshot(d: Record<string, unknown>, timestamp: number): FileSnapshotEvent | null {
    if (!isString(d.uri) || !isString(d.snapshotPath)) { return null; }
    return { type: 'fileSnapshot', timestamp, uri: d.uri, snapshotPath: d.snapshotPath };
}

function parseSessionStart(d: Record<string, unknown>, timestamp: number): SessionStartEvent | null {
    if (!isFiniteNumber(d.exerciseId)) { return null; }
    if (!isStringOrUndefined(d.participantId)) { return null; }
    if (!isOptString(d.exerciseRoot)) { return null; }
    if (!isOptFiniteNumber(d.schemaVersion)) { return null; }
    return stripUndefined({
        type: 'sessionStart' as const,
        timestamp,
        exerciseId: d.exerciseId,
        participantId: d.participantId,
        exerciseRoot: d.exerciseRoot as string | undefined,
        schemaVersion: d.schemaVersion as number | undefined,
    });
}

function parseSessionEnd(d: Record<string, unknown>, timestamp: number): SessionEndEvent | null {
    if (!isFiniteNumber(d.exerciseId)) { return null; }
    return { type: 'sessionEnd', timestamp, exerciseId: d.exerciseId };
}

function parseConsentChange(d: Record<string, unknown>, timestamp: number): ConsentChangeEvent | null {
    if (!isOneOf(d.level, ['downgraded', 'upgraded'] as const)) { return null; }
    return { type: 'consentChange', timestamp, level: d.level };
}

function parseStartupPhaseComplete(_d: Record<string, unknown>, timestamp: number): StartupPhaseCompleteEvent {
    return { type: 'startupPhaseComplete', timestamp };
}

function parseConfigurationSnapshot(d: Record<string, unknown>, timestamp: number): ConfigurationSnapshotEvent | null {
    if (!isBoolean(d.struggleDetectionEnabled) || !isBoolean(d.showInterventions)) { return null; }
    if (d.engineVersion !== undefined && !isOneOf(d.engineVersion, ['v2', 'v3'] as const)) { return null; }
    return stripUndefined({
        type: 'configurationSnapshot' as const,
        timestamp,
        struggleDetectionEnabled: d.struggleDetectionEnabled,
        showInterventions: d.showInterventions,
        engineVersion: d.engineVersion as 'v2' | 'v3' | undefined,
    });
}

function parseConfigurationChange(d: Record<string, unknown>, timestamp: number): ConfigurationChangeEvent | null {
    if (!isObject(d.changes)) { return null; }
    if (!isOptBoolean(d.changes.struggleDetectionEnabled) || !isOptBoolean(d.changes.showInterventions)) {
        return null;
    }
    return {
        type: 'configurationChange',
        timestamp,
        changes: stripUndefined({
            struggleDetectionEnabled: d.changes.struggleDetectionEnabled as boolean | undefined,
            showInterventions: d.changes.showInterventions as boolean | undefined,
        }),
    };
}

function parseIrisChatMessage(d: Record<string, unknown>, timestamp: number): IrisChatMessageEvent | null {
    if (!isOneOf(d.direction, ['sent', 'received'] as const)) { return null; }
    if (!isString(d.content)) { return null; }
    if (!isOptString(d.messageId) || !isOptString(d.sessionId) || !isOptFiniteNumber(d.sentAt)) { return null; }
    return stripUndefined({
        type: 'irisChatMessage' as const,
        timestamp,
        direction: d.direction,
        content: d.content,
        messageId: d.messageId as string | undefined,
        sessionId: d.sessionId as string | undefined,
        sentAt: d.sentAt as number | undefined,
    });
}

function parseIrisChatSendAttempt(d: Record<string, unknown>, timestamp: number): IrisChatSendAttemptEvent | null {
    if (!isString(d.content)) { return null; }
    if (!isOneOf(d.status, ['pending', 'sent', 'failed'] as const)) { return null; }
    if (!isOptString(d.errorMessage)) { return null; }
    return stripUndefined({
        type: 'irisChatSendAttempt' as const,
        timestamp,
        content: d.content,
        status: d.status,
        errorMessage: d.errorMessage as string | undefined,
    });
}

function parseIrisChatFeedback(d: Record<string, unknown>, timestamp: number): IrisChatFeedbackEvent | null {
    if (!isString(d.messageId) || !isBoolean(d.helpful)) { return null; }
    return { type: 'irisChatFeedback', timestamp, messageId: d.messageId, helpful: d.helpful };
}

function parseViewNavigation(d: Record<string, unknown>, timestamp: number): ViewNavigationEvent | null {
    if (!isString(d.from) || !isString(d.to)) { return null; }
    return { type: 'viewNavigation', timestamp, from: d.from, to: d.to };
}

function parsePanelVisibility(d: Record<string, unknown>, timestamp: number): PanelVisibilityEvent | null {
    if (!isOneOf(d.panel, ['artemis', 'chat'] as const)) { return null; }
    if (!isBoolean(d.visible)) { return null; }
    return { type: 'panelVisibility', timestamp, panel: d.panel, visible: d.visible };
}

function parseProblemStatementScroll(d: Record<string, unknown>, timestamp: number): ProblemStatementScrollEvent | null {
    if (!isFiniteNumber(d.scrollTop) || !isFiniteNumber(d.scrollHeight) || !isFiniteNumber(d.viewportHeight)
        || !isFiniteNumber(d.statementTop) || !isFiniteNumber(d.statementHeight)) {
        return null;
    }
    return {
        type: 'problemStatementScroll', timestamp,
        scrollTop: d.scrollTop, scrollHeight: d.scrollHeight, viewportHeight: d.viewportHeight,
        statementTop: d.statementTop, statementHeight: d.statementHeight,
    };
}

function parseProblemStatementSelection(d: Record<string, unknown>, timestamp: number): ProblemStatementSelectionEvent | null {
    if (!isString(d.selectedText) || !isFiniteNumber(d.selectionLength) || !isBoolean(d.truncated)) { return null; }
    if (!isFiniteNumber(d.selectionTop) || !isFiniteNumber(d.selectionLeft)
        || !isFiniteNumber(d.selectionWidth) || !isFiniteNumber(d.selectionHeight)) {
        return null;
    }
    return {
        type: 'problemStatementSelection', timestamp,
        selectedText: d.selectedText, selectionLength: d.selectionLength, truncated: d.truncated,
        selectionTop: d.selectionTop, selectionLeft: d.selectionLeft,
        selectionWidth: d.selectionWidth, selectionHeight: d.selectionHeight,
    };
}

function parseSelectionChange(d: Record<string, unknown>, timestamp: number): SelectionChangeEvent | null {
    if (!isString(d.uri) || !Array.isArray(d.selections)) { return null; }
    const selections: SerializedRange[] = [];
    for (const raw of d.selections) {
        const parsed = parseSerializedRange(raw);
        if (!parsed) { return null; }
        selections.push(parsed);
    }
    if (d.kind !== undefined && !isOneOf(d.kind, ['keyboard', 'mouse', 'command'] as const)) { return null; }
    const kind = d.kind as SelectionChangeEvent['kind'];
    return stripUndefined({ type: 'selectionChange' as const, timestamp, uri: d.uri, selections, kind });
}

function parseVisibleRangeChange(d: Record<string, unknown>, timestamp: number): VisibleRangeChangeEvent | null {
    if (!isString(d.uri) || !Array.isArray(d.visibleRanges)) { return null; }
    const visibleRanges: SerializedRange[] = [];
    for (const raw of d.visibleRanges) {
        const parsed = parseSerializedRange(raw);
        if (!parsed) { return null; }
        visibleRanges.push(parsed);
    }
    return { type: 'visibleRangeChange', timestamp, uri: d.uri, visibleRanges };
}

function parseTerminalCommand(d: Record<string, unknown>, timestamp: number): TerminalCommandEvent | null {
    if (!isString(d.command)) { return null; }
    if (!isOptFiniteNumber(d.exitCode)) { return null; }
    if (!isString(d.output)) { return null; }
    if (!isBoolean(d.outputTruncated)) { return null; }
    if (!isStringOrUndefined(d.cwd)) { return null; }
    if (!isString(d.terminalName)) { return null; }
    if (!isFiniteNumber(d.durationMs)) { return null; }
    return stripUndefined({
        type: 'terminalCommand' as const,
        timestamp,
        command: d.command,
        exitCode: d.exitCode as number | undefined,
        output: d.output,
        outputTruncated: d.outputTruncated,
        cwd: d.cwd,
        terminalName: d.terminalName,
        durationMs: d.durationMs,
    });
}

function parseTerminalOpenClose(d: Record<string, unknown>, timestamp: number): TerminalOpenCloseEvent | null {
    if (!isOneOf(d.action, ['opened', 'closed'] as const)) { return null; }
    if (!isString(d.terminalName)) { return null; }
    return { type: 'terminalOpenClose', timestamp, action: d.action, terminalName: d.terminalName };
}

function parseFileSnapshotError(d: Record<string, unknown>, timestamp: number): FileSnapshotErrorEvent | null {
    if (!isString(d.uri) || !isString(d.reason)) { return null; }
    return { type: 'fileSnapshotError', timestamp, uri: d.uri, reason: d.reason };
}

function parseFileCreate(d: Record<string, unknown>, timestamp: number): FileCreateEvent | null {
    if (!isString(d.uri)) { return null; }
    return { type: 'fileCreate', timestamp, uri: d.uri };
}

function parseFileDelete(d: Record<string, unknown>, timestamp: number): FileDeleteEvent | null {
    if (!isString(d.uri)) { return null; }
    return { type: 'fileDelete', timestamp, uri: d.uri };
}

function parseFileRename(d: Record<string, unknown>, timestamp: number): FileRenameEvent | null {
    if (!isString(d.oldUri) || !isString(d.newUri)) { return null; }
    return { type: 'fileRename', timestamp, oldUri: d.oldUri, newUri: d.newUri };
}

function parseTextDocumentOpen(d: Record<string, unknown>, timestamp: number): TextDocumentOpenEvent | null {
    if (!isString(d.uri)) { return null; }
    return { type: 'textDocumentOpen', timestamp, uri: d.uri };
}

function parseTextDocumentClose(d: Record<string, unknown>, timestamp: number): TextDocumentCloseEvent | null {
    if (!isString(d.uri)) { return null; }
    return { type: 'textDocumentClose', timestamp, uri: d.uri };
}

function parseTestResultsOverviewView(
    d: Record<string, unknown>,
    timestamp: number,
): TestResultsOverviewViewEvent | null {
    if (!isString(d.viewId) || !isFiniteNumber(d.exerciseId)) { return null; }
    if (!isOptFiniteNumber(d.participationId) || !isOptFiniteNumber(d.resultId)) { return null; }
    if (d.action === 'opened') {
        if (!isFiniteNumber(d.totalTests) || !isFiniteNumber(d.passedTests) || !isFiniteNumber(d.failedTests)) {
            return null;
        }
        return stripUndefined<TestResultsOverviewViewOpenedEvent>({
            type: 'testResultsOverviewView',
            action: 'opened',
            timestamp,
            viewId: d.viewId,
            exerciseId: d.exerciseId,
            participationId: d.participationId as number | undefined,
            resultId: d.resultId as number | undefined,
            totalTests: d.totalTests,
            passedTests: d.passedTests,
            failedTests: d.failedTests,
        });
    }
    if (d.action === 'closed') {
        if (!isFiniteNumber(d.durationMs)) { return null; }
        if (!isOneOf(d.closeReason, ['button', 'escape'] as const)) { return null; }
        return stripUndefined<TestResultsOverviewViewClosedEvent>({
            type: 'testResultsOverviewView',
            action: 'closed',
            timestamp,
            viewId: d.viewId,
            exerciseId: d.exerciseId,
            participationId: d.participationId as number | undefined,
            resultId: d.resultId as number | undefined,
            durationMs: d.durationMs,
            closeReason: d.closeReason,
        });
    }
    return null;
}

function parseTaskFeedbackView(d: Record<string, unknown>, timestamp: number): TaskFeedbackViewEvent | null {
    if (!isString(d.viewId) || !isFiniteNumber(d.exerciseId)) { return null; }
    if (!isOptFiniteNumber(d.participationId) || !isOptFiniteNumber(d.resultId)) { return null; }
    if (!isString(d.taskName)) { return null; }
    if (d.action === 'opened') {
        if (!Array.isArray(d.testIds) || !d.testIds.every(isFiniteNumber)) { return null; }
        if (!isFiniteNumber(d.totalTests) || !isFiniteNumber(d.passedTests) || !isFiniteNumber(d.failedTests)) {
            return null;
        }
        if (!isOptFiniteNumber(d.notExecutedTests)) { return null; }
        return stripUndefined<TaskFeedbackViewOpenedEvent>({
            type: 'taskFeedbackView',
            action: 'opened',
            timestamp,
            viewId: d.viewId,
            exerciseId: d.exerciseId,
            participationId: d.participationId as number | undefined,
            resultId: d.resultId as number | undefined,
            taskName: d.taskName,
            testIds: d.testIds as number[],
            totalTests: d.totalTests,
            passedTests: d.passedTests,
            failedTests: d.failedTests,
            notExecutedTests: d.notExecutedTests as number | undefined,
        });
    }
    if (d.action === 'closed') {
        if (!isFiniteNumber(d.durationMs)) { return null; }
        if (!isOneOf(d.closeReason, ['button', 'escape'] as const)) { return null; }
        return stripUndefined<TaskFeedbackViewClosedEvent>({
            type: 'taskFeedbackView',
            action: 'closed',
            timestamp,
            viewId: d.viewId,
            exerciseId: d.exerciseId,
            participationId: d.participationId as number | undefined,
            resultId: d.resultId as number | undefined,
            taskName: d.taskName,
            durationMs: d.durationMs,
            closeReason: d.closeReason,
        });
    }
    return null;
}

function parseDebugSession(d: Record<string, unknown>, timestamp: number): DebugSessionEvent | null {
    if (!isOneOf(d.action, ['started', 'terminated', 'activeChanged'] as const)) { return null; }
    if (!isStringOrUndefined(d.sessionId) || !isStringOrUndefined(d.sessionName)
        || !isStringOrUndefined(d.sessionType) || !isStringOrUndefined(d.parentSessionId)) {
        return null;
    }
    return stripUndefined({
        type: 'debugSession' as const,
        timestamp,
        action: d.action,
        sessionId: d.sessionId,
        sessionName: d.sessionName,
        sessionType: d.sessionType,
        parentSessionId: d.parentSessionId,
    });
}

function parseRecordedBreakpoint(data: unknown): BreakpointChangeEvent['breakpoints'][number] | null {
    if (!isObject(data)) { return null; }
    if (!isString(data.id) || !isString(data.uri)) { return null; }
    if (!isFiniteNumber(data.line) || !isFiniteNumber(data.column)) { return null; }
    if (!isBoolean(data.enabled)) { return null; }
    if (!isStringOrUndefined(data.condition) || !isStringOrUndefined(data.hitCondition)
        || !isStringOrUndefined(data.logMessage)) {
        return null;
    }
    return stripUndefined({
        id: data.id,
        uri: data.uri,
        line: data.line,
        column: data.column,
        enabled: data.enabled,
        condition: data.condition,
        hitCondition: data.hitCondition,
        logMessage: data.logMessage,
    });
}

function parseBreakpointChange(d: Record<string, unknown>, timestamp: number): BreakpointChangeEvent | null {
    if (!isOneOf(d.action, ['added', 'removed', 'changed'] as const)) { return null; }
    if (!Array.isArray(d.breakpoints)) { return null; }
    const breakpoints: BreakpointChangeEvent['breakpoints'] = [];
    for (const raw of d.breakpoints) {
        const parsed = parseRecordedBreakpoint(raw);
        if (!parsed) { return null; }
        breakpoints.push(parsed);
    }
    return { type: 'breakpointChange', timestamp, action: d.action, breakpoints };
}

function parseSubmission(d: Record<string, unknown>, timestamp: number): SubmissionEvent | null {
    if (!isOneOf(d.status, ['started', 'succeeded', 'failed'] as const)) { return null; }
    if (!isFiniteNumber(d.participationId)) { return null; }
    if (!isOptFiniteNumber(d.exerciseId)) { return null; }
    if (!isOptString(d.commitMessage)) { return null; }
    if (d.failureReason !== undefined
        && !isOneOf(d.failureReason,
            ['no-workspace', 'no-changes', 'git-identity-missing', 'merge-conflict', 'push-failed', 'other'] as const)) {
        return null;
    }
    return stripUndefined({
        type: 'submission' as const,
        timestamp,
        status: d.status,
        participationId: d.participationId,
        exerciseId: d.exerciseId as number | undefined,
        commitMessage: d.commitMessage as string | undefined,
        failureReason: d.failureReason as SubmissionEvent['failureReason'],
    });
}

function parseStruggleScore(d: Record<string, unknown>, timestamp: number): StruggleScoreEvent | null {
    // Legacy fields from older recordings are ignored (not copied to the output):
    // the v2 fN4/n4Ratio features and the removed V(t) peak-hold telemetry (`v`).
    const nums = ['t', 's', 'fTyping', 'fGap', 'fFb', 'fA8', 'fN2', 'typingRate', 'longestGapS'] as const;
    for (const k of nums) { if (!isFiniteNumber(d[k])) { return null; } }
    return {
        type: 'struggleScore', timestamp,
        t: d.t as number, s: d.s as number,
        fTyping: d.fTyping as number, fGap: d.fGap as number,
        fFb: d.fFb as number, fA8: d.fA8 as number, fN2: d.fN2 as number,
        typingRate: d.typingRate as number, longestGapS: d.longestGapS as number,
    };
}

const RECORDED_BOUNDARY_TYPES = ['FM', 'FM_PLUS', 'E4', 'N1', 'STATE'] as const;

function parseAlert(d: Record<string, unknown>, timestamp: number): AlertEvent | null {
    if (!isFiniteNumber(d.t) || !isFiniteNumber(d.theta)) { return null; }
    if (!isBoolean(d.inWarmup)) { return null; }
    if (d.kind !== undefined && d.kind !== 'edit' && d.kind !== 'discrete') { return null; }
    // urgency is the v3 decision signal; legacy v2 recordings omit it (ignored).
    // A legacy `v` (removed V(t) peak-hold telemetry) is ignored, not copied.
    const base = {
        type: 'alert' as const, timestamp,
        ...(isFiniteNumber(d.urgency) ? { urgency: d.urgency as number } : {}),
        t: d.t as number,
        inWarmup: d.inWarmup as boolean, theta: d.theta as number,
    };
    if (d.kind === 'discrete') {
        if (d.trigger !== 'test-stagnation') { return null; }
        return { ...base, kind: 'discrete', trigger: 'test-stagnation' };
    }
    // Edit alert (explicit kind 'edit', or a legacy row with no kind).
    if (!Array.isArray(d.types) || !d.types.every(x => isOneOf(x, RECORDED_BOUNDARY_TYPES))) { return null; }
    if (!isOneOf(d.primary, RECORDED_BOUNDARY_TYPES)) { return null; }
    if (!isOneOf(d.path, ['armed', 'e6'] as const)) { return null; }
    if (!isBoolean(d.inGrace)) { return null; }
    return {
        ...base, kind: 'edit',
        types: d.types as RecordedBoundaryType[],
        primary: d.primary as RecordedBoundaryType,
        path: d.path as 'armed' | 'e6',
        inGrace: d.inGrace as boolean,
    };
}

// ── Public dispatcher ─────────────────────────────────────────────────

type EventParser = (d: Record<string, unknown>, timestamp: number) => RecordedEvent | null;

/**
 * Dispatch table from every `RecordedEvent['type']` literal to its validator.
 *
 * The `satisfies Record<RecordedEvent['type'], EventParser>` clause makes the
 * table EXHAUSTIVE at compile time: adding a variant to the `RecordedEvent`
 * union without registering a parser here is a TYPE ERROR (missing key), and a
 * typo'd key that is not a real event type is also a TYPE ERROR (excess key).
 * This replaces the previous prose-only "remember to add a case" affordance —
 * which silently failed for `debugSession` / `breakpointChange` in PR #233,
 * letting them land on disk with no validator.
 */
const EVENT_PARSERS = {
    textChange: parseTextChange,
    save: parseSave,
    fileSwitch: parseFileSwitch,
    diagnostics: parseDiagnostics,
    buildResult: parseBuildResult,
    windowFocus: parseWindowFocus,
    fileSnapshot: parseFileSnapshot,
    sessionStart: parseSessionStart,
    sessionEnd: parseSessionEnd,
    consentChange: parseConsentChange,
    startupPhaseComplete: parseStartupPhaseComplete,
    configurationSnapshot: parseConfigurationSnapshot,
    configurationChange: parseConfigurationChange,
    irisChatMessage: parseIrisChatMessage,
    irisChatSendAttempt: parseIrisChatSendAttempt,
    irisChatFeedback: parseIrisChatFeedback,
    viewNavigation: parseViewNavigation,
    panelVisibility: parsePanelVisibility,
    problemStatementScroll: parseProblemStatementScroll,
    problemStatementSelection: parseProblemStatementSelection,
    selectionChange: parseSelectionChange,
    visibleRangeChange: parseVisibleRangeChange,
    terminalCommand: parseTerminalCommand,
    terminalOpenClose: parseTerminalOpenClose,
    fileSnapshotError: parseFileSnapshotError,
    fileCreate: parseFileCreate,
    fileDelete: parseFileDelete,
    fileRename: parseFileRename,
    textDocumentOpen: parseTextDocumentOpen,
    textDocumentClose: parseTextDocumentClose,
    testResultsOverviewView: parseTestResultsOverviewView,
    taskFeedbackView: parseTaskFeedbackView,
    debugSession: parseDebugSession,
    breakpointChange: parseBreakpointChange,
    submission: parseSubmission,
    struggleScore: parseStruggleScore,
    alert: parseAlert,
} satisfies Record<RecordedEvent['type'], EventParser>;

// Runtime mirror of the recordable event-type set, derived from the dispatch
// table's keys so it cannot drift from the parser. Typed as
// `ReadonlySet<string>` (not `ReadonlySet<RecordedEvent['type']>`) so consumers
// like `scripts/validate-recording.ts` can call `.has(ev.type)` on an untrusted
// string read off disk without a cast. See #215.
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(EVENT_PARSERS));

/**
 * Parse one line of an `events.jsonl` recording. Returns `null` on any shape
 * failure (unknown type, missing/mistyped field) so the replay path can skip
 * the offending line instead of dereferencing `undefined`.
 */
export function parseRecordedEvent(data: unknown): RecordedEvent | null {
    if (!isObject(data)) { return null; }
    if (!isFiniteNumber(data.timestamp)) { return null; }
    if (!isString(data.type)) { return null; }
    // Own-property check FIRST: EVENT_PARSERS is a plain object literal, so a
    // bare `EVENT_PARSERS[data.type]` would resolve inherited Object.prototype
    // members for adversarial `type` values like 'toString' / 'constructor' /
    // '__proto__' (returning garbage or throwing). The old `switch` returned
    // null for those; this preserves that exact behaviour.
    if (!Object.prototype.hasOwnProperty.call(EVENT_PARSERS, data.type)) { return null; }
    const parser = (EVENT_PARSERS as Record<string, EventParser>)[data.type];
    return parser(data, data.timestamp);
}

/**
 * Parse a recording's `metadata.json` file body. Returns `null` on any shape
 * failure. The replay command's session lister keeps the entry in the
 * QuickPick with a `metadata: null` placeholder (rendered as "unknown date"
 * / "unknown exercise"); the parser just refuses to construct a partially-
 * populated SessionMetadata object that downstream code would deref into.
 */
export function parseSessionMetadata(data: unknown): SessionMetadata | null {
    if (!isObject(data)) { return null; }
    if (!isString(data.sessionId)) { return null; }
    if (!isFiniteNumber(data.exerciseId)) { return null; }
    if (!isStringOrUndefined(data.participantId)) { return null; }
    if (!isFiniteNumber(data.startTime)) { return null; }
    // endTime is `number | null | undefined`.
    if (data.endTime !== null && data.endTime !== undefined
        && !(typeof data.endTime === 'number' && Number.isFinite(data.endTime))) {
        return null;
    }
    if (!isFiniteNumber(data.eventCount)) { return null; }
    if (!isOptFiniteNumber(data.schemaVersion)) { return null; }
    if (!isOptString(data.recorderVersion)) { return null; }
    return stripUndefined({
        sessionId: data.sessionId,
        exerciseId: data.exerciseId,
        participantId: data.participantId,
        startTime: data.startTime,
        // endTime is intentionally NOT stripped when null (different meaning
        // from "missing"): null = recording in progress, undefined = session
        // closed without writing endTime. We preserve null explicitly.
        endTime: data.endTime as number | null | undefined,
        eventCount: data.eventCount,
        schemaVersion: data.schemaVersion as number | undefined,
        recorderVersion: data.recorderVersion as string | undefined,
    });
}
