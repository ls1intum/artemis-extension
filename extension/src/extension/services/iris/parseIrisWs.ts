/**
 * Light-touch runtime guards for Iris WebSocket payloads.
 *
 * Deliberately less strict than the replay-surface parsers in
 * `recording/parseRecordedData.ts`: live WS frames go straight into the UI
 * (chat panel, status indicator), so a wrong-shaped frame only causes a
 * missing render, with no downstream replay aggregation to corrupt. The guards
 * check object shape (not null, not array, not primitive) and nothing else;
 * every key stays a permissive `[key: string]: unknown` lookup at the call
 * site.
 */

import type { IrisActivityDTO, IrisChatMessage, IrisRunState } from '@extension/types';

/**
 * Minimal structural shape of an incoming Iris WebSocket frame. Exported
 * so listeners can rely on it without a separate cast after the guard.
 */
export type IrisWebSocketMessage = Record<string, unknown> & {
    type?: string;
    message?: IrisChatMessage;
    runId?: string;
    runState?: IrisRunState;
    partialResult?: string;
    partialSeq?: number;
    activities?: unknown;
    activitySeq?: number;
    final?: boolean;
    error?: { message?: string } | null;
};

/**
 * True if `data` looks like an object IrisWebSocketMessage payload: non-null,
 * non-array, non-primitive. Per-key shape (`type`, `message`, etc.) stays
 * permissive and is validated downstream by the handler.
 */
export function isIrisWebSocketMessage(data: unknown): data is IrisWebSocketMessage {
    return data !== null && typeof data === 'object' && !Array.isArray(data);
}

const ACTIVITY_STATES = new Set(['RUNNING', 'FINISHED', 'FAILED']);
const ACTIVITY_KINDS = new Set(['TOOL', 'COMMAND']);

/**
 * True if `value` is a usable activity entry. Unlike stages there is no
 * `internal` flag to filter on: the server already curates activities.
 */
export function isIrisActivity(value: unknown): value is IrisActivityDTO {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const a = value as Record<string, unknown>;
    return typeof a['id'] === 'string'
        && typeof a['name'] === 'string'
        && typeof a['kind'] === 'string' && ACTIVITY_KINDS.has(a['kind'])
        && typeof a['state'] === 'string' && ACTIVITY_STATES.has(a['state']);
}
