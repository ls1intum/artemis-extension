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
 * The `RecordedEvent` validator is strict per-variant: each of the 33 type
 * literals has a dedicated validator that checks the fields declared in
 * `recording/types.ts`. Adding a new event variant requires adding both a
 * type interface there and a matching parser case here — a deliberate review
 * affordance so schema drift can't silently land.
 */

import type {
    BuildResultEvent,
    ConfigurationChangeEvent,
    ConfigurationSnapshotEvent,
    ConsentChangeEvent,
    DiagnosticsEvent,
    EqEngineStateEvent,
    EqSnapshotEvent,
    FileCreateEvent,
    FileDeleteEvent,
    FileRenameEvent,
    FileSnapshotErrorEvent,
    FileSnapshotEvent,
    FileSwitchEvent,
    InterventionEvent,
    IrisChatFeedbackEvent,
    IrisChatMessageEvent,
    IrisChatSendAttemptEvent,
    PanelVisibilityEvent,
    RecordedEvent,
    SaveEvent,
    SelectionChangeEvent,
    SerializedDiagnostic,
    SerializedErrorSnapshot,
    SerializedRange,
    SessionEndEvent,
    SessionMetadata,
    SessionStartEvent,
    StartupPhaseCompleteEvent,
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

function parseSerializedErrorSnapshot(data: unknown): SerializedErrorSnapshot | null {
    if (!isObject(data)) { return null; }
    if (!isFiniteNumber(data.timestamp)) { return null; }
    if (!isBoolean(data.hasErrors)) { return null; }
    if (!Array.isArray(data.errorFamilies) || !data.errorFamilies.every(isString)) { return null; }
    if (!isFiniteNumber(data.errorCount)) { return null; }
    return {
        timestamp: data.timestamp,
        hasErrors: data.hasErrors,
        errorFamilies: data.errorFamilies as string[],
        errorCount: data.errorCount,
    };
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
    if (d.buildErrorFamilies !== undefined
        && !(Array.isArray(d.buildErrorFamilies) && d.buildErrorFamilies.every(isString))) {
        return null;
    }
    if (!isOptFiniteNumber(d.exerciseId)
        || !isOptFiniteNumber(d.participationId)
        || !isOptFiniteNumber(d.submissionId)) {
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
        buildErrorFamilies: d.buildErrorFamilies as string[] | undefined,
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
    return {
        type: 'configurationSnapshot',
        timestamp,
        struggleDetectionEnabled: d.struggleDetectionEnabled,
        showInterventions: d.showInterventions,
    };
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

function parseEqSnapshot(d: Record<string, unknown>, timestamp: number): EqSnapshotEvent | null {
    if (!isFiniteNumber(d.eq)) { return null; }
    if (!isOneOf(d.confidence, ['sufficient', 'insufficient'] as const)) { return null; }
    if (!isOneOf(d.source, ['save', 'build', 'trigger'] as const)) { return null; }
    if (!isOptString(d.triggerType)) { return null; }
    return stripUndefined({
        type: 'eqSnapshot' as const,
        timestamp,
        eq: d.eq,
        confidence: d.confidence,
        source: d.source,
        triggerType: d.triggerType as string | undefined,
    });
}

function parseEqEngineState(d: Record<string, unknown>, timestamp: number): EqEngineStateEvent | null {
    if (!Array.isArray(d.snapshots)) { return null; }
    const snapshots: SerializedErrorSnapshot[] = [];
    for (const raw of d.snapshots) {
        const parsed = parseSerializedErrorSnapshot(raw);
        if (!parsed) { return null; }
        snapshots.push(parsed);
    }
    if (!isFiniteNumber(d.currentEQ) || !isFiniteNumber(d.pairCount)) { return null; }
    if (!isOneOf(d.confidence, ['sufficient', 'insufficient'] as const)) { return null; }
    return {
        type: 'eqEngineState',
        timestamp,
        snapshots,
        currentEQ: d.currentEQ,
        pairCount: d.pairCount,
        confidence: d.confidence,
    };
}

function parseIntervention(d: Record<string, unknown>, timestamp: number): InterventionEvent | null {
    if (!isOneOf(d.action, ['shown', 'accepted', 'dismissed', 'blocked', 'suppressed'] as const)) { return null; }
    if (!isOneOf(d.level, ['subtle', 'notification', 'proactive'] as const)) { return null; }
    if (!isBoolean(d.shouldIntervene)) { return null; }
    if (!isFiniteNumber(d.eq)) { return null; }
    if (!isOneOf(d.confidence, ['sufficient', 'insufficient'] as const)) { return null; }
    if (d.triggerType !== undefined
        && !isOneOf(d.triggerType, ['execution-error', 'multiline-paste', 'idle', 'selection-maintained'] as const)) {
        return null;
    }
    if (d.blockedReason !== undefined
        && !isOneOf(d.blockedReason, ['cooldown', 'warmup', 'session-limit', 'low-confidence'] as const)) {
        return null;
    }
    if (d.suppressionReason !== undefined && !isOneOf(d.suppressionReason, ['user-disabled'] as const)) {
        return null;
    }
    if (d.dismissReason !== undefined
        && !isOneOf(d.dismissReason, ['user-action', 'hidden', 'replaced', 'session-end'] as const)) {
        return null;
    }
    if (!isOptBoolean(d.rawWanted)) { return null; }
    return stripUndefined({
        type: 'intervention' as const,
        timestamp,
        action: d.action,
        level: d.level,
        shouldIntervene: d.shouldIntervene,
        eq: d.eq,
        confidence: d.confidence,
        triggerType: d.triggerType as InterventionEvent['triggerType'],
        blockedReason: d.blockedReason as InterventionEvent['blockedReason'],
        suppressionReason: d.suppressionReason as InterventionEvent['suppressionReason'],
        dismissReason: d.dismissReason as InterventionEvent['dismissReason'],
        rawWanted: d.rawWanted as boolean | undefined,
    });
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

// ── Public dispatcher ─────────────────────────────────────────────────

/**
 * Parse one line of an `events.jsonl` recording. Returns `null` on any shape
 * failure so the replay command can skip the line. Adding a new event variant
 * to `RecordedEvent` requires a matching `case` here — the `default` branch
 * deliberately rejects unknown types instead of silently widening.
 */
export function parseRecordedEvent(data: unknown): RecordedEvent | null {
    if (!isObject(data)) { return null; }
    if (!isFiniteNumber(data.timestamp)) { return null; }
    if (!isString(data.type)) { return null; }
    const ts = data.timestamp;
    switch (data.type) {
        case 'textChange': return parseTextChange(data, ts);
        case 'save': return parseSave(data, ts);
        case 'fileSwitch': return parseFileSwitch(data, ts);
        case 'diagnostics': return parseDiagnostics(data, ts);
        case 'buildResult': return parseBuildResult(data, ts);
        case 'windowFocus': return parseWindowFocus(data, ts);
        case 'fileSnapshot': return parseFileSnapshot(data, ts);
        case 'sessionStart': return parseSessionStart(data, ts);
        case 'sessionEnd': return parseSessionEnd(data, ts);
        case 'consentChange': return parseConsentChange(data, ts);
        case 'startupPhaseComplete': return parseStartupPhaseComplete(data, ts);
        case 'configurationSnapshot': return parseConfigurationSnapshot(data, ts);
        case 'configurationChange': return parseConfigurationChange(data, ts);
        case 'irisChatMessage': return parseIrisChatMessage(data, ts);
        case 'irisChatSendAttempt': return parseIrisChatSendAttempt(data, ts);
        case 'irisChatFeedback': return parseIrisChatFeedback(data, ts);
        case 'eqSnapshot': return parseEqSnapshot(data, ts);
        case 'eqEngineState': return parseEqEngineState(data, ts);
        case 'intervention': return parseIntervention(data, ts);
        case 'viewNavigation': return parseViewNavigation(data, ts);
        case 'panelVisibility': return parsePanelVisibility(data, ts);
        case 'selectionChange': return parseSelectionChange(data, ts);
        case 'visibleRangeChange': return parseVisibleRangeChange(data, ts);
        case 'terminalCommand': return parseTerminalCommand(data, ts);
        case 'terminalOpenClose': return parseTerminalOpenClose(data, ts);
        case 'fileSnapshotError': return parseFileSnapshotError(data, ts);
        case 'fileCreate': return parseFileCreate(data, ts);
        case 'fileDelete': return parseFileDelete(data, ts);
        case 'fileRename': return parseFileRename(data, ts);
        case 'textDocumentOpen': return parseTextDocumentOpen(data, ts);
        case 'textDocumentClose': return parseTextDocumentClose(data, ts);
        case 'testResultsOverviewView': return parseTestResultsOverviewView(data, ts);
        case 'taskFeedbackView': return parseTaskFeedbackView(data, ts);
        default: return null;
    }
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
