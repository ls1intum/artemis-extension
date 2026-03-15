/**
 * Event type definitions for session recording.
 *
 * All events form a discriminated union on `type` with a shared `timestamp` field.
 * Serialized as one JSON object per line in JSONL files.
 */

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
    failedTests: string[];
    buildFailed: boolean;
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
}

export interface SessionEndEvent {
    type: 'sessionEnd';
    timestamp: number;
    exerciseId: number;
}

export interface IrisChatMessageEvent {
    type: 'irisChatMessage';
    timestamp: number;
    direction: 'sent' | 'received';
    content: string;
}

export interface EqSnapshotEvent {
    type: 'eqSnapshot';
    timestamp: number;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    source: 'save' | 'build' | 'trigger';
    triggerType?: string;
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
    | IrisChatMessageEvent
    | EqSnapshotEvent
    | SelectionChangeEvent
    | VisibleRangeChangeEvent;

// ── Session metadata ──────────────────────────────────────────────────

export interface SessionMetadata {
    sessionId: string;
    exerciseId: number;
    participantId: string | undefined;
    startTime: number;
    endTime: number | undefined;
    eventCount: number;
}
