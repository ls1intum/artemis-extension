/**
 * Replay engine: feeds recorded events through the EQ detection pipeline.
 *
 * Pure Node.js, no VS Code dependencies. Takes RecordedEvent[] and produces
 * ReplayEqSnapshot[] by simulating the CompileEquivalentEmitter + ErrorQuotientEngine
 * behavior against serialized recording data.
 */

import { ErrorQuotientEngine } from '@extension/services/telemetry/metrics/errorQuotientEngine';
import type {
    EqEngineStateEvent,
    RecordedEvent,
    SerializedDiagnostic,
} from '@extension/services/telemetry/recording/types';
import type { EQConfig, ErrorSnapshot } from '@extension/services/telemetry/types';
import { DEFAULT_EQ_CONFIG } from '@extension/services/telemetry/types';

import { createSnapshotFromBuildEvent, createSnapshotFromDiagnosticState } from './snapshotReconstructor';

interface ReplayEqSnapshot {
    timestamp: number;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    source: 'save' | 'build' | 'trigger';
    errorCount: number;
    errorFamilies: string[];
}

/** Stabilization window; mirrors CompileEquivalentEmitter's 500ms setTimeout. */
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
            diagnosticState.set(future.uri, future.diagnostics);
        }
    }
}

function deserializeEngineState(stateEvent: EqEngineStateEvent): ErrorSnapshot[] {
    return stateEvent.snapshots.map(s => ({
        timestamp: s.timestamp,
        hasErrors: s.hasErrors,
        errorFamilies: new Set(s.errorFamilies),
        errorCount: s.errorCount,
    }));
}

/**
 * Replay a session's recorded events through the EQ pipeline.
 *
 * If the events contain an eqEngineState event (recorded at session start),
 * the engine is seeded with the pre-existing snapshots so that the replay
 * matches the live EQ curve.
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
    let exerciseRoot: string | undefined;

    function pushIfAccepted(snapshot: ErrorSnapshot, source: 'save' | 'build', timestamp: number): void {
        const accepted = engine.addSnapshot(snapshot);
        if (!accepted) { return; }
        const { eq, confidence } = engine.getCurrentEQ();
        result.push({ timestamp, eq, confidence, source, errorCount: snapshot.errorCount, errorFamilies: [...snapshot.errorFamilies] });
    }

    for (let i = 0; i < events.length; i++) {
        const event = events[i];

        // Extract exercise root from session start for diagnostic filtering
        if (event.type === 'sessionStart') {
            exerciseRoot = event.exerciseRoot;
            continue;
        }

        // Seed engine with pre-existing state from before recording started
        if (event.type === 'eqEngineState') {
            const snapshots = deserializeEngineState(event);
            engine.seedSnapshots(snapshots);
            continue;
        }

        // Emit replay point at trigger evaluations so the replay line matches the original
        if (event.type === 'eqSnapshot' && event.source === 'trigger') {
            const { eq, confidence } = engine.getCurrentEQ();
            const lastSnapshot = engine.getState().snapshots.at(-1);
            result.push({
                timestamp: event.timestamp,
                eq,
                confidence,
                source: 'trigger',
                errorCount: lastSnapshot?.errorCount ?? 0,
                errorFamilies: lastSnapshot ? [...lastSnapshot.errorFamilies] : [],
            });
        }

        if (event.type === 'diagnostics') {
            diagnosticState.set(event.uri, event.diagnostics);
        }

        if (event.type === 'save') {
            // Coalescing: skip if another save within 500ms (live clears+resets timer)
            let coalesced = false;
            for (let j = i + 1; j < events.length; j++) {
                if (events[j].timestamp > event.timestamp + LOOKAHEAD_WINDOW_MS) {
                    break;
                }
                if (events[j].type === 'save') {
                    coalesced = true;
                    break;
                }
            }
            if (coalesced) {
                continue;
            }

            const snapshotTimestamp = event.timestamp + LOOKAHEAD_WINDOW_MS;
            applyLookaheadDiagnostics(events, i, snapshotTimestamp, diagnosticState);

            const snapshot = createSnapshotFromDiagnosticState(
                diagnosticState, snapshotTimestamp, exerciseRoot,
            );
            pushIfAccepted(snapshot, 'save', snapshot.timestamp);
        }

        if (event.type === 'buildResult') {
            const snapshot = createSnapshotFromBuildEvent(event);
            pushIfAccepted(snapshot, 'build', event.timestamp);
        }
    }

    return result;
}
