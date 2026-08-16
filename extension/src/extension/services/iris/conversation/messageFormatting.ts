import type { IrisChatMessage } from '@shared/types/apiResponses';

import { extractIrisMessageContent } from '@extension/services/iris/chat/messageUtils';
import { describeContextSwap, isContextSwap, parseContextSwap } from '@extension/services/iris/context/contextMarkers';
import { isIrisActivity } from '@extension/services/iris/parseIrisWs';

/** One transcript row as the webview renders it. */
interface WireMessage {
    id?: number;
    role: 'user' | 'assistant' | 'contextSwap';
    content: string;
    timestamp: number;
    helpful?: boolean | null;
    activities?: ReturnType<typeof toActivities>;
    final?: boolean;
}

function toActivities(message: IrisChatMessage) {
    return Array.isArray(message.activities) ? message.activities.filter(isIrisActivity) : undefined;
}

/**
 * Projects a loaded conversation's messages onto the wire.
 *
 * A CTXSWAP row gets its own role rather than `assistant`: the transcript
 * renders it as a divider, and calling it an assistant message puts an
 * unreadable JSON blob in the conversation. `SessionDetail.messages` carries
 * every persisted sender, markers included, so this is the only place that can
 * tell them apart.
 */
export function toWireMessages(messages: IrisChatMessage[] | undefined): WireMessage[] {
    return (messages ?? []).map((message) => {
        const timestamp = message.sentAt ? new Date(message.sentAt).getTime() : Date.now();
        if (isContextSwap(message)) {
            const swap = parseContextSwap(message);
            return {
                id: message.id,
                role: 'contextSwap' as const,
                // An undecodable marker is still a marker: it made the
                // conversation non-empty, so it must occupy its row.
                content: swap ? describeContextSwap(swap) : 'Topic changed',
                timestamp,
            };
        }
        return {
            id: message.id,
            role: (message.sender === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: extractIrisMessageContent(message.content),
            timestamp,
            helpful: (message as { helpful?: boolean | null }).helpful,
            activities: toActivities(message),
            final: typeof message.final === 'boolean' ? message.final : undefined,
        };
    });
}
