import { useState } from 'react';

const categories = [
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
        ],
    },
    {
        title: 'Window & Navigation',
        items: [
            { badge: 'windowFocus', label: 'WindowFocus', desc: 'Window focus/blur state changes' },
            { badge: 'viewNavigation', label: 'ViewNavigation', desc: 'Extension sidebar screen changes (e.g. course-list \u2192 exercise-detail)' },
            { badge: 'panelVisibility', label: 'PanelVisibility', desc: 'Artemis sidebar or Iris Chat panel shown/hidden' },
            { badge: 'testResultsOverviewView', label: 'TestResultsOverviewView', desc: 'Test results overview popup (all tests for an exercise) opened/closed with pass/fail counts and duration' },
            { badge: 'taskFeedbackView', label: 'TaskFeedbackView', desc: 'Task feedback popup (tests for a single task from the problem statement) opened/closed with task name, pass/fail counts and duration' },
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
            { badge: 'eqSnapshot', label: 'EqSnapshot', desc: 'EQ score (0\u20131) + confidence (sufficient/insufficient)' },
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
        ],
    },
];

export function RecordingInfo() {
    const [open, setOpen] = useState(false);

    return (
        <div className="recording-info">
            <button className="recording-info-toggle" onClick={() => setOpen(!open)}>
                <span className={`toggle-chevron ${open ? 'open' : ''}`}>&#9654;</span>
                <span>What do we record?</span>
            </button>

            {open && (
                <div className="recording-info-body">
                    <p className="recording-info-intro">
                        Each session captures <strong>{categories.reduce((n, c) => n + c.items.length, 0)} event types</strong> across {categories.length} categories.
                        Events are stored as JSONL in{' '}
                        <code>globalStorage/recordings/&lt;sessionId&gt;/events.jsonl</code>.
                    </p>

                    <div className="info-categories">
                        {categories.map((cat) => (
                            <div key={cat.title} className="info-category">
                                <h4>{cat.title}</h4>
                                <div className="info-items">
                                    {cat.items.map((item) => (
                                        <div key={item.badge} className="info-item">
                                            <span className={`event-badge ${item.badge}`}>{item.label}</span>
                                            <span className="info-desc">{item.desc}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="storage-info">
                        <h4>Storage format</h4>
                        <pre className="storage-tree">{
`<sessionId>/
├── events.jsonl      one JSON object per line
├── metadata.json     session ID, exercise, participant, timing
└── snapshots/        initial file contents as .txt`
                        }</pre>
                    </div>
                </div>
            )}
        </div>
    );
}
