import { ArtemisApiService } from '../../api';
import { ContextStore } from '../contextStore';
import { extractIrisMessageContent } from '../../utils/irisMessageUtils';
import { logger, LogCategory } from '../loggingService';
import type { ActiveContext, IrisChatSession, IrisChatMessage } from '../../types';
import type { ExtensionToWebviewMessage } from '../../shared/messageContracts';

/**
 * Shared dependency bag for Iris services.
 * Bundles common params so constructors stay short and wiring is DRY.
 */
export interface IrisServiceDeps {
    contextStore: ContextStore;
    artemisApiService: ArtemisApiService | undefined;
    postMessage: (message: ExtensionToWebviewMessage) => void;
    postSnapshot: () => void;
}

/**
 * Fetches all sessions with messages for the given context.
 * Delegates to the existing API methods that handle the fetch-metadata → fetch-messages dance.
 */
export async function fetchSessionsWithMessages(
    api: ArtemisApiService,
    context: ActiveContext
): Promise<IrisChatSession[]> {
    if (context.type === 'course') {
        return api.getCourseChatSessionsWithMessages(context.id);
    } else if (context.type === 'exercise') {
        return api.getExerciseChatSessionsWithMessages(context.id);
    }
    logger.info(`Unsupported context type: ${context.type}`, LogCategory.IRIS_CHAT);
    return [];
}

/**
 * Sorts sessions newest-first, extracts preview from first user message,
 * and imports each session into the context store.
 *
 * Returns the number of imported sessions.
 *
 * NOTE: createSessionWithDetails() prepends sessions. Since we iterate
 * newest-first and prepend each time, the stored array ends up oldest-first.
 * This is existing behavior — preserving it intentionally.
 */
export function importSessionsToStore(
    sessions: IrisChatSession[],
    contextStore: ContextStore
): number {
    if (sessions.length === 0) {
        return 0;
    }

    // Sort by creation date (newest first)
    sessions.sort((a, b) => {
        const dateA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
        const dateB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
        return dateB - dateA;
    });

    for (const session of sessions) {
        const messageCount = session.messages?.length || 0;
        const createdAt = session.creationDate ? new Date(session.creationDate).getTime() : Date.now();

        // Extract preview from first user message using shared content extractor
        let preview = 'New conversation';
        if (session.messages && session.messages.length > 0) {
            const firstUserMsg = session.messages.find((m: IrisChatMessage) => m.sender === 'USER');
            if (firstUserMsg) {
                const content = extractIrisMessageContent(firstUserMsg.content);
                if (content && content !== 'undefined' && content !== 'null') {
                    preview = content.substring(0, 50);
                }
            }
        }

        logger.info(`Importing session ${session.id}: ${messageCount} messages, preview: "${preview}"`, LogCategory.IRIS_CHAT);

        contextStore.createSessionWithDetails(
            preview,
            messageCount,
            createdAt,
            session.id,
            session.messages || []
        );
    }

    return sessions.length;
}
