import type { ChatMessage } from '@webview/views/IrisChat/types';

/**
 * Non-destructive merge of a persisted history snapshot into the live message
 * list, used by the reconnect reconciliation path. Unlike the destructive
 * `applyLoadedMessages` replace, this preserves the optimistic/error bubbles
 * that carry no server id and keeps each surviving bubble's `localId` (React
 * identity) and `status`. Incoming history is authoritative for persisted
 * fields and defines the order; unmatched live bubbles follow, in order.
 */
export function mergeHistory(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    const existingById = new Map<number, ChatMessage>();
    for (const m of existing) {
        if (m.id !== undefined) { existingById.set(m.id, m); }
    }
    const incomingIds = new Set<number>();
    const merged = incoming.map((inc) => {
        if (inc.id !== undefined) { incomingIds.add(inc.id); }
        const prev = inc.id !== undefined ? existingById.get(inc.id) : undefined;
        // `...inc` wins for persisted fields; explicitly keep the live bubble's
        // identity (`localId`) and `status` so a matched, already-confirmed
        // user bubble is not silently re-stamped by the view mapping's
        // `status: 'sent'`. New inserts (no `prev`) take whatever the caller
        // provided (the view maps them as `sent`).
        return prev ? { ...prev, ...inc, localId: prev.localId, status: prev.status } : inc;
    });
    const leftover = existing.filter((m) => m.id === undefined || !incomingIds.has(m.id));
    return [...merged, ...leftover];
}
