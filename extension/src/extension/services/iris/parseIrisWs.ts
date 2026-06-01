/**
 * Light-touch runtime guards for Iris WebSocket payloads (#183 part B).
 *
 * Deliberately less strict than the replay-surface parsers in
 * `recording/parseRecordedData.ts`: live WS frames go straight into the
 * UI (chat panel, status indicator), so a wrong-shaped frame just causes
 * a missing render — there's no downstream replay aggregation to corrupt.
 * The guards therefore check the minimum needed to safely call the
 * payload an `IrisWebSocketMessage` / `IrisStageDTO`:
 *   - object shape (not null, not array, not primitive)
 *   - the one field the consumer actually reads to gate behaviour
 *     (`internal` for stages)
 *
 * Everything else stays as a permissive `[key: string]: unknown` lookup
 * at the call site — matching how live WS data is consumed elsewhere.
 */

import type { IrisChatMessage, IrisStageDTO } from '@extension/types';

/**
 * Minimal structural shape of an incoming Iris WebSocket frame. Exported
 * so listeners can rely on it without a separate cast after the guard.
 */
export type IrisWebSocketMessage = Record<string, unknown> & {
    type?: string;
    message?: IrisChatMessage;
};

/**
 * True if `data` looks like an object IrisWebSocketMessage payload — i.e.
 * non-null, non-array, non-primitive. Per-key shape (`type`, `message`,
 * etc.) is still permissive and validated downstream by the handler.
 */
export function isIrisWebSocketMessage(data: unknown): data is IrisWebSocketMessage {
    return data !== null && typeof data === 'object' && !Array.isArray(data);
}

/**
 * True if `stage` is a plain object whose `internal` flag is not `true`.
 * This is exactly the predicate the STATUS handler uses to decide whether
 * to surface a stage in the UI — extracting it removes the inline `as
 * IrisStageDTO` cast from `irisWebSocketMessageHandler.ts` while keeping
 * the gating semantics identical.
 */
export function isVisibleIrisStage(stage: unknown): stage is IrisStageDTO {
    if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) {
        return false;
    }
    return (stage as { internal?: unknown }).internal !== true;
}
