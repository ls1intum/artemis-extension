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
            { badge: 'fileSnapshot', label: 'FileSnapshot', desc: 'Initial file content at session start (max 1 MB per file)' },
            { badge: 'fileSnapshotError', label: 'FileSnapshotError', desc: 'Snapshot permanently failed after 3 retries — snapshot is missing for this URI' },
        ],
    },
    {
        title: 'AI Interaction',
        items: [
            { badge: 'irisChatMessage', label: 'IrisChatMessage', desc: 'Sent and received chat messages with full content' },
        ],
    },
    {
        title: 'Struggle Detection',
        items: [
            { badge: 'eqSnapshot', label: 'EqSnapshot', desc: 'EQ score (0\u20131) + confidence (sufficient/insufficient)' },
            { badge: 'eqEngineState', label: 'EqEngineState', desc: 'Full EQ engine state (snapshots, pairs, confidence)' },
            { badge: 'intervention', label: 'Intervention', desc: 'Shown/accepted/dismissed interventions with level and EQ context' },
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
