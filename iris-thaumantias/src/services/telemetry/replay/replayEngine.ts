/**
 * Replay Engine — feeds recorded events through the EQ detection pipeline.
 *
 * Pure Node.js, no VS Code dependencies. Takes RecordedEvent[] and produces
 * ReplayEqSnapshot[] by simulating the CompileEquivalentEmitter + ErrorQuotientEngine
 * behavior against serialized recording data.
 */

import type { EQConfig } from '../types';
import { DEFAULT_EQ_CONFIG } from '../types';
import { ErrorQuotientEngine } from '../metrics/errorQuotientEngine';
import type {
    RecordedEvent,
    SerializedDiagnostic,
    DiagnosticsEvent,
    SaveEvent,
    BuildResultEvent,
} from '../recording/types';
import {
    createSnapshotFromDiagnosticState,
    createSnapshotFromBuildEvent,
} from './snapshotReconstructor';

export interface ReplayEqSnapshot {
    timestamp: number;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    source: 'save' | 'build';
    errorCount: number;
    errorFamilies: string[];
}

/** Stabilization window — mirrors CompileEquivalentEmitter's 500ms setTimeout */
const LOOKAHEAD_WINDOW_MS = 500;

/**
 * Apply lookahead diagnostics within the stabilization window after a save.
 * Scans forward from currentIndex for diagnostics events within saveTimestamp + windowMs
 * and applies them to diagnosticState (idempotent set).
 */
function applyLookaheadDiagnostics(
    events: RecordedEvent[],
    currentIndex: number,
    cutoffTimestamp: number,
    diagnosticState: Map<string, SerializedDiagnostic[]>,
): void {
    for (let j = currentIndex + 1; j < events.length; j++) {
        const future = events[j];
        if (future.timestamp > cutoffTimestamp) {
            break;
        }
        if (future.type === 'diagnostics') {
            const diagEvent = future as DiagnosticsEvent;
            diagnosticState.set(diagEvent.uri, diagEvent.diagnostics);
        }
    }
}

/**
 * Replay a session's recorded events through the EQ pipeline.
 *
 * @param events - Chronologically ordered RecordedEvent array from events.jsonl
 * @param config - Optional EQConfig override for tuning experiments
 * @returns Array of ReplayEqSnapshot with EQ values at each compile-equivalent event
 */
export function replaySession(
    events: RecordedEvent[],
    config: EQConfig = DEFAULT_EQ_CONFIG,
): ReplayEqSnapshot[] {
    const engine = new ErrorQuotientEngine(config);
    const diagnosticState = new Map<string, SerializedDiagnostic[]>();
    const result: ReplayEqSnapshot[] = [];

    for (let i = 0; i < events.length; i++) {
        const event = events[i];

        if (event.type === 'diagnostics') {
            const diagEvent = event as DiagnosticsEvent;
            diagnosticState.set(diagEvent.uri, diagEvent.diagnostics);
        }

        if (event.type === 'save') {
            const saveEvent = event as SaveEvent;
            // Lookahead stabilization: apply diagnostic events within +500ms
            applyLookaheadDiagnostics(
                events,
                i,
                saveEvent.timestamp + LOOKAHEAD_WINDOW_MS,
                diagnosticState,
            );

            const snapshot = createSnapshotFromDiagnosticState(
                diagnosticState,
                saveEvent.timestamp,
            );
            engine.addSnapshot(snapshot);

            const { eq, confidence } = engine.getCurrentEQ();
            result.push({
                timestamp: saveEvent.timestamp,
                eq,
                confidence,
                source: 'save',
                errorCount: snapshot.errorCount,
                errorFamilies: [...snapshot.errorFamilies],
            });
        }

        if (event.type === 'buildResult') {
            const buildEvent = event as BuildResultEvent;
            const snapshot = createSnapshotFromBuildEvent(buildEvent);
            engine.addSnapshot(snapshot);

            const { eq, confidence } = engine.getCurrentEQ();
            result.push({
                timestamp: buildEvent.timestamp,
                eq,
                confidence,
                source: 'build',
                errorCount: snapshot.errorCount,
                errorFamilies: [...snapshot.errorFamilies],
            });
        }
    }

    return result;
}
