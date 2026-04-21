import type { EventType } from './types';

export const MARKER_COLORS: Record<EventType, string> = {
    eqSnapshot: '#818cf8',
    eqEngineState: '#818cf8',
    buildResult: '#4ade80',
    textChange: '#94a3b8',
    save: '#60a5fa',
    diagnostics: '#fbbf24',
    fileSwitch: '#c084fc',
    windowFocus: '#fbbf24',
    fileSnapshot: '#4ade80',
    sessionStart: '#a5b4fc',
    sessionEnd: '#f87171',
    irisChatMessage: '#f472b6',
    irisChatSendAttempt: '#fb923c',
    irisChatFeedback: '#a78bfa',
    intervention: '#f97316',
    viewNavigation: '#a78bfa',
    panelVisibility: '#fbbf24',
    selectionChange: '#06b6d4',
    visibleRangeChange: '#14b8a6',
    terminalCommand: '#22d3ee',
    terminalOpenClose: '#67e8f9',
    fileSnapshotError: '#f87171',
    fileCreate: '#86efac',
    fileDelete: '#fca5a5',
    fileRename: '#fdba74',
    textDocumentOpen: '#7dd3fc',
    textDocumentClose: '#93c5fd',
};

export const ALL_EVENT_TYPES = [
    'sessionStart', 'sessionEnd',
    'eqSnapshot', 'eqEngineState', 'intervention', 'buildResult',
    'textChange', 'save',
    'diagnostics',
    'fileSwitch',
    'windowFocus', 'fileSnapshot',
    'irisChatMessage', 'irisChatSendAttempt', 'irisChatFeedback',
    'viewNavigation', 'panelVisibility',
    'selectionChange', 'visibleRangeChange',
    'terminalCommand', 'terminalOpenClose',
    'fileSnapshotError',
    'fileCreate', 'fileDelete', 'fileRename',
    'textDocumentOpen', 'textDocumentClose',
] as const satisfies readonly EventType[];

// Compile error if a new event type is added but not listed above
type _MissingEventTypes = Exclude<EventType, (typeof ALL_EVENT_TYPES)[number]>;
void (true satisfies (_MissingEventTypes extends never ? true : never));

/** Event types displayed as swim lanes (excludes engine state / intervention handled separately) */
export const SWIM_LANE_TYPES = ALL_EVENT_TYPES.filter(
    (t): t is Exclude<EventType, 'eqEngineState' | 'intervention'> =>
        t !== 'eqEngineState' && t !== 'intervention'
);
