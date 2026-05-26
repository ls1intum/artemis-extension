import type { LastAvailability } from '@extension/services/iris/chat/chatSessionService';
import type { ActiveContext } from '@extension/types';

/**
 * Decide whether a websocket reconnect should trigger an auto-retry reload
 * of the chat session. Pure function so we can unit-test the context-keyed
 * gate in isolation from the rest of {@link ChatWebviewProvider}.
 *
 * Rules:
 *   - Last classification must be `unavailable` (no point auto-retrying a
 *     disabled/enabled state).
 *   - The user must still be looking at the SAME context the classification
 *     was recorded for. After a context switch, the previous context's
 *     unavailable state is no longer relevant — the new context will get
 *     its own classification.
 *   - No active context = no retry.
 */
export function shouldAutoRetryReload(
    lastAvailability: LastAvailability,
    currentContext: ActiveContext | null,
): boolean {
    if (lastAvailability.kind !== 'unavailable') {
        return false;
    }
    if (!currentContext) {
        return false;
    }
    return lastAvailability.contextKey === `${currentContext.type}:${currentContext.id}`;
}
