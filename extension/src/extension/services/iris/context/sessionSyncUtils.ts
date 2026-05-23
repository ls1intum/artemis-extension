import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import { extractIrisMessageContent } from '@extension/services/iris/chat/messageUtils';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ActiveContext, IrisChatMessage, IrisChatSession } from '@extension/types';

import { contextToIrisMode } from './contextChatMode';
import { ContextStore } from './contextStore';
import { resolveCourseIdFromContext } from './courseIdResolver';

/**
 * Shared dependency bag for Iris services. Bundles common params so
 * constructors stay short and wiring is DRY.
 */
export interface IrisServiceDeps {
    contextStore: ContextStore;
    artemisApiService: ArtemisApiService | undefined;
    postMessage: (message: ExtensionToWebviewMessage) => void;
    postSnapshot: () => void;
}

/**
 * Lists Iris chat sessions for the given context and hydrates each with messages.
 *
 * The unified /api/iris/chat/{courseId}/sessions/overview endpoint returns
 * lightweight summaries across all modes for the course. We filter to the
 * relevant mode + entityId before fanning out to /api/iris/sessions/{id}/messages
 * so unrelated sessions are never fetched.
 */
export async function fetchSessionsWithMessages(
    api: ArtemisApiService,
    contextStore: ContextStore,
    context: ActiveContext,
): Promise<IrisChatSession[]> {
    const courseId = await resolveCourseIdFromContext(context, contextStore, api);
    if (courseId === undefined) {
        logger.warn(
            `Cannot list sessions: unable to resolve courseId for context ${context.type}:${context.id}`,
            LogCategory.IRIS_CHAT,
        );
        return [];
    }
    const mode = contextToIrisMode(context.type);
    const summaries = await api.listChatSessionsForCourse(courseId);
    const filtered = summaries.filter(s => s.mode === mode && s.entityId === context.id);

    return Promise.all(filtered.map(async (summary) => {
        const base = {
            id: summary.id,
            title: summary.title,
            creationDate: summary.creationDate,
            mode: summary.mode,
            entityId: summary.entityId,
        };
        try {
            const messages = await api.getChatMessages(summary.id);
            return { ...base, messages };
        } catch (error) {
            logger.warn(
                `Failed to fetch messages for session ${summary.id}: ${error}`,
                LogCategory.API,
            );
            return { ...base, messages: [] };
        }
    }));
}

/**
 * Sorts sessions newest-first, extracts preview from first user message,
 * and imports each session into the context store.
 *
 * Returns the number of sessions actually imported. Empty server sessions
 * (no messages) are skipped — callers rely on this count to decide whether
 * to fall back to creating a fresh session.
 *
 * NOTE: createSessionWithDetails() prepends sessions. Since we iterate
 * newest-first and prepend each time, the stored array ends up oldest-first.
 * Existing behavior, preserved intentionally.
 */
export function importSessionsToStore(
    sessions: IrisChatSession[],
    contextStore: ContextStore,
): number {
    if (sessions.length === 0) {
        return 0;
    }

    sessions.sort((a, b) => {
        const timeA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
        const timeB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
        return timeB - timeA;
    });

    let imported = 0;
    for (const session of sessions) {
        const messageCount = session.messages?.length || 0;
        if (messageCount === 0) {
            continue;
        }

        const createdAt = session.creationDate ? new Date(session.creationDate).getTime() : Date.now();

        let preview = 'New conversation';
        if (session.messages && session.messages.length > 0) {
            const firstUserMsg = session.messages.find((m: IrisChatMessage) => m.sender === 'USER');
            if (firstUserMsg) {
                const content = extractIrisMessageContent(firstUserMsg.content);
                if (content) {
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
            typeof session.title === 'string' ? session.title : undefined,
        );
        imported++;
    }

    return imported;
}
