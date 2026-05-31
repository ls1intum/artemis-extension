import { useState } from 'react';

import { EventBadge } from './EventBadge.tsx';
import { RECORDING_INFO_CATEGORIES as categories } from './recordingInfoData.ts';

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
                                            <EventBadge type={item.badge} label={item.label} />
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
