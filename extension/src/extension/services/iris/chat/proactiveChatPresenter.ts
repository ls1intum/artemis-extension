import type * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { LogCategory, logger } from '@extension/services/loggingService';

/** What the proactive surface needs from the chat provider. */
export interface ProactiveChatDeps {
    /** The provider's guarded post. Never the raw webview: a disposed view must not throw into the engine. */
    postMessage: (message: ExtensionToWebviewMessage) => void;
    /** A getter, not a value: the conversation is created after the provider and replaced on session change. */
    getConversation: () => IrisConversationService | undefined;
    /** The view itself, for the activity-bar badge. Undefined until the webview resolves. */
    getView: () => vscode.WebviewView | undefined;
    /** Reveal the chat view. Wrapped so this module needs no vscode command surface of its own. */
    focusChat: () => Thenable<unknown>;
    /** Only for the legacy message-keyed outcome write; the episode-keyed path goes through the engine. */
    artemisApi: ArtemisApiService | undefined;
}

/**
 * Everything the proactive struggle feature draws in the chat, and the reveal
 * navigation that belongs to it.
 *
 * Split out of `ChatWebviewProvider` because it is a self-contained feature
 * surface: bubbles, offers, folds, the live-episode frame and the activity-bar
 * badge, none of which the ordinary chat knows about. The provider kept growing
 * a second class inside itself.
 *
 * Almost every consumer already reached these through closures in
 * `extension.ts`, so they repoint at the presenter; the two on
 * `IChatWebviewProvider` stay as one-line delegates on the provider because they
 * are interface obligations.
 *
 * The reveal navigation lives here rather than with the ordinary chat
 * navigation: it is proactive-only, it is the sole owner of focus on the reveal
 * path, and `revealProactiveSessionForExercise` calls `openProactiveSession`
 * directly.
 */
export class ProactiveChatPresenter {
    /** C8: episode-scoped dismiss callback (seam to the orchestrator's dismissEpisode), wired by extension.ts. */
    private _onEpisodeDismiss?: (episodeId?: string) => void;

    /** "Solved it" positive-close callback (seam to the orchestrator's resolveEpisode), wired by extension.ts. */
    private _onEpisodeResolve?: (episodeId?: string) => void;

    /** Last live-episode snapshot posted (SetLiveEpisode); replayed to re-created webviews on init. */
    private _liveEpisodeId: string | null = null;

    /** Whether a student-initiated help_request is in flight; replayed to a freshly-ready webview. */
    private _thinking = false;

    constructor(private readonly _deps: ProactiveChatDeps) { }


    /** Show/clear a badge on the Iris view to flag a proactive suggestion (spec §8 active/ambient surface). */
    setProactiveBadge(on: boolean): void {
        const view = this._deps.getView();
        if (view) {
            view.badge = on ? { value: 1, tooltip: 'Iris has a suggestion for you' } : undefined;
        }
    }



    /**
     * Post an optimistic proactive bubble to the chat immediately (before the server-persisted
     * message arrives via the chat WebSocket). When `messageId` is set, the webview can
     * deduplicate against a later `loadMessages` response that contains the same id (one bubble).
     * When `messageId` is null (server persist failed, A9), the bubble is runtime-only and has
     * no dedup tag. When `episodeId` is set, the row is threaded into its episode group so a
     * live delivery renders as the open episode timeline (and registers the episode as live);
     * the ambient reveal path passes none on purpose (a PARKED episode is not live in the chat).
     * The badge-clears-on-chat-open behaviour (onDidChangeVisibility) is unaffected.
     */
    postOptimisticBubble(text: string, messageId: number | null, episodeId?: string): void {
        // Attribute the bubble to the active session. In the active-surface flow
        // the session open runs right AFTER this, so a session may not be active
        // yet: a persisted bubble (messageId set) then arrives via that open's
        // message load, and a runtime-only bubble is transient (the same net
        // effect as before, where the following session switch cleared it).
        // Without an active session the webview would drop an unattributed row.
        const sessionId = this._deps.getConversation()?.state.snapshot().currentSessionId;
        if (sessionId === undefined) {
            logger.warn('postOptimisticBubble: no open conversation to attribute the proactive bubble to; dropping', LogCategory.IRIS_CHAT);
            return;
        }
        this._deps.postMessage({
            type: ExtensionMsg.AddMessage,
            sessionId,
            message: {
                ...(messageId !== null ? { id: messageId } : {}),
                role: 'assistant',
                content: text,
                timestamp: Date.now(),
                origin: 'proactive',
                ...(episodeId !== undefined ? { proactiveEpisodeId: episodeId } : {}),
            }
        });
    }

    /**
     * Post an offer bubble (spec B+): an assistant row carrying a client-local `offer` marker
     * (no content) that the webview renders with answer buttons. `episodeId` threads the row
     * into its episode group, mirroring `postOptimisticBubble`.
     */
    postOfferBubble(o: { offerId: string; episodeId: string; moment: 'stuck' | 'abandon' }): void {
        const sessionId = this._deps.getConversation()?.state.snapshot().currentSessionId;
        if (sessionId === undefined) {
            logger.warn('postOfferBubble: no open conversation to attribute the offer bubble to; dropping', LogCategory.IRIS_CHAT);
            return;
        }
        this._deps.postMessage({
            type: ExtensionMsg.AddMessage,
            sessionId,
            message: {
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                origin: 'proactive',
                proactiveEpisodeId: o.episodeId,
                offer: { offerId: o.offerId, moment: o.moment },
            }
        });
    }

    /**
     * "Iris is preparing the hint you asked for", mirrored into the chat while a student-initiated
     * `help_request` is in flight. The flag is kept here as well as posted, because the first-ever
     * chat open resolves the view AFTER the accept and `_resetReadyState()` drops the queued
     * message; `ChatWebviewProvider._onReady` replays it through {@link replayThinking}.
     */
    setThinking(on: boolean): void {
        this._thinking = on;
        this._deps.postMessage({ type: ExtensionMsg.SetProactiveThinking, thinking: on });
    }

    /** Re-post a still-true thinking flag to a freshly-ready webview. No-op when nothing is pending. */
    replayThinking(): void {
        if (!this._thinking) { return; }
        this._deps.postMessage({ type: ExtensionMsg.SetProactiveThinking, thinking: true });
    }

    /**
     * Resolve an offer bubble (spec B+): posts a host->webview `resolveOffer` so the webview
     * finds the bubble by `offerId` and sets its `offer.answered` (condensed line rendered in C10).
     */
    resolveOfferBubble(offerId: string, answered: 'accept' | 'decline' | 'timeout'): void {
        this._deps.postMessage({ type: ExtensionMsg.ResolveOffer, offerId, answered });
    }

    /**
     * Collapse every proactive episode in the transcript to a fold line. Sent when the student
     * switches proactive help to Off (spec §12.2): the hints stay in history but get out of the way.
     */
    collapseProactiveEpisodes(): void {
        this._deps.postMessage({ type: ExtensionMsg.CollapseProactiveEpisodes });
    }

    /**
     * Post the host-authoritative live-episode snapshot (SetLiveEpisode state frame) and cache
     * it, so `resendLiveEpisode` can replay it to a freshly created webview. Sent by the
     * struggle engine on every slot transition: the DELIVERED episode's id, or null when no
     * episode is live.
     */
    postLiveEpisode(episodeId: string | null): void {
        this._liveEpisodeId = episodeId;
        this._deps.postMessage({ type: ExtensionMsg.SetLiveEpisode, episodeId });
    }

    /**
     * Re-post the cached live-episode frame. Called on webview init (`_sendInitData`): a
     * re-created webview starts with an empty live set and would otherwise fold the still-live
     * episode as an "Earlier hint" after hydration. An explicit null is sent too, so a stale
     * live set from a previous session cannot survive.
     */
    resendLiveEpisode(): void {
        this._deps.postMessage({ type: ExtensionMsg.SetLiveEpisode, episodeId: this._liveEpisodeId });
    }

    /**
     * Post a host->webview removeMessage{id} for stale-row suppression (C4).
     * The webview removes the row if present AND records the id in suppressedIds
     * so a chat-ws arrival of the same row after the drop is never inserted.
     */
    postRemoveMessage(id: number): void {
        this._deps.postMessage({ type: ExtensionMsg.RemoveMessage, id });
    }

    /**
     * C7: Post a host->webview foldEpisode control frame so the webview collapses
     * the episode group to a summary fold-line. Without praise: folds immediately.
     * With praise: waits for the close row identified by `closeMessageId` to
     * arrive, then starts a ~5 s timer before collapsing.
     */
    postFoldEpisode(
        episodeId: string,
        outcome: 'RECOVERED' | 'DISMISSED' | 'ABANDONED',
        praise?: { episodeLabel: string; closeMessageId: number },
    ): void {
        this._deps.postMessage({ type: ExtensionMsg.FoldEpisode, episodeId, outcome, praise });
    }

    /**
     * C8: Wire the struggle-engine callbacks into the provider.
     * Called by extension.ts after the engine handle is available.
     */
    setStruggleCallbacks(callbacks: {
        /** C8: episode-scoped dismiss; routes to orchestrator.dismissEpisode. */
        onEpisodeDismiss?: (episodeId?: string) => void;
        /** "Solved it" positive close; routes to orchestrator.resolveEpisode. */
        onEpisodeResolve?: (episodeId?: string) => void;
    }): void {
        this._onEpisodeDismiss = callbacks.onEpisodeDismiss;
        this._onEpisodeResolve = callbacks.onEpisodeResolve;
    }

    /**
     * Open/attach the Iris session carrying a proactive bubble (spec §5.5 `active`). The session is freshly
     * created server-side with a single LLM bubble and no USER reply. The sessions/overview now lists such
     * proactive-only sessions (spec §7.3), but a plain reload is async and may not have run yet, so for an
     * immediate active open we still inject a local entry directly. Delegated to the session service, which adds
     * a local entry keyed `session-<artemisSessionId>` (unless present), switches to it, and lets the existing
     * message-load surface the bubble.
     */
    async openProactiveSession(courseId: number, sessionId: number): Promise<void> {
        // navigateTo does the probe, the guarded install, the subscription intent,
        // the overview/invisible-cache update and the transcript delivery. Course
        // AND session, because the new API scopes session lookup by course and
        // nothing here establishes that a proactive session id is globally unique.
        await this._deps.getConversation()?.navigateTo({ courseId, sessionId });
    }

    /**
     * The provider's navigation generation, mirroring {@link IrisChatSessionService.contextLoadToken}
     * (#364 spec A). A caller that captured a token before an async gap (e.g. before persisting a
     * reveal server-side) can re-check it against this value to detect "the student navigated away
     * in the meantime" and abort rather than clobber whatever the student is now looking at.
     */
    currentNavToken(): number {
        return this._deps.getConversation()?.navigationRequestToken ?? 0;
    }

    /**
     * Reveal a proactive session inside its owning exercise context, behaving as if the student had
     * manually switched there (#364 spec A). The single owner of focus for the reveal path: neither
     * the inline-hover "Open chat" handler nor the parked-lamp click focuses the chat directly
     * anymore (#364 Task 2) -- this method is the only place that does, and only once navigation has
     * actually been initiated.
     *
     * `title` is passed in by the caller (threaded from the service's synchronous exercise lookup)
     * rather than re-resolved here, so this method has no opinion on how the exercise was resolved.
     *
     * Ordering, all per spec A:
     *  1. Stale-navigation guard: if `expectedNavToken` no longer matches {@link currentNavToken},
     *     the student navigated elsewhere while this reveal was in flight -- return `false`
     *     immediately without switching context, opening the session, or focusing.
     *  2. Same-context guard: only `switchContext` when NOT already on the target exercise, so an
     *     already-correct context is left untouched (no disruptive jump).
     *  3. `openProactiveSession` is deliberately NOT awaited before focusing: it selects the session
     *     synchronously before its own first await, which is all downstream refreshes need to
     *     preserve it (spec A0); waiting for its full message load here would delay focusing a
     *     collapsed/hidden chat behind a slow network round trip.
     *  4. Focus last, so a collapsed or never-mounted chat view opens promptly.
     */
    async revealProactiveSessionForExercise(
        courseId: number,
        _exerciseId: number,
        sessionId: number,
        _title: string,
        expectedNavToken: number,
    ): Promise<boolean> {
        // Stale guard BEFORE any navigation, catalog write or focus.
        if (expectedNavToken !== this.currentNavToken()) {
            return false;
        }

        // No context staging and no local switch: the server detail the navigation
        // loads already carries the conversation's authoritative context. `exerciseId`
        // and `title` no longer take part in selecting the conversation.
        // Not awaited: focus must not queue behind the message load.
        void this.openProactiveSession(courseId, sessionId).catch((error: unknown) => {
            logger.warn('revealProactiveSessionForExercise: opening the proactive conversation failed', LogCategory.IRIS_CHAT, error);
        });
        await this._deps.focusChat();
        return true;
    }

    handleProactiveOutcome(
        sessionId: number,
        messageId: number,
        proactiveEpisodeId: string | undefined,
        outcome: 'DISMISSED' | 'RECOVERED',
    ): void {
        if (proactiveEpisodeId) {
            // C8 episode-scoped path: route to the orchestrator via the seam callback. The orchestrator
            // frees the slot, tears down runtime, writes the outcome, and folds. RECOVERED = "Solved it".
            if (outcome === 'RECOVERED') { this._onEpisodeResolve?.(proactiveEpisodeId); }
            else { this._onEpisodeDismiss?.(proactiveEpisodeId); }
            return;
        }

        // Legacy fallback: message-scoped write for rows that pre-date the episode model
        // (no proactiveEpisodeId attached to the persisted row).
        if (!this._deps.artemisApi) {
            logger.warn('Artemis API service not available for proactive outcome', LogCategory.IRIS_CHAT);
            return;
        }
        void this._deps.artemisApi.setProactiveOutcome(sessionId, messageId, outcome).catch(error => {
            logger.error('Failed to persist proactive outcome', LogCategory.IRIS_CHAT, error);
        });
    }
}
