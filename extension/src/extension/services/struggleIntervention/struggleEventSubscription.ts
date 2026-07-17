import type { StruggleInterventionEvent } from './struggleContract';

/** The per-user struggle topic suffix (Plan 2 sends via IrisWebsocketService.send(login, "struggle-intervention", ...)). */
const STRUGGLE_EVENT_TOPIC = '/user/topic/iris/struggle-intervention';

/** Pure: parse an inbound per-user struggle frame. Returns the typed event for known frame shapes;
 *  undefined for malformed or unrecognised frames. */
export function classifyStruggleEvent(data: unknown): StruggleInterventionEvent | undefined {
    if (data === null || typeof data !== 'object') {
        return undefined;
    }
    const f = data as {
        exerciseId?: unknown; kind?: unknown; action?: unknown; message?: unknown;
        sessionId?: unknown; messageId?: unknown; confidence?: unknown; episodeId?: unknown;
        anchorFile?: unknown; anchorLine?: unknown; inlineHint?: unknown;
        resolved?: unknown; closingSentence?: unknown; episodeLabel?: unknown;
        ask?: unknown; question?: unknown;
    };
    if (typeof f.exerciseId !== 'number') {
        return undefined;
    }

    const exerciseId = f.exerciseId;
    const kind = typeof f.kind === 'string' ? f.kind : undefined;
    const episodeId = typeof f.episodeId === 'string' ? f.episodeId : undefined;
    const messageId = typeof f.messageId === 'number' ? f.messageId : undefined;

    // confirm_close frame
    if (kind === 'confirm_close') {
        if (typeof f.resolved !== 'boolean') { return undefined; }
        return {
            exerciseId,
            kind: 'confirm_close',
            episodeId,
            resolved: f.resolved,
            closingSentence: typeof f.closingSentence === 'string' ? f.closingSentence : undefined,
            episodeLabel: typeof f.episodeLabel === 'string' ? f.episodeLabel : undefined,
            messageId,
        };
    }

    // decide frame (kind='decide' OR backwards-compat without kind for ambient/active)
    const action = typeof f.action === 'string' ? f.action : undefined;

    if (kind === 'decide' && action === 'silent') {
        // New-style silent decide: requires episodeId to be validated by the orchestrator.
        // The frame is still returned even if episodeId is absent; the orchestrator drops it.
        const sessionId = typeof f.sessionId === 'number' ? f.sessionId : undefined;
        return {
            exerciseId,
            kind: 'decide',
            action: 'silent',
            episodeId,
            sessionId,
            messageId,
            confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
        };
    }

    // ambient or active (kind='decide' or backwards-compat no-kind)
    if (action === 'ambient' || action === 'active') {
        const sessionId = typeof f.sessionId === 'number' ? f.sessionId : undefined;
        if (action === 'active' && sessionId === undefined) {
            return undefined; // active requires sessionId
        }
        const anchorFile = typeof f.anchorFile === 'string' ? f.anchorFile : undefined;
        const anchorLine = typeof f.anchorLine === 'number' ? f.anchorLine : undefined;
        const inlineHint = typeof f.inlineHint === 'string' ? f.inlineHint : undefined;
        return {
            exerciseId,
            kind: kind === 'decide' ? 'decide' : undefined,
            action,
            episodeId,
            message: typeof f.message === 'string' ? f.message : undefined,
            sessionId,
            messageId,
            confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
            anchorFile,
            anchorLine,
            inlineHint,
        };
    }

    return undefined;
}

export interface StruggleEventHandlers {
    /** `exerciseId` lets the consumer drop frames that belong to a now-inactive
     *  exercise (the per-user topic is NOT exercise-filtered server-side, so a
     *  late frame for a previous exercise can arrive after a fast switch).
     *  `episodeId` is the echoed request episode; the orchestrator correlates it against the
     *  in-flight marker to drop a late reply for a superseded request (#349 Finding 1).
     *  `messageId` is forwarded for slot correlation (C3/C4); null when absent. */
    onServerAmbient(exerciseId: number, episodeId: string | undefined, hint: string, anchorFile: string | undefined, anchorLine: number | undefined, inlineHint: string | undefined, confidence: number | undefined, messageId: number | null): void;
    /** Active also carries the optional anchor (spec §6.1) and the hint `message` text for the
     *  optimistic bubble. `episodeId` correlates against the in-flight marker (#349 Finding 1).
     *  `messageId` enables webview-side dedup; null when server persist failed (A9). */
    onServerActive(exerciseId: number, episodeId: string | undefined, sessionId: number, anchorFile: string | undefined, anchorLine: number | undefined, inlineHint: string | undefined, confidence: number | undefined, message: string | undefined, messageId: number | null): void;
    /** Server decided no intervention is needed. Frees PARKED (discard-free), suppresses for DELIVERED.
     *  `episodeId` is echoed from the request; used by the orchestrator for stale-drop validation (C4). */
    onServerSilent(episodeId: string | undefined, messageId: number | undefined): void;
    /** Server confirms or denies the close request (C4). Routes by the client's current slot state. */
    onServerClose(episodeId: string | undefined, resolved: boolean, messageId: number | undefined, closingSentence: string | undefined, episodeLabel: string | undefined): void;
}

/**
 * Subscribe the per-user struggle topic once and dispatch to the orchestrator. `subscribe` is the extension's
 * STOMP subscribe primitive (the same one the per-session chat topic uses) -- injected so this stays testable.
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

        if (e.kind === 'confirm_close') {
            handlers.onServerClose(e.episodeId, e.resolved as boolean, e.messageId, e.closingSentence, e.episodeLabel);
            return;
        }

        // decide frame (kind='decide' or backwards-compat ambient/active)
        const messageId = e.messageId ?? null;
        if (e.action === 'silent') {
            handlers.onServerSilent(e.episodeId, e.messageId);
            return;
        }
        if (e.action === 'ambient') {
            handlers.onServerAmbient(e.exerciseId, e.episodeId, e.message ?? '', e.anchorFile, e.anchorLine, e.inlineHint, e.confidence, messageId);
            return;
        }
        if (e.action === 'active') {
            handlers.onServerActive(e.exerciseId, e.episodeId, e.sessionId as number, e.anchorFile, e.anchorLine, e.inlineHint, e.confidence, e.message, messageId);
        }
    });
}
