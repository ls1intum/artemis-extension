/** Mirrors the recording types from iris-thaumantias */

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
