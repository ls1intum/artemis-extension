import type { ServerContext } from '@shared/types/serverContext';

import type { TopicChangeOutcome } from '@extension/services/iris/conversation/conversationService';

/**
 * Minimal interface for ChatWebviewProvider, consumed by ProviderRegistry for dependency inversion.
 */
export interface IChatWebviewProvider {
    /** True iff a `.noai` marker disables AI for the workspace (spec §14 case 3). */
    isNoAiEnabled(): boolean;
    /** Resolves once the initial `.noai` workspace scan has completed, so `isNoAiEnabled()` is authoritative. */
    whenNoAiReady(): Promise<void>;
    /** Collapse every proactive episode in the transcript to a fold line (student switched proactive help to Off). */
    collapseProactiveEpisodes(): void;
    /**
     * Points the open conversation at `target`, acquiring one when none is
     * open. `courseHint` travels with the target because a cold start has no
     * course of its own; see `ChatWebviewProvider.askIrisAbout`.
     */
    askIrisAbout(target: ServerContext, courseHint?: number): Promise<TopicChangeOutcome>;
    /**
     * Cancels the automatic cold start: the student has explicitly navigated
     * somewhere, so a late background detection must not pull them back out.
     * See `ChatStartupCoordinator.admitExplicitIntent`.
     */
    admitExplicitIntent(reason: string): void;
}
