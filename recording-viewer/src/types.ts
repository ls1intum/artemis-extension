// Re-export all recording types from the synced copy
export type * from './generated/recordingTypes.ts';

import type { RecordedEvent, SessionMetadata } from './generated/recordingTypes.ts';

// Viewer-specific types

export type EventType = RecordedEvent['type'];

export interface VideoSyncConfig {
    videoTimeAtSessionStartSeconds: number;
    videoExtension: 'mp4' | 'webm';
}

export interface Annotation {
    id: string;
    timestamp: number;   // absolute ms (same epoch as event timestamps)
    text: string;
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
    replayEq?: ReplayEqSnapshot[];
    annotations?: Annotation[];
}
