import type { EventType } from './types';

// Single source of truth for event-type colors: used by both the canvas dots
// (utils/canvasDraw.ts) and the badge pills (components/EventBadge.tsx). Every
// type has a distinct value so no two event types are visually indistinguishable.
export const MARKER_COLORS: Record<EventType, string> = {
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
    'buildResult', 'submission',
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

/**
 * Event types the EQ engine used to emit (`eqSnapshot`, `eqEngineState`,
 * `intervention`). Retired from the canonical schema by the EQ-removal
 * commit 87fd6578 and synced into this viewer's generated types by 36fbe503,
 * so these string literals can no longer be members of `EventType` (==
 * `RecordedEvent['type']`), so they are declared as a fixed constant instead.
 * Old recordings on disk still contain rows of these types (the loader casts
 * raw JSON rather than schema-validating it, see parseSession.ts), and the
 * event-stream list, canvas timeline, and EQ chart (SessionTimeline.tsx) all
 * still render them via the same viewer-local Legacy*Event pattern used in
 * eventDisplay.tsx. Colors match what MARKER_COLORS held for these keys
 * before the sync.
 */
export const LEGACY_EVENT_TYPES = ['eqSnapshot', 'eqEngineState', 'intervention'] as const;
type LegacyEventType = (typeof LEGACY_EVENT_TYPES)[number];

export const LEGACY_MARKER_COLORS: Record<LegacyEventType, string> = {
    eqSnapshot: '#818cf8',
    eqEngineState: '#6366f1',
    intervention: '#f97316',
};

/** Colors for every renderable type, including the legacy ones above.
 *  Consulted by EventBadge and the canvas dots (canvasDraw.ts) so old
 *  recordings' EQ/intervention rows keep their own distinct color instead of
 *  silently falling back to the "unknown type" CSS-only look. */
export const ALL_MARKER_COLORS: Record<string, string> = { ...MARKER_COLORS, ...LEGACY_MARKER_COLORS };

/**
 * Every event type enabled by default in the event-stream list view and the
 * canvas timeline (see App.tsx's `ALL_ENABLED`). There is no user-facing
 * toggle to re-enable a type once excluded, so all three legacy types must
 * be included here or old recordings' EQ/intervention rows silently vanish
 * from both views. The cast is required because the legacy string literals
 * above are not members of the schema-derived `EventType` union.
 */
export const ALL_EVENT_TYPES_WITH_LEGACY = [
    ...ALL_EVENT_TYPES, ...LEGACY_EVENT_TYPES,
] as unknown as readonly EventType[];

/**
 * Event types displayed as swim lanes on the canvas timeline, plus the
 * legacy `eqSnapshot` type: the pre-sync code gave `eqSnapshot` its own swim
 * lane, while `eqEngineState`/`intervention` were deliberately excluded from
 * swim lanes (aggregate/engine-state types, handled elsewhere; see
 * SessionTimeline.tsx's EQ chart and eventDisplay.tsx's detail row). This
 * restores that same split. The cast is required for the same reason as
 * ALL_EVENT_TYPES_WITH_LEGACY above.
 */
export const SWIM_LANE_TYPES = [
    ...ALL_EVENT_TYPES, 'eqSnapshot',
] as unknown as readonly EventType[];
