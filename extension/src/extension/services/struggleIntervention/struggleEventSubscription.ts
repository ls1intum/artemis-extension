import type { StruggleInterventionEvent } from './struggleContract';

/** The per-user struggle topic suffix (Plan 2 sends via IrisWebsocketService.send(login, "struggle-intervention", ...)). */
export const STRUGGLE_EVENT_TOPIC = '/user/topic/iris/struggle-intervention';

/** Pure: parse an inbound per-user struggle frame; undefined for anything that is not an ambient/active event. */
export function classifyStruggleEvent(data: unknown): StruggleInterventionEvent | undefined {
    if (data === null || typeof data !== 'object') {
        return undefined;
    }
    const f = data as {
        exerciseId?: unknown; action?: unknown; message?: unknown; sessionId?: unknown; messageId?: unknown; confidence?: unknown;
        anchorFile?: unknown; anchorLine?: unknown; inlineHint?: unknown;
    };
    if (typeof f.exerciseId !== 'number' || (f.action !== 'ambient' && f.action !== 'active')) {
        return undefined;
    }
    const sessionId = typeof f.sessionId === 'number' ? f.sessionId : undefined;
    if (f.action === 'active' && sessionId === undefined) {
        return undefined;
    }
    const messageId = typeof f.messageId === 'number' ? f.messageId : undefined;
    const anchorFile = typeof f.anchorFile === 'string' ? f.anchorFile : undefined;
    const anchorLine = typeof f.anchorLine === 'number' ? f.anchorLine : undefined;
    const inlineHint = typeof f.inlineHint === 'string' ? f.inlineHint : undefined;
    return {
        exerciseId: f.exerciseId,
        action: f.action,
        message: typeof f.message === 'string' ? f.message : undefined,
        sessionId,
        messageId,
        confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
        anchorFile,
        anchorLine,
        inlineHint,
    };
}

export interface StruggleEventHandlers {
    /** `exerciseId` lets the consumer drop frames that belong to a now-inactive
     *  exercise (the per-user topic is NOT exercise-filtered server-side, so a
     *  late frame for a previous exercise can arrive after a fast switch). */
    onServerAmbient(exerciseId: number, hint: string, confidence?: number): void;
    onServerActive(exerciseId: number, sessionId: number, confidence?: number): void;
}

/**
 * Subscribe the per-user struggle topic once and dispatch to the orchestrator. `subscribe` is the extension's
 * STOMP subscribe primitive (the same one the per-session chat topic uses) — injected so this stays testable.
 * Returns the disposable/unsubscribe.
 */
export function subscribeStruggleEvents(
    subscribe: (topic: string, onFrame: (data: unknown) => void) => { dispose(): void },
    handlers: StruggleEventHandlers,
): { dispose(): void } {
    return subscribe(STRUGGLE_EVENT_TOPIC, data => {
        const e = classifyStruggleEvent(data);
        if (!e) {
            return;
        }
        if (e.action === 'ambient') {
            handlers.onServerAmbient(e.exerciseId, e.message ?? '', e.confidence);
        }
        else {
            handlers.onServerActive(e.exerciseId, e.sessionId as number, e.confidence);
        }
    });
}
