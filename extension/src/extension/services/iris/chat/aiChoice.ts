import type { ArtemisApiService } from '@extension/api';
import { aiChoiceOf } from '@extension/domain';
import { LogCategory, logger } from '@extension/services/loggingService';

/** The two account states in which Artemis refuses every Iris conversation. */
export type AiBlock = 'none' | 'no-ai';

/** Artemis' page for the AI choice, relative to the server URL (9.9 onwards). */
export const AI_CHOICE_SETTINGS_PATH = '/user-settings/llm-usage';

/**
 * Reads the account's AI choice. Fresh on every call: the student makes the
 * choice in the browser, and a Retry here has to see it.
 *
 * Artemis' own refusal is a bare 403 without an `errorKey`, so the account is
 * the only reliable way to name this cause. `unknown` means the account could
 * not be read and nothing may be concluded from it.
 */
export async function checkAiChoice(api: ArtemisApiService | undefined): Promise<AiBlock | 'opted-in' | 'unknown'> {
    if (!api) { return 'unknown'; }
    try {
        return aiChoiceOf(await api.getCurrentUser());
    } catch (error: unknown) {
        logger.warn('Could not read the account to check the AI choice', LogCategory.IRIS_CHAT, error);
        return 'unknown';
    }
}

/** The persistent banner. Both end in Retry, the way back once the choice is made. */
export function aiBlockBannerText(block: AiBlock): string {
    return block === 'none'
        ? 'Iris needs your AI choice. Make it in your Artemis settings, then select Retry.'
        : 'You chose not to use AI in Artemis, so Iris is off. You can change this in your Artemis settings, then select Retry.';
}

/** A navigation that was refused because of the block. */
export function aiBlockRefusalText(block: AiBlock): string {
    return block === 'none'
        ? 'Iris needs your AI choice in Artemis first.'
        : 'You chose not to use AI in Artemis.';
}

/** A message that was not sent because of the block. */
export function aiBlockSendText(block: AiBlock): string {
    return block === 'none'
        ? 'Not sent. Iris needs your AI choice in Artemis.'
        : 'Not sent. You chose not to use AI in Artemis.';
}
