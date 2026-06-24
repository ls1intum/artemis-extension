import type { EventType } from './types';

// Single source of truth for event-type colors: used by both the canvas dots
// (utils/canvasDraw.ts) and the badge pills (components/EventBadge.tsx). Every
// type has a distinct value so no two event types are visually indistinguishable.
export const MARKER_COLORS: Record<EventType, string> = {
    eqSnapshot: '#818cf8',
    eqEngineState: '#6366f1',
    buildResult: '#4ade80',
    textChange: '#94a3b8',
    save: '#60a5fa',
    diagnostics: '#fbbf24',
    fileSwitch: '#c084fc',
    windowFocus: '#fcd34d',
    fileSnapshot: '#22c55e',
    sessionStart: '#a5b4fc',
    sessionEnd: '#f87171',
    consentChange: '#fb7185',
    startupPhaseComplete: '#a5f3fc',
    configurationSnapshot: '#cbd5e1',
    configurationChange: '#e2e8f0',
    irisChatMessage: '#f472b6',
    irisChatSendAttempt: '#fb923c',
    irisChatFeedback: '#c4b5fd',
    intervention: '#f97316',
    viewNavigation: '#a78bfa',
    panelVisibility: '#a3e635',
    testResultsOverviewView: '#2dd4bf',
    taskFeedbackView: '#5eead4',
    problemStatementScroll: '#d8b4fe',
    problemStatementSelection: '#f0abfc',
    selectionChange: '#06b6d4',
    visibleRangeChange: '#14b8a6',
    terminalCommand: '#22d3ee',
    terminalOpenClose: '#67e8f9',
    fileSnapshotError: '#ef4444',
    fileCreate: '#86efac',
    fileDelete: '#fca5a5',
    fileRename: '#fdba74',
    textDocumentOpen: '#7dd3fc',
    textDocumentClose: '#93c5fd',
    debugSession: '#f59e0b',
    breakpointChange: '#f43f5e',
    submission: '#34d399',
    struggleScore: '#e879f9',
    alert: '#dc2626',
};

export const ALL_EVENT_TYPES = [
    'sessionStart', 'sessionEnd', 'consentChange', 'startupPhaseComplete',
    'configurationSnapshot', 'configurationChange',
    'eqSnapshot', 'eqEngineState', 'intervention', 'buildResult', 'submission',
    'struggleScore', 'alert',
    'textChange', 'save',
    'diagnostics',
    'fileSwitch',
    'windowFocus', 'fileSnapshot',
    'irisChatMessage', 'irisChatSendAttempt', 'irisChatFeedback',
    'viewNavigation', 'panelVisibility',
    'testResultsOverviewView', 'taskFeedbackView',
    'problemStatementScroll', 'problemStatementSelection',
    'selectionChange', 'visibleRangeChange',
    'terminalCommand', 'terminalOpenClose',
    'debugSession', 'breakpointChange',
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
