import { useEffect, useRef } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { postCommand } from '@shared/messageContracts';

import type { ChatState } from '@webview/stores/useChatStore';
import { selectSendBlockedReason, useChatStore } from '@webview/stores/useChatStore';

import type { ChatMessage } from './types';

/**
 * Everything between the student pressing Enter and the bubble reaching a
 * terminal state: the send funnel, the retry that a failed bubble offers, and
 * the one retry that has to wait for the chat to become reachable first.
 *
 * They are one story. `handleRetry` is a `handleSendMessage` with a removal in
 * front of it, `isRetryDisabled` is the affordance for the same gate the
 * funnel enforces, and the deferred resend exists because one retry reason
 * ("Iris is unreachable") cannot be answered by sending again immediately.
 */
/**
 * `store` is the view's own subscription, passed down rather than re-subscribed
 * here: a second whole-store subscription in the same component costs an extra
 * update notification per store write for no added reactivity.
 */
export function useChatSend(vscodeApi: VsCodeApi, store: ChatState) {
    // Answers "would the host take a send right now", and carries the sentence
    // that explains a no.
    const sendBlockedReason = selectSendBlockedReason(store);
    const sendBlocked = sendBlockedReason !== undefined;

    /**
     * The single send funnel. Returns whether the send was ACCEPTED, i.e.
     * whether the command actually went to the host. Callers that own the
     * student's text (the composer) must keep it on `false`; a refusal here
     * produces no bubble, so nothing else would be holding it.
     */
    const handleSendMessage = (text: string): boolean => {
        const localId = crypto.randomUUID();
        // The conversation the bubble is drawn in travels WITH the send, so the
        // host can refuse it if a navigation completed in between rather than
        // posting the student's text into whatever is open by then.
        const sessionId = store.currentSessionId;
        if (sessionId === null) {
            // Nothing to address a rejection to. The composer is already
            // disabled in this state, so this is a defensive guard against a
            // programmer error.
            return false;
        }

        // Read LIVE rather than through the render-time closure: this funnel is
        // reached from event handlers and from an effect, either of which can
        // run a tick behind the render that produced them. This is the
        // guarantee; the disabled button and the inert Retry are affordances.
        if (selectSendBlockedReason(useChatStore.getState()) !== undefined) { return false; }

        store.resetTransientChatUi();

        store.addMessage({
            localId,
            role: 'user',
            content: text,
            timestamp: Date.now(),
            status: 'sending',
        });

        // Start streaming state. The thinking indicator stays on until one
        // of three terminal signals clears it via resetTransientChatUi:
        //   - assistant AddMessage arrives (happy path)
        //   - SendRejected with matching localId (synchronous rejection)
        //   - websocket disconnect (terminal connection state)
        store.startStreaming();

        // Send to extension. `sessionId` lets the host echo it back on
        // rejection so the webview can ignore stale responses after a
        // navigation.
        postCommand(vscodeApi, 'sendMessage', { text, localId, sessionId });
        return true;
    };

    const handleRetryChatLoad = () => {
        postCommand(vscodeApi, 'reloadChatSession');
    };

    const handleRetry = (localId: string) => {
        const failed = useChatStore.getState().messages.find((m) => m.localId === localId);
        if (!failed || failed.role !== 'user' || failed.status !== 'error') {
            return;
        }
        // Unreachable Iris: resending would only fail the same way, and a
        // reload is the ONLY thing that re-runs the availability check. So this
        // one button does both, in order. The text is remembered rather than
        // sent, and the effect below sends it once the banner clears.
        if (useChatStore.getState().unavailableMessage !== null) {
            resendWhenReachable.current = {
                localId,
                text: failed.content,
                sessionId: useChatStore.getState().currentSessionId,
            };
            handleRetryChatLoad();
            return;
        }
        // BEFORE the removal, never after: the funnel would refuse the send and
        // the bubble would already be gone, taking the student's text with it.
        // `isRetryDisabled` only narrows the window; a click can still land
        // between the host taking the lock and React committing the render that
        // disables the button. This guard closes that window.
        if (selectSendBlockedReason(useChatStore.getState()) !== undefined) { return; }
        // Remove the failed entry first so handleSendMessage's optimistic add
        // doesn't briefly produce two copies. Zustand+React batch the two state
        // updates in the same event tick, so there is no visible flicker.
        store.removeMessage(localId);
        handleSendMessage(failed.content);
    };

    /**
     * The message a Retry deferred until the chat is reachable again. Held in a
     * ref, not in state: it must not trigger a render of its own.
     *
     * It carries the TEXT and the conversation, not just the localId. A
     * successful reload delivers the server transcript before it clears the
     * banner, and that transcript replaces the message array, taking the unsent
     * local bubble with it, so there is nothing left to look up.
     */
    const resendWhenReachable = useRef<{ localId: string; text: string; sessionId: number | null } | null>(null);
    useEffect(() => {
        if (store.unavailableMessage !== null) { return; }
        const pending = resendWhenReachable.current;
        if (pending === null) { return; }
        // The banner can clear while the host still holds its lock: the
        // provider's availability refresh runs ahead of the reload that was
        // deferred until the send settles. Keep the pending resend AND its
        // bubble.
        //
        // Read LIVE rather than through the render-time closure `sendBlocked`:
        // a host snapshot can land between this render committing and this
        // effect's callback running, and the closure would still see the stale,
        // unlocked value. `sendBlocked` is therefore not read below, but it is
        // NOT dead: it stays in the dependency array as the trigger that re-runs
        // this effect once the live gate releases. Do not drop it from the deps.
        if (selectSendBlockedReason(useChatStore.getState()) !== undefined) { return; }
        resendWhenReachable.current = null;
        // The banner also clears on a NAVIGATION. Cancel when the move is
        // already visible here. The host hides the banner BEFORE it publishes
        // the new snapshot, so this can still run while the webview reports the
        // old conversation; the send then addresses that same conversation, and
        // the host refuses it by origin (`conversation-changed`).
        if (store.currentSessionId !== pending.sessionId) { return; }
        // The bubble may or may not have survived the reload; drop it if it did,
        // so the resend does not leave a duplicate behind.
        store.removeMessage(pending.localId);
        handleSendMessage(pending.text);
        // Keyed on the banner and the send gate. `handleSendMessage` is
        // recreated every render, so listing it would re-run this on every
        // render instead of on the transitions that matter.
    }, [store.unavailableMessage, sendBlocked]);

    // Last resort for an echo the POST never settled. Deliberately above BOTH
    // request timeouts that can run before a send settles: the POST (30s,
    // CONFIG.API.REQUEST_TIMEOUT_MS) and, when that times out, the
    // coordinator's reconciliation GET on the same budget. A shorter deadline
    // would race a send that is still legitimately being resolved and put back
    // the very duplicate this removes.
    useEffect(() => {
        const held = store.pendingEcho;
        if (!held) { return; }
        const timer = setTimeout(() => {
            // Only the hold this timer was armed for. A settled hold replaced
            // by a newer one before React ran the cleanup would otherwise be
            // flushed by the old timer.
            if (useChatStore.getState().pendingEcho === held) {
                useChatStore.getState().flushPendingEcho();
            }
        }, 65_000);
        return () => clearTimeout(timer);
    }, [store.pendingEcho]);

    /**
     * Retry is meaningful only when the underlying cause has plausibly cleared
     * since the original send. Computed per render because the message list is
     * short and `messages.map` already walks it.
     */
    const isRetryDisabled = (msg: { errorReason?: ChatMessage['errorReason'] }): boolean => {
        // A retry IS a send. While the host would refuse one, this is an inert
        // control rather than an affordance whose only outcome is a rejection
        // that also wipes the running request's indicator.
        if (sendBlocked) { return true; }
        switch (msg.errorReason) {
            case 'iris-disabled':
                // Persistent until the user navigates away from the
                // disabled exercise; the banner already states this.
                return true;
            case 'iris-unavailable':
                // Never disabled for its own reason (the gate above still
                // applies). This button IS the reload while the banner is up:
                // it reloads first and sends afterwards (see `handleRetry`).
                return false;
            case 'no-ai':
                return store.isNoAiDetected;
            case 'no-context':
                return store.currentSessionId === null;
            default:
                return false;
        }
    };

    return {
        sendBlocked,
        sendBlockedReason,
        handleSendMessage,
        handleRetry,
        handleRetryChatLoad,
        isRetryDisabled,
    };
}
