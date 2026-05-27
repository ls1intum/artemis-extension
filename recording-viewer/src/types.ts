// Re-export all recording types from the synced copy
export type * from './generated/recordingTypes.ts';

import type { RecordedEvent, SessionMetadata } from './generated/recordingTypes.ts';

// Viewer-specific types

export type EventType = RecordedEvent['type'];

export interface VideoSyncConfig {
    videoTimeAtSessionStartSeconds: number;
    videoExtension: 'mp4' | 'webm';
}

export type StruggleLevel = 'confident' | 'light-struggle' | 'medium-struggle' | 'high-struggle' | 'blocked';
export type ContextMarker = 'idle' | 'trial-error' | 'reading' | 'off-task' | 'using-ai' | 'iris-moment' | 'reading-test-results';
export type AnnotationLabel = StruggleLevel | ContextMarker;

export const STRUGGLE_LABELS: { value: StruggleLevel; label: string; color: string }[] = [
    { value: 'confident', label: 'Confident', color: '#4ade80' },
    { value: 'light-struggle', label: 'Light struggle', color: '#a3e635' },
    { value: 'medium-struggle', label: 'Medium struggle', color: '#fbbf24' },
    { value: 'high-struggle', label: 'High struggle', color: '#f97316' },
    { value: 'blocked', label: 'Blocked', color: '#ef4444' },
];

export const CONTEXT_LABELS: { value: ContextMarker; label: string; color: string }[] = [
    { value: 'idle', label: 'Idle', color: '#94a3b8' },
    { value: 'trial-error', label: 'Trial & error', color: '#c084fc' },
    { value: 'reading', label: 'Reading', color: '#60a5fa' },
    { value: 'off-task', label: 'Off-task', color: '#fb7185' },
    { value: 'using-ai', label: 'Using AI', color: '#2dd4bf' },
    { value: 'iris-moment', label: 'Iris Moment', color: '#818cf8' },
    { value: 'reading-test-results', label: 'Reading test results', color: '#f59e0b' },
];

export const ALL_LABELS = [...STRUGGLE_LABELS, ...CONTEXT_LABELS];

export interface Annotation {
    id: string;
    timestamp: number;   // absolute ms (same epoch as event timestamps)
    text: string;
    label?: AnnotationLabel;
    createdAt: number;
}

export interface ReplayEqSnapshot {
    timestamp: number;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    source: 'save' | 'build' | 'trigger';
    errorCount: number;
    errorFamilies: string[];
}

export interface LoadedSession {
    metadata: SessionMetadata | null;
    events: RecordedEvent[];
    fileName: string;
    /** Resolved schema version: metadata.schemaVersion > sessionStart.schemaVersion > 1 */
    schemaVersion: number;
    replayEq?: ReplayEqSnapshot[];
    annotations?: Annotation[];
}
