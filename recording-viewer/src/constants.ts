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
    intervention: '#f97316',
    viewNavigation: '#a78bfa',
    panelVisibility: '#fbbf24',
    selectionChange: '#06b6d4',
    visibleRangeChange: '#14b8a6',
};

export const ALL_EVENT_TYPES = [
    'sessionStart', 'sessionEnd',
    'eqSnapshot', 'eqEngineState', 'intervention', 'buildResult',
    'textChange', 'save',
    'diagnostics',
    'fileSwitch',
    'windowFocus', 'fileSnapshot',
    'irisChatMessage',
    'viewNavigation', 'panelVisibility',
    'selectionChange', 'visibleRangeChange',
] as const satisfies readonly EventType[];

// Compile error if a new event type is added but not listed above
type _MissingEventTypes = Exclude<EventType, (typeof ALL_EVENT_TYPES)[number]>;
void (true satisfies (_MissingEventTypes extends never ? true : never));

/** Event types displayed as swim lanes (excludes EQ/intervention types handled by SessionTimeline) */
export const SWIM_LANE_TYPES = ALL_EVENT_TYPES.filter(
    (t): t is Exclude<EventType, 'eqSnapshot' | 'eqEngineState' | 'intervention'> =>
        t !== 'eqSnapshot' && t !== 'eqEngineState' && t !== 'intervention'
);
