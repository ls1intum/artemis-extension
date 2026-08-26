import type { ExtMsg } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { useChatStore } from '@webview/stores/useChatStore';

import type { ChatMessage } from './types';

/**
 * One wire row as the transcript stores it. Every row gets a fresh localId:
 * the server does not issue one, and the list is keyed on it.
 *
 * `offer` is client-local and only ever rides an `addMessage`, so the parameter
 * widens rather than the load/merge contracts.
 *
 * The four proactive fields are spread CONDITIONALLY, and that is load-bearing.
 * The three arms this serves carry different field sets - `addMessage` all four,
 * `loadMessages` three, `mergeSessionMessages` none - and `mergeHistory` merges
 * as `{ ...prev, ...inc }`. A spread copies own properties INCLUDING ones set to
 * `undefined`, so mapping them unconditionally would blank a live proactive
 * bubble's episode identity on every reconnect merge. Omitting the key instead
 * lets the previous value stand, which is exactly what the merge arm not mapping
 * them used to do.
 */
export type WireRow = ExtMsg<'loadMessages'>['messages'][number] & { offer?: ChatMessage['offer'] };

export function toChatMessage(m: WireRow): ChatMessage {
    return {
        id: m.id,
        localId: crypto.randomUUID(),
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        helpful: m.helpful ?? null,
        ...(m.origin !== undefined ? { origin: m.origin } : {}),
        ...(m.proactiveOutcome !== undefined ? { proactiveOutcome: m.proactiveOutcome } : {}),
        ...(m.proactiveEpisodeId !== undefined ? { proactiveEpisodeId: m.proactiveEpisodeId } : {}),
        ...(m.offer !== undefined ? { offer: m.offer } : {}),
        activities: m.activities,
        final: m.final,
        status: 'sent',
    };
}

interface InboundOptions {
    /**
     * A snapshot arrived that answers an outstanding `refreshCourses`. Keyed on
     * the request being ANSWERED rather than on the list being non-empty: a
     * student whose dashboard genuinely has no courses must reach "No courses
     * found", not a permanent skeleton. The cold start posts snapshots of its
     * own while a forced fetch is open, and one of those ending the wait would
     * report an empty list the host has not asked about yet.
     */
    onCourseRefreshAnswered: () => void;
}

/**
 * The chat's entire inbound protocol: every message the host can send, and
 * what it does to the store.
 *
 * Kept out of the view because none of it is rendering. What it does need is
 * one rule applied consistently, `belongsHere`: a message addressed to a
 * conversation the student has since left must not touch the transcript they
 * are reading. Gathering the cases here is what makes the exceptions to that
 * rule (`UpdateIrisRunUi`, the banners) visible as exceptions.
 */
export function useIrisInboundMessages({ onCourseRefreshAnswered }: InboundOptions): void {
    useExtensionMessage((msg) => {
        // Everything below reads the store through `getState()` rather than a
        // subscription: messages arrive BETWEEN renders, so a render-time
        // closure would act on the conversation that was open when the
        // listener was registered. It also keeps this hook from adding a
        // second whole-store subscription to a component that already has one.
        const {
            setIrisState, setShowDiagnostics, applyLoadedMessages,
            setReferencedFiles, setWebSocketStatus,
            setDisabledMessage, setUnavailableMessage, setNoAiDetected,
            resetTransientChatUi, applyRunUi, applyCommit, markMessageFailed,
            removeMessageById, foldEpisode, setLiveEpisode, resolveOffer, foldAllEpisodes,
            setOpenSessionError, mergeLoadedMessages, confirmSentMessage, showNotice,
        } = useChatStore.getState();
        const belongsHere = (m: { sessionId: number }): boolean =>
            m.sessionId === useChatStore.getState().currentSessionId;
        switch (msg.type) {
            case ExtensionMsg.UpdateIrisState: {
                setIrisState(msg.state);
                if (msg.answersCourseRefresh) {
                    onCourseRefreshAnswered();
                }
                if (msg.showDiagnostics !== undefined) {
                    setShowDiagnostics(msg.showDiagnostics);
                }
                break;
            }

            case ExtensionMsg.AddMessage: {
                // The projection owns the transient run UI: applyCommit clears
                // the draft/waiting atomically with the committed message when
                // a runUi is attached, and leaves them untouched for an
                // intermediate (final:false) message so the waiting flag
                // survives until the run truly ends.
                if (!belongsHere(msg)) { break; }
                applyCommit(toChatMessage(msg.message), msg.runUi, msg.sessionId);
                break;
            }

            case ExtensionMsg.UpdateIrisRunUi: {
                applyRunUi(msg.projection);
                break;
            }

            case ExtensionMsg.LoadMessages: {
                // Discard any load for a conversation that is no longer open:
                // the student navigated while it was in flight, and the
                // transcript they are reading must not be replaced.
                if (!belongsHere(msg)) { break; }
                resetTransientChatUi();
                applyLoadedMessages(msg.sessionId, msg.messages.map(toChatMessage));
                break;
            }

            case ExtensionMsg.MergeSessionMessages: {
                if (!belongsHere(msg)) { break; }
                // Deliberately NO resetTransientChatUi(): a merge must not wipe
                // a live draft. It only folds the persisted history into the
                // list by id.
                mergeLoadedMessages(msg.sessionId, msg.messages.map(toChatMessage));
                break;
            }

            case ExtensionMsg.UpdateReferencedFiles: {
                setReferencedFiles({
                    includedFiles: msg.includedFiles,
                    excludedFiles: msg.excludedFiles,
                    totalCount: msg.totalCount,
                });
                break;
            }

            case ExtensionMsg.UpdateWebSocketStatus: {
                setWebSocketStatus(msg.status);
                if (msg.status !== 'connected') {
                    resetTransientChatUi();
                }
                break;
            }

            case ExtensionMsg.ShowDisabledState: {
                setDisabledMessage(msg.message);
                break;
            }

            case ExtensionMsg.HideDisabledState:
                setDisabledMessage(null);
                break;

            case ExtensionMsg.ShowUnavailableState: {
                setUnavailableMessage(msg.message);
                break;
            }

            case ExtensionMsg.HideUnavailableState:
                setUnavailableMessage(null);
                break;

            case ExtensionMsg.OpenSessionError: {
                // A pre-switch open failure (overview fetch failed or the id
                // was gone). Nothing was mutated and the active session is
                // untouched, so it cannot key to a localSessionId. Nothing
                // else about chat availability changed, so this renders as an
                // inline banner inside the history popover rather than the
                // global unavailable banner.
                setOpenSessionError(msg.message);
                break;
            }

            case ExtensionMsg.UpdateNoAiStatus: {
                setNoAiDetected(msg.isNoAiDetected);
                break;
            }

            case ExtensionMsg.SendRejected: {
                // Ignore stale rejections that arrive after the user already
                // switched session. The optimistic message does not exist in
                // the active session anyway, and clearing transient UI for an
                // unrelated session is wrong.
                if (!belongsHere(msg)) { break; }
                const matched = markMessageFailed(msg.localId, msg.errorMessage, msg.reason);
                // A non-match means the rejection is stale (retry already
                // removed the failed entry, or messages were re-hydrated from
                // the server), so the current request's transient UI stands.
                if (matched) {
                    resetTransientChatUi();
                }
                break;
            }

            case ExtensionMsg.ShowChatNotice: {
                // Raised by the host AFTER the navigation's snapshot, so the
                // notice describes the conversation the student is now looking
                // at. `tone` travels with it: a refused topic change and a
                // failed new conversation have no other surface, so dropping it
                // renders a failure as a muted grey aside.
                showNotice({ text: msg.text, tone: msg.tone });
                break;
            }

            // The proactive control frames. None is session-scoped: they address a
            // row or an episode by id, and the host only ever sends them for the
            // transcript on screen.
            case ExtensionMsg.RemoveMessage:
                removeMessageById(msg.id);
                break;

            case ExtensionMsg.ResolveOffer:
                resolveOffer(msg.offerId, msg.answered);
                break;

            case ExtensionMsg.FoldEpisode:
                foldEpisode(msg.episodeId, msg.outcome, msg.praise);
                break;

            case ExtensionMsg.SetLiveEpisode:
                setLiveEpisode(msg.episodeId);
                break;

            case ExtensionMsg.CollapseProactiveEpisodes:
                foldAllEpisodes();
                break;

            case ExtensionMsg.ConfirmSentMessage: {
                if (!belongsHere(msg)) { break; }
                confirmSentMessage(msg.localId, msg.id);
                break;
            }
        }
        // The store actions are read live, so the listener never needs
        // re-registering for them. `onCourseRefreshAnswered` is memoised by
        // `useCourseList`; an unstable callback here would tear the listener
        // down and rebuild it on every render.
    }, [onCourseRefreshAnswered]);
}
