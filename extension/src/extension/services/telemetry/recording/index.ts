export { SessionRecorder } from './sessionRecorder';
export type { StartupContributor, StartupContext } from './sessionRecorder';
export { shouldRecordUri, shouldRecordUriString } from './uriFilter';
export { RecordingStatusBarService } from './recordingStatusBar';
export { RecordingStorageWriter } from './storageWriter';
export type {
    RecordedEvent,
    SessionMetadata,
    SerializedRange,
    SerializedDiagnostic,
    ConsentChangeEvent,
    StartupPhaseCompleteEvent,
    FileSnapshotErrorEvent,
    FileCreateEvent,
    FileDeleteEvent,
    FileRenameEvent,
    TextDocumentOpenEvent,
    TextDocumentCloseEvent,
} from './types';
