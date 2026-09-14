import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';
import type { IrisChatMessage } from '@shared/types/apiResponses';
import type { SessionDetail } from '@shared/types/serverContext';

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
    /**
     * The three PERSISTED proactive fields. Without them a reloaded hint arrives as an ordinary
     * assistant bubble: `groupByEpisode` needs `origin` + `proactiveEpisodeId` to form a group at
     * all, and `proactiveOutcome` supplies the fold line's label. The ephemeral `offer` marker is
     * deliberately NOT here; it dies with the session it was raised in.
     */
    origin?: 'proactive';
    proactiveOutcome?: 'DISMISSED' | 'RECOVERED' | 'ABANDONED';
    proactiveEpisodeId?: string;
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
            // Conditional, never `origin: undefined`. `mergeHistory` merges as `{ ...prev, ...inc }`
            // and a spread copies own properties INCLUDING undefined ones, so an unconditionally
            // mapped field would blank a live bubble's episode identity on every reconnect. Absent
            // means "this row says nothing about it", which is what a merge has to be able to say.
            ...(message.origin === 'PROACTIVE_STRUGGLE' ? { origin: 'proactive' as const } : {}),
            ...(message.proactiveOutcome !== undefined ? { proactiveOutcome: message.proactiveOutcome } : {}),
            ...(message.proactiveEpisodeId !== undefined ? { proactiveEpisodeId: message.proactiveEpisodeId } : {}),
            activities: toActivities(message),
            final: typeof message.final === 'boolean' ? message.final : undefined,
        };
    });
}

/**
 * The transcript message for an installed conversation. The ONLY producer of
 * the visible message list, so `'load'` and `'merge'` can never disagree about
 * what a transcript looks like: only `'load'` sets the webview's
 * `loadedSessionId`, which is what clears the loader.
 */
export function transcriptMessage(detail: SessionDetail, mode: 'load' | 'merge'): ExtensionToWebviewMessage {
    return {
        type: mode === 'merge' ? ExtensionMsg.MergeSessionMessages : ExtensionMsg.LoadMessages,
        sessionId: detail.sessionId,
        messages: toWireMessages(detail.messages),
    };
}
