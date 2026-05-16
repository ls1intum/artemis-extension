import type { ChatContextType } from '@shared/types/context';
import type { IrisChatMode } from '@shared/types/apiResponses';

/**
 * Maps the extension's ChatContextType to the Artemis IrisChatMode enum
 * expected by the unified /api/iris/chat endpoints. Single source of truth.
 */
export function contextToIrisMode(type: ChatContextType): IrisChatMode {
    return type === 'course' ? 'COURSE_CHAT' : 'PROGRAMMING_EXERCISE_CHAT';
}
