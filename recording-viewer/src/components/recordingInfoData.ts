import type { EventType } from '../types';

interface RecordingInfoItem {
    badge: EventType;
    label: string;
    desc: string;
}

interface RecordingInfoCategory {
    title: string;
    items: RecordingInfoItem[];
}

/** Content of the "What do we record?" panel. The badge of every item is a real
 *  EventType (compile-checked); recordingInfo.test.ts asserts the full set stays
 *  in sync with ALL_EVENT_TYPES so this panel cannot silently go stale. */
export const RECORDING_INFO_CATEGORIES: RecordingInfoCategory[] = [
    {
        title: 'Editor Activity',
        items: [
            { badge: 'textChange', label: 'TextChange', desc: 'Code edits with ranges, offsets, and text content' },
            { badge: 'save', label: 'Save', desc: 'File save operations' },
            { badge: 'fileSwitch', label: 'FileSwitch', desc: 'Active editor switched (from/to URI)' },
            { badge: 'selectionChange', label: 'SelectionChange', desc: 'Cursor or selection range changes' },
            { badge: 'visibleRangeChange', label: 'VisibleRangeChange', desc: 'Visible editor range scrolled' },
        ],
    },
    {
        title: 'Build & Diagnostics',
        items: [
            { badge: 'buildResult', label: 'BuildResult', desc: 'Test pass/fail, error count, failed test names' },
            { badge: 'diagnostics', label: 'Diagnostics', desc: 'Compiler diagnostics (code, message, severity, range)' },
            { badge: 'submission', label: 'Submission', desc: 'Submit action lifecycle: started (click) → succeeded (after push) or failed with a categorised reason (no-changes, merge-conflict, push-failed, …)' },
        ],
    },
    {
        title: 'Debugging',
        items: [
            { badge: 'debugSession', label: 'DebugSession', desc: 'Debug session started / terminated / active-changed (session name, type)' },
            { badge: 'breakpointChange', label: 'BreakpointChange', desc: 'Breakpoints added / removed / changed (file, line, condition, log message); initial snapshot at session start' },
        ],
    },
    {
        title: 'Window & Navigation',
        items: [
            { badge: 'windowFocus', label: 'WindowFocus', desc: 'Window focus/blur state changes' },
            { badge: 'viewNavigation', label: 'ViewNavigation', desc: 'Extension sidebar screen changes (e.g. course-list → exercise-detail)' },
            { badge: 'panelVisibility', label: 'PanelVisibility', desc: 'Artemis sidebar or Iris Chat panel shown/hidden' },
            { badge: 'testResultsOverviewView', label: 'TestResultsOverviewView', desc: 'Test results overview popup (all tests for an exercise) opened/closed with pass/fail counts and duration' },
            { badge: 'taskFeedbackView', label: 'TaskFeedbackView', desc: 'Task feedback popup (tests for a single task from the problem statement) opened/closed with task name, pass/fail counts and duration' },
            { badge: 'problemStatementScroll', label: 'ProblemStatementScroll', desc: 'Exercise-detail page scrolled — page scroll position plus problem-statement geometry (debounced, baseline re-emits on layout changes)' },
            { badge: 'problemStatementSelection', label: 'ProblemStatementSelection', desc: 'Text selected inside the problem statement — selected text (capped at 500 chars) plus bounding box' },
            { badge: 'fileSnapshot', label: 'FileSnapshot', desc: 'Initial file content at session start (max 1 MB per file)' },
            { badge: 'fileSnapshotError', label: 'FileSnapshotError', desc: 'Snapshot permanently failed after 3 retries — snapshot is missing for this URI' },
        ],
    },
    {
        title: 'File System',
        items: [
            { badge: 'fileCreate', label: 'FileCreate', desc: 'File created inside the exercise root (workspace onDidCreateFiles)' },
            { badge: 'fileDelete', label: 'FileDelete', desc: 'File deleted inside the exercise root (workspace onDidDeleteFiles)' },
            { badge: 'fileRename', label: 'FileRename', desc: 'File renamed/moved inside or into/out of the exercise root (oldUri + newUri)' },
            { badge: 'textDocumentOpen', label: 'TextDocumentOpen', desc: 'Text document opened in the editor (workspace onDidOpenTextDocument)' },
            { badge: 'textDocumentClose', label: 'TextDocumentClose', desc: 'Text document closed in the editor (workspace onDidCloseTextDocument)' },
        ],
    },
    {
        title: 'Terminal',
        items: [
            { badge: 'terminalOpenClose', label: 'TerminalOpenClose', desc: 'Integrated terminal opened or closed (terminal name)' },
            { badge: 'terminalCommand', label: 'TerminalCommand', desc: 'Command run in the integrated terminal (command, exit code, output, duration)' },
        ],
    },
    {
        title: 'AI Interaction',
        items: [
            { badge: 'irisChatMessage', label: 'IrisChatMessage', desc: 'Sent and received chat messages with full content (optionally includes messageId, sessionId, sentAt)' },
            { badge: 'irisChatSendAttempt', label: 'IrisChatSendAttempt', desc: 'Send lifecycle: pending (before API call), sent (on success), failed (on error) — captures failed sends invisible in irisChatMessage' },
            { badge: 'irisChatFeedback', label: 'IrisChatFeedback', desc: 'Helpful/not-helpful rating submitted by the user for a received message' },
        ],
    },
    {
        title: 'Struggle Detection',
        items: [
            { badge: 'eqSnapshot', label: 'EqSnapshot', desc: 'EQ score (0–1) + confidence (sufficient/insufficient)' },
            { badge: 'eqEngineState', label: 'EqEngineState', desc: 'Full EQ engine state (snapshots, pairs, confidence)' },
            { badge: 'intervention', label: 'Intervention', desc: 'Shown/accepted/dismissed interventions with level and EQ context' },
            { badge: 'configurationSnapshot', label: 'ConfigurationSnapshot', desc: 'Provenance: struggle-detection + intervention settings captured at session start (used to classify control vs treatment runs)' },
            { badge: 'configurationChange', label: 'ConfigurationChange', desc: 'Provenance: struggle-detection or intervention setting flipped mid-session (only changed keys are recorded)' },
        ],
    },
    {
        title: 'Session',
        items: [
            { badge: 'sessionStart', label: 'SessionStart', desc: 'Exercise ID + participant ID' },
            { badge: 'sessionEnd', label: 'SessionEnd', desc: 'Session terminated' },
            { badge: 'consentChange', label: 'ConsentChange', desc: 'Data-collection consent downgraded or upgraded mid-session (marker only, no user data)' },
            { badge: 'startupPhaseComplete', label: 'StartupPhaseComplete', desc: 'Marker that all synchronous startup work (snapshots, initial state) has been flushed' },
        ],
    },
];

/** Flat list of every badge shown in the panel, used to guard against drift
 *  from the recorder's ALL_EVENT_TYPES (see recordingInfo.test.ts). */
export const RECORDING_INFO_BADGES: EventType[] = RECORDING_INFO_CATEGORIES.flatMap(c => c.items.map(i => i.badge));
