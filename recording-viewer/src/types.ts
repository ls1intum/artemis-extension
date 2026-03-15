/** Mirrors the recording types from iris-thaumantias */

export interface SerializedRange {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
}

export interface SerializedSelection {
    anchor: { line: number; character: number };
    active: { line: number; character: number };
}

export interface SerializedDiagnostic {
    code: string | number | undefined;
    message: string;
    severity: number;
    range: SerializedRange;
    source: string | undefined;
}

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

export interface SelectionEvent {
    type: 'selection';
    timestamp: number;
    uri: string;
    selections: SerializedSelection[];
    kind: number | undefined;
}

export interface VisibleRangesEvent {
    type: 'visibleRanges';
    timestamp: number;
    uri: string;
    ranges: SerializedRange[];
}

export interface FileSwitchEvent {
    type: 'fileSwitch';
    timestamp: number;
    fromUri: string | undefined;
    toUri: string | undefined;
}

export interface FileOpenEvent {
    type: 'fileOpen';
    timestamp: number;
    uri: string;
    languageId: string;
}

export interface FileCloseEvent {
    type: 'fileClose';
    timestamp: number;
    uri: string;
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
}

export type RecordedEvent =
    | TextChangeEvent
    | SaveEvent
    | SelectionEvent
    | VisibleRangesEvent
    | FileSwitchEvent
    | FileOpenEvent
    | FileCloseEvent
    | DiagnosticsEvent
    | BuildResultEvent
    | WindowFocusEvent
    | FileSnapshotEvent
    | SessionStartEvent
    | SessionEndEvent
    | IrisChatMessageEvent
    | EqSnapshotEvent;

export type EventType = RecordedEvent['type'];

export interface SessionMetadata {
    sessionId: string;
    exerciseId: number;
    participantId: string | undefined;
    startTime: number;
    endTime: number | undefined;
    eventCount: number;
}

export interface LoadedSession {
    metadata: SessionMetadata | null;
    events: RecordedEvent[];
    fileName: string;
}
