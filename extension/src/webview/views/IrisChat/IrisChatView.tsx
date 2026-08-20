import Info from 'lucide-react/dist/esm/icons/info';
import Menu from 'lucide-react/dist/esm/icons/menu';
import Plus from 'lucide-react/dist/esm/icons/plus';
import { useEffect, useRef, useState } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { selectCanChangeTopic, selectSendBlockedReason, useChatStore } from '@webview/stores/useChatStore';

import { ChatHeader } from './components/ChatHeader';
import { ChatInput } from './components/ChatInput';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatNotice } from './components/ChatNotice';
import { ContextChip } from './components/ContextChip';
import { ContextPicker } from './components/ContextPicker';
import { ConversationHistory } from './components/ConversationHistory';
import { CoursePicker } from './components/CoursePicker';
import { ReferencedFiles } from './components/ReferencedFiles';
import styles from './IrisChatView.module.css';
import type { ChatMessage } from './types';

interface IrisChatViewProps {
    vscodeApi: VsCodeApi;
}

export function IrisChatView({ vscodeApi }: IrisChatViewProps) {
    const store = useChatStore();
    // Answers "would the host take a send right now", and carries the sentence
    // that explains a no. Must stay ahead of every effect that reads it: the
    // deferred-resend effect lists `sendBlocked` in its dependency array, which
    // is evaluated during render, so a `const` declared below it would be in
    // its temporal dead zone.
    const sendBlockedReason = selectSendBlockedReason(store);
    const sendBlocked = sendBlockedReason !== undefined;
    const {
        setIrisState, setShowDiagnostics, addMessage,
        applyLoadedMessages,
        setReferencedFiles, setWebSocketStatus,
        setDisabledMessage, setUnavailableMessage, setNoAiDetected,
        resetTransientChatUi, applyRunUi, applyCommit,
        markMessageFailed,
        setOpenSessionError, mergeLoadedMessages, confirmSentMessage,
        showNotice,
    } = store;
    const [sideMenuOpen, setSideMenuOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [coursePickerOpen, setCoursePickerOpen] = useState(false);
    /**
     * The student asked to see the course list anyway, from the startup-outage
     * screen. Detection can fail identically on every retry (e.g. an
     * archived-courses lookup that keeps throwing), so Retry cannot be the ONLY
     * way off that screen. No reset needed: once a course is picked, `courseId`
     * stops being null and `detectionUnavailable` goes false on its own.
     */
    const [outageChooserRequested, setOutageChooserRequested] = useState(false);
    // True while the host is reading the dashboard course list. A fresh
    // installation tracks nothing, so an empty list is only meaningful once
    // that fetch has finished; without this the picker says "No courses
    // found" the instant it opens.
    const [coursesLoading, setCoursesLoading] = useState(false);
    /** Whether a `refreshCourses` is outstanding. See the snapshot handler. */
    const coursesRequested = useRef(false);
    const sideMenuRef = useRef<HTMLDivElement>(null);
    // Element that opened the currently-visible popover, captured so focus can
    // be restored to it on close. One shared ref because a click-outside close
    // must return focus to whichever opener was actually clicked.
    const openerRef = useRef<HTMLElement | null>(null);
    useClickOutside(sideMenuRef, sideMenuOpen, () => setSideMenuOpen(false));

    // A navigation-initiating popover stays open until the navigation lands, so
    // a failure has somewhere to be read (see `openSessionError` below). The
    // success signal is the conversation differing from the one CAPTURED at
    // open time: `currentSessionId` is legitimately `null` whenever nothing is
    // open, so `null` cannot double as "no popover is open". `undefined` can, it
    // is not part of the field's type.
    const sessionWhenPopoverOpened = useRef<number | null | undefined>(undefined);
    // The course is captured alongside it, because a course move does not
    // always change the conversation id: entering a course whose Iris is
    // switched off leaves it null, and it may have been null before. Without
    // this the picker stays parked on top of the banner that explains where the
    // student now is.
    const courseWhenPopoverOpened = useRef<number | null | undefined>(undefined);
    useEffect(() => {
        if (sessionWhenPopoverOpened.current === undefined) { return; }
        if (store.currentSessionId !== sessionWhenPopoverOpened.current
            || store.courseId !== courseWhenPopoverOpened.current) {
            // Also clears `openSessionError`, so a failure the student has
            // since navigated past cannot sit on top of the conversation that
            // did load.
            closePopovers();
        }
    }, [store.currentSessionId, store.courseId]);

    // Run lock: navigation cannot abandon an in-flight run. The moment
    // streaming starts, close/neutralize any popover or side menu that was
    // already open. Without this, a late click inside one (still mounted
    // from before the run began) could post a context/session-changing
    // command. ChatHeader's disableNavigation covers the still-closed case
    // (its own buttons refuse to open a new popover while streaming).
    useEffect(() => {
        if (store.streaming.isStreaming) {
            setSideMenuOpen(false);
            closePopovers();
        }
    }, [store.streaming.isStreaming]);

    // Last resort. Deliberately above BOTH request timeouts that can run before
    // a send settles: the POST (30s, CONFIG.API.REQUEST_TIMEOUT_MS) and, when
    // that times out, the coordinator's reconciliation GET on the same budget.
    // A shorter deadline would race a send that is still legitimately being
    // resolved and put back the very duplicate this removes.
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

    useExtensionMessage((msg) => {
        // Reads the store directly, not the render-time closure: messages
        // arrive between renders and the conversation must be the CURRENT one.
        const belongsHere = (m: { sessionId: number }): boolean =>
            m.sessionId === useChatStore.getState().currentSessionId;
        switch (msg.type) {
            case ExtensionMsg.UpdateIrisState: {
                setIrisState(msg.state);
                // Keyed on the request being ANSWERED rather than on the list
                // being non-empty: a student whose dashboard genuinely has no
                // courses must reach "No courses found", not a permanent
                // skeleton. `answersCourseRefresh` is what makes it THIS
                // request's answer: cold start posts snapshots of its own
                // while the forced fetch is open, and one of those ending the
                // wait reports an empty list the host has not asked about yet.
                if (coursesRequested.current && msg.answersCourseRefresh) {
                    coursesRequested.current = false;
                    setCoursesLoading(false);
                }
                if (msg.showDiagnostics !== undefined) {
                    setShowDiagnostics(msg.showDiagnostics);
                }
                break;
            }

            case ExtensionMsg.AddMessage: {
                const m = msg.message;
                const mapped: ChatMessage = {
                    id: m.id,
                    localId: crypto.randomUUID(),
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp,
                    helpful: m.helpful ?? null,
                    activities: m.activities,
                    final: m.final,
                    status: 'sent',
                };
                // The projection owns the transient run UI: applyCommit
                // clears the draft/waiting atomically with the committed
                // message when a runUi is attached, and leaves them untouched
                // for an intermediate (final:false) message so the waiting flag
                // survives until the run truly ends.
                if (!belongsHere(msg)) { break; }
                applyCommit(mapped, msg.runUi, msg.sessionId);
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
                if (!belongsHere(msg)) {
                    break;
                }
                resetTransientChatUi();
                applyLoadedMessages(
                    msg.sessionId,
                    msg.messages.map((m) => ({
                        id: m.id,
                        localId: crypto.randomUUID(),
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp,
                        helpful: m.helpful ?? null,
                        activities: m.activities,
                        final: m.final,
                        status: 'sent' as const,
                    })),
                );
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

            case ExtensionMsg.OpenSessionError: {
                // A pre-switch open failure (overview fetch failed or the id
                // was gone). Nothing was mutated and the active session is
                // untouched, so it cannot key to a localSessionId. Nothing
                // else about chat availability changed, so this renders as
                // an inline banner inside the history popover rather than
                // the global unavailable banner.
                setOpenSessionError(msg.message);
                break;
            }

            case ExtensionMsg.HideUnavailableState:
                setUnavailableMessage(null);
                break;

            case ExtensionMsg.UpdateNoAiStatus: {
                setNoAiDetected(msg.isNoAiDetected);
                break;
            }

            case ExtensionMsg.SendRejected: {
                // Ignore stale rejections that arrive after the user already
                // switched session. The optimistic message does not exist in
                // the active session anyway, and clearing transient UI for an
                // unrelated session is wrong.
                if (!belongsHere(msg)) {
                    break;
                }
                const matched = markMessageFailed(msg.localId, msg.errorMessage, msg.reason);
                // A non-match means the rejection is stale (retry already
                // removed the failed entry, or messages were re-hydrated from
                // the server), so the current request's transient UI stands.
                if (matched) {
                    resetTransientChatUi();
                }
                break;
            }

            case ExtensionMsg.MergeSessionMessages: {
                if (!belongsHere(msg)) { break; }
                // Deliberately NO resetTransientChatUi(): a merge must not wipe a live draft.
                // It only folds the persisted history into the list by id.
                mergeLoadedMessages(
                    msg.sessionId,
                    msg.messages.map((m) => ({
                        id: m.id,
                        localId: crypto.randomUUID(),
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp,
                        helpful: m.helpful ?? null,
                        activities: m.activities,
                        final: m.final,
                        status: 'sent' as const,
                    })),
                );
                break;
            }

            case ExtensionMsg.ShowChatNotice: {
                // Raised by the host AFTER the navigation's snapshot, so the
                // notice describes the conversation the student is now
                // looking at. `tone` travels with it: a refused topic change
                // and a failed new conversation have no other surface, so
                // dropping it renders a failure as a muted grey aside.
                showNotice({ text: msg.text, tone: msg.tone });
                break;
            }

            case ExtensionMsg.ConfirmSentMessage: {
                if (!belongsHere(msg)) { break; }
                confirmSentMessage(msg.localId, msg.id);
                break;
            }
        }
    }, [setIrisState, setShowDiagnostics, addMessage, applyLoadedMessages, setReferencedFiles, setWebSocketStatus, setDisabledMessage, setUnavailableMessage, setNoAiDetected, resetTransientChatUi, applyRunUi, applyCommit, markMessageFailed, setOpenSessionError, mergeLoadedMessages, confirmSentMessage, showNotice]);

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

        resetTransientChatUi();

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

    const handleFeedback = (messageId: number, feedback: 'positive' | 'negative') => {
        // The conversation IS the Artemis session.
        const sessionId = store.currentSessionId;
        if (sessionId === null) { return; }
        postCommand(vscodeApi, 'messageFeedback', { sessionId, messageId, feedback });
    };

    const handleOpenFile = (path: string) => {
        postCommand(vscodeApi, 'openFile', { filePath: path });
    };

    // Nothing local owns conversations, so there is nothing to reset: the
    // command re-reads the open conversation from the server. `package.json`
    // names it "Artemis: Reload Iris Chat".
    const handleResetSessions = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'resetChatSessions');
    };

    const handleOpenHelp = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'openHelpPopup');
    };

    const handleOpenDiagnostics = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'openDiagnostics');
    };

    const handleOpenSettings = (setting?: string) => {
        postCommand(vscodeApi, 'openSettings', { setting: setting ?? 'Artemis' });
    };

    const handleReconnectWebSocket = () => {
        postCommand(vscodeApi, 'reconnectWebSocket');
    };

    const handleRetryChatLoad = () => {
        postCommand(vscodeApi, 'reloadChatSession');
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

    // The popovers are mutually exclusive: opening one closes the others.
    // Closing restores focus to whichever element opened it (openerRef), then
    // clears the ref so a click-outside close doesn't refocus a stale element.
    const openPicker = (opener: HTMLElement) => {
        openerRef.current = opener;
        setHistoryOpen(false);
        setCoursePickerOpen(false);
        // Without this the effect above never fires for the topic picker, so a
        // navigation the student did not start (an Ask-Iris command landing on
        // another course) swaps the rows under the cursor and the click stages
        // a DIFFERENT course's exercise.
        sessionWhenPopoverOpened.current = useChatStore.getState().currentSessionId;
        courseWhenPopoverOpened.current = useChatStore.getState().courseId;
        setPickerOpen(true);
    };

    // Opening the picker IS the question "what is there now", so it always
    // refetches. The previous list stays rendered until the answer arrives;
    // only an empty list shows the loading state.
    const requestCourses = () => {
        coursesRequested.current = true;
        if (useChatStore.getState().courses.length === 0) { setCoursesLoading(true); }
        postCommand(vscodeApi, 'refreshCourses');
    };

    // The same outage reads differently depending on what survived it. With no
    // rows the failure is all there is to show; with rows, they stay pickable
    // but unconfirmed, and saying so keeps the picker from presenting a stale
    // course list as current.
    const coursePickerStatus = coursesLoading
        ? 'loading'
        : !store.coursesUnavailable ? 'ready'
            : store.courses.length === 0 ? 'error' : 'stale';

    const openCoursePicker = (opener: HTMLElement) => {
        openerRef.current = opener;
        requestCourses();
        setPickerOpen(false);
        setHistoryOpen(false);
        // Symmetric with `openHistory`: without this, a send-path error from
        // `reportError` (which names a send, not a course) renders as an alert
        // inside "Select course" arbitrarily long after the send that caused it.
        setOpenSessionError(null);
        sessionWhenPopoverOpened.current = useChatStore.getState().currentSessionId;
        courseWhenPopoverOpened.current = useChatStore.getState().courseId;
        setCoursePickerOpen(true);
    };

    const openHistory = (opener: HTMLElement) => {
        openerRef.current = opener;
        setPickerOpen(false);
        setCoursePickerOpen(false);
        setOpenSessionError(null);
        sessionWhenPopoverOpened.current = useChatStore.getState().currentSessionId;
        courseWhenPopoverOpened.current = useChatStore.getState().courseId;
        // The conversation list comes with the snapshot, so opening it costs
        // no request.
        setHistoryOpen(true);
    };

    const closePopovers = () => {
        setPickerOpen(false);
        setHistoryOpen(false);
        setCoursePickerOpen(false);
        setOpenSessionError(null);
        sessionWhenPopoverOpened.current = undefined;
        courseWhenPopoverOpened.current = undefined;
        openerRef.current?.focus();
        openerRef.current = null;
    };

    const isChatDisabled = store.disabledMessage !== null || store.isNoAiDetected;

    const hasConversation = store.currentSessionId !== null;

    // Retry is meaningful only when the underlying cause has plausibly cleared
    // since the original send. Computed inline per render because the message
    // list is short and `messages.map` already walks it.
    const isRetryDisabled = (msg: { errorReason?: ChatMessage['errorReason'] }) => {
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
                return !hasConversation;
            default:
                return false;
        }
    };

    // Run lock (see the effect above): navigation cannot abandon an
    // in-flight run, so the header's course label and both icon buttons go
    // inert for its duration.
    const disableNavigation = store.streaming.isStreaming;

    // Always via the selector, never re-derived here: it is deliberately not a
    // stored field, and a second copy of its rule is exactly how the picker
    // and the chip would start disagreeing about whether a topic may change.
    const canChangeTopic = selectCanChangeTopic(store);
    // The chip and the picker's checkmark must never disagree about what the
    // topic currently is, so both read the same expression.
    const topic = store.pendingContext ?? store.committedContext;
    // No workspace exercise detected and nothing opened: there is no course to
    // put in a header, so the transcript offers the course list instead.
    //
    // Both guards are load-bearing. Before the first snapshot, "nothing is
    // open" and "not told yet" are indistinguishable, and guessing the former
    // flashes the course chooser at every student who does have a conversation.
    // And workspace detection is asynchronous, so an unsettled state can say
    // "nothing is open" while the extension is still working out which exercise
    // the folder is.
    const isColdStart = store.hasReceivedInitialIrisState
        && store.detectionState === 'settled'
        && store.courseId === null
        && store.currentSessionId === null
        && store.workspaceExerciseId === null;

    // Detection could not reach the server. That is not "no exercise here",
    // and the student must not be asked to pick a course as if it were.
    //
    // `courseId === null` is load-bearing, not defensive: entering a course
    // whose Iris is disabled deliberately sets `courseId` and leaves
    // `currentSessionId` null. Without this clause, a failed background
    // detection would cover that course's own banner with a startup-outage
    // screen.
    const detectionUnavailable = store.hasReceivedInitialIrisState
        && store.detectionState === 'unavailable'
        && store.courseId === null
        && store.currentSessionId === null;

    // Nothing open and no answer yet. Must suppress the ordinary shell: the
    // header falls back to "Choose a course" (`ChatHeader`) and the composer to
    // "Choose a course to start chatting" (below), so a spinner in the message
    // area alone would still tell the student to pick a course while detection
    // is mid-flight.
    const startupPending = store.hasReceivedInitialIrisState
        && store.detectionState === 'unsettled'
        && store.courseId === null
        && store.currentSessionId === null;

    // The header, the topic row and the composer's own "choose a course"
    // wording all assume the ordinary "nothing open" shell. Both the waiting
    // and the outage states get their own message-area branch instead.
    // `outageChooserRequested` deliberately does NOT enter this: the header
    // stays suppressed even once the student has bypassed the outage screen,
    // because there is still no course to put in it.
    const suppressOrdinaryShell = startupPending || detectionUnavailable;

    // The cold-start chooser, plus the ONE other path allowed to reach it: a
    // student who bypassed a startup outage that will not clear on its own.
    // Both render the identical inline picker below.
    const showCourseChooser = isColdStart || (detectionUnavailable && outageChooserRequested);

    // The cold start renders the course list as the whole screen, so it must
    // fetch on its own: there is no picker for the student to open first.
    const coldStartFetched = useRef(false);
    useEffect(() => {
        if (!showCourseChooser || coldStartFetched.current) { return; }
        coldStartFetched.current = true;
        requestCourses();
        // Either precondition can trigger it, and the ref makes it once-only.
        // `requestCourses` is deliberately absent from the deps: it is a new
        // function on every render and reads the store, not the closure.
    }, [showCourseChooser]);

    const handleRetryStartupDetection = () => {
        postCommand(vscodeApi, 'retryStartupDetection');
    };

    /**
     * The startup-outage screen's second action. Only flips the flag: the
     * `coldStartFetched` effect above already watches `showCourseChooser`, so
     * calling `requestCourses` here too would fetch twice for one click.
     */
    const handleChooseCourseFromOutage = () => {
        setOutageChooserRequested(true);
    };

    const selectTopic = (mode: string, entityId: number, name?: string) => {
        postCommand(vscodeApi, 'selectTopic', { mode, entityId, name });
        closePopovers();
    };

    // Disabled banner = strictly off (instructor disabled, .noai). The
    // unavailable banner (yellow, retry-able) is rendered separately below.
    // When both states are non-null, the disabled banner wins: it carries
    // strictly more information.
    let disabledBannerText: string | null = null;
    if (store.disabledMessage) {
        disabledBannerText = store.disabledMessage;
    } else if (store.isNoAiDetected) {
        disabledBannerText = 'AI assistance is disabled. A .noai file was detected in your workspace.';
    }

    const showUnavailableBanner = store.unavailableMessage !== null && store.disabledMessage === null;
    /**
     * A failed message whose own Retry covers the reload as well. ONLY the
     * transient reason qualifies: an `iris-disabled` or `no-ai` bubble keeps a
     * Retry that stays disabled, and hiding the banner's for its sake would
     * leave the student with no enabled way back at all.
     */
    const hasRetryableMessage = store.messages.some(
        (m) => m.role === 'user' && m.status === 'error' && m.errorReason === 'iris-unavailable',
    );

    // Order matters: real unavailability ('no context', '.noai', explicit
    // disabled, transient unavailable) wins over the 'loading' state. 'Loading…'
    // is only reached when the chat is otherwise usable but still hydrating.
    let disabledPlaceholder: string | undefined;
    if (store.disabledMessage) {
        // Ahead of the no-conversation case on purpose. Entering a course whose
        // Iris is switched off leaves us with a course and no conversation, and
        // "Choose a course" would send the student back to the picker they just
        // used, past a banner that already gives the real reason.
        disabledPlaceholder = 'Iris chat is not available here';
    } else if (showCourseChooser) {
        // Ahead of `detectionUnavailable` on purpose: once the student has
        // bypassed the outage screen (`outageChooserRequested`), the message
        // area is showing the course picker, not the outage explanation, and
        // the composer must agree with what is actually on screen.
        disabledPlaceholder = 'Choose a course to start chatting';
    } else if (startupPending) {
        // Not "Choose a course": detection has not answered yet, so there may
        // be nothing to choose from at all.
        disabledPlaceholder = 'Looking for your Artemis exercise…';
    } else if (detectionUnavailable) {
        // Not "the server": this screen also covers a failure to read the
        // stored credential, which is local. See the message-area copy below.
        disabledPlaceholder = 'Detecting your Artemis exercise failed. Retry above.';
    } else if (!hasConversation) {
        disabledPlaceholder = 'Choose a course to start chatting';
    } else if (store.isNoAiDetected) {
        disabledPlaceholder = 'AI assistance is disabled (.noai detected)';
    } else if (showUnavailableBanner) {
        disabledPlaceholder = 'Iris is temporarily unavailable. Retry to reload.';
    }

    // Hydrated when either nothing is open (legit "Choose a course" steady
    // state) or the open conversation's transcript has arrived. The gap
    // "conversation open, transcript not yet delivered" renders the loader.
    const messagesHydrated =
        store.hasReceivedInitialIrisState
        && (!hasConversation || store.loadedSessionId === store.currentSessionId);
    // Availability failures (disabled / temporarily unavailable) are NOT
    // "history failed to load". Gate the loader on them so the spinner does not
    // spin forever next to a banner that already states the problem.
    const isChatUnavailable = store.unavailableMessage !== null;
    const messagesLoading =
        !messagesHydrated
        && !store.disabledMessage
        && !isChatUnavailable;

    const irisLogoUri = document.getElementById('root')?.dataset.irisLogoUri;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <img
                        src={irisLogoUri}
                        alt=""
                        width="24"
                        height="24"
                        className={styles.irisIcon}
                    />
                    <h1 className={styles.title}>Chat with Iris</h1>
                </div>

                <div className={styles.headerRight} ref={sideMenuRef}>
                    <button
                        className={styles.menuButton}
                        onClick={() => setSideMenuOpen(!sideMenuOpen)}
                        aria-label="Menu"
                    >
                        <Menu size={18} />
                    </button>

                    {sideMenuOpen && (
                        <div className={styles.sideMenu}>
                            <button
                                className={styles.menuItem}
                                onClick={handleResetSessions}
                                disabled={store.streaming.isStreaming}
                            >
                                Reload Iris Chat
                            </button>
                            <button
                                className={styles.menuItem}
                                onClick={handleOpenHelp}
                            >
                                Iris Chat Guide
                            </button>

                            {store.showDiagnostics && (
                                <button
                                    className={styles.menuItem}
                                    onClick={handleOpenDiagnostics}
                                >
                                    Diagnostics
                                </button>
                            )}

                            <div className={styles.menuDivider} />

                            <div className={styles.menuAbout}>
                                <strong>About</strong>
                                <p>Iris Chat — AI-powered guidance tailored to your Artemis coursework.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Course line + conversation line. The popovers are anchored to
                this section (position: relative) so they render directly
                beneath the header. Suppressed on the cold start (no course to
                name) and while detection is pending/unavailable (the header
                would fall back to "Choose a course", which is not true there). */}
            {!isColdStart && !suppressOrdinaryShell && (
            <div className={styles.contextSection}>
                <ChatHeader
                    courseTitle={store.courseTitle}
                    conversationTitle={store.conversationTitle}
                    displayMessageCount={store.displayMessageCount}
                    disableNavigation={disableNavigation}
                    onOpenCoursePicker={(e) => openCoursePicker(e.currentTarget as HTMLElement)}
                    onNewConversation={() => postCommand(vscodeApi, 'newConversation')}
                    onOpenHistory={(e) => openHistory(e.currentTarget as HTMLElement)}
                />

                {coursePickerOpen && (
                    <CoursePicker
                        courses={store.courses}
                        currentCourseId={store.courseId}
                        status={coursePickerStatus}
                        openError={store.openSessionError}
                        onRetry={requestCourses}
                        onSelect={(courseId) => {
                            // Deliberately does NOT close: a course switch that
                            // fails posts `openSessionError`, which needs a
                            // visible destination. The effect above closes it
                            // once the conversation actually changes.
                            postCommand(vscodeApi, 'switchCourse', { courseId });
                        }}
                        onClose={closePopovers}
                    />
                )}

                {/* The topic picker hangs off the composer, so it is
                    mounted down there rather than here. */}

                {historyOpen && (
                    <ConversationHistory
                        conversations={store.conversations}
                        currentSessionId={store.currentSessionId}
                        openError={store.openSessionError}
                        onOpen={(conversation) => {
                            // Id-based, so it never consults the topic index: a
                            // lecture or text-exercise conversation is openable
                            // even though it can never be a topic.
                            //
                            // Deliberately does NOT close the popover: an open
                            // that fails posts `openSessionError`, which needs a
                            // visible destination.
                            postCommand(vscodeApi, 'openConversation', {
                                courseId: conversation.courseId,
                                sessionId: conversation.sessionId,
                            });
                        }}
                        onNewConversation={() => {
                            postCommand(vscodeApi, 'newConversation');
                            closePopovers();
                        }}
                        onClose={closePopovers}
                    />
                )}
            </div>
            )}

            {disabledBannerText && (
                <div className={styles.disabledBanner}>
                    <Info size={16} />
                    <span>{disabledBannerText}</span>
                </div>
            )}

            {/* Transient banner: the chat couldn't reach Iris
                (network/5xx/timeout). Retry triggers ReloadChatSession, which
                re-reads the open conversation from the server. It is the only
                path back: a websocket reconnect repairs the SUBSCRIPTION and
                reconciles the transcript, but never re-runs the availability
                check. */}
            {showUnavailableBanner && (
                <div className={styles.unavailableBanner} role="alert">
                    <Info size={16} />
                    <span>{store.unavailableMessage}</span>
                    {/* Only when nothing else offers one. A failed message's own
                        Retry reloads too, and two Retry buttons pointing at the
                        same reload read as one of them being broken. */}
                    {!hasRetryableMessage && (
                        <button
                            className={styles.retryButton}
                            onClick={handleRetryChatLoad}
                        >
                            Retry
                        </button>
                    )}
                </div>
            )}

            {/* Shown only when the connection is in a terminal state the user
                must act on (retries exhausted, or client torn down without a
                pending retry). Transient states ('connecting', 'reconnecting')
                and the pre-init 'unknown' state suppress the banner; the status
                bar already surfaces that detail. Also suppressed under the
                unavailable banner, whose Retry is the right affordance: a second
                Reconnect button offers a competing recovery path for the same
                problem. */}
            {store.webSocketStatus === 'disconnected' && !isChatDisabled && !showUnavailableBanner && (
                <div className={styles.websocketBanner}>
                    <span>WebSocket disconnected</span>
                    <button
                        className={styles.reconnectButton}
                        onClick={handleReconnectWebSocket}
                    >
                        Reconnect
                    </button>
                </div>
            )}

            {/* Message list with hydration loader. Hierarchy: disabled (nothing
                to show) > loader (pending hydration) > populated/welcome list.
                `unavailable` deliberately does NOT gate the list: it is the
                transient state, offered with a Retry, and the messages are still
                here. Blanking them would discard what the student is reading
                over a server hiccup while the header goes on counting them. */}
            <div className={styles.messagesSection}>
                {showCourseChooser ? (
                    <div className={styles.coldStart}>
                        {/* The invitation is dropped when the picker below has
                            nothing to offer: with the course list unreachable
                            there is no course to choose, and the message it
                            shows instead is the actionable one. */}
                        <p className={styles.coldStartText}>
                            {coursePickerStatus === 'error'
                                ? 'No Artemis workspace detected.'
                                : 'No Artemis workspace detected. Choose a course to get started.'}
                        </p>
                        <CoursePicker
                            variant="inline"
                            courses={store.courses}
                            currentCourseId={store.courseId}
                            status={coursePickerStatus}
                            openError={store.openSessionError}
                            onRetry={requestCourses}
                            onSelect={(courseId) => postCommand(vscodeApi, 'switchCourse', { courseId })}
                            onClose={closePopovers}
                        />
                    </div>
                ) : startupPending ? (
                    // Nothing open, and detection has not answered yet.
                    // Reuses the hydration loader's shape (below), with its
                    // own copy: "Loading conversation…" would claim one is
                    // open, and there may turn out to be none at all.
                    <div className={styles.loadingState} role="status" aria-busy="true" aria-live="polite">
                        {irisLogoUri && (
                            <img
                                src={irisLogoUri}
                                alt=""
                                width="48"
                                height="48"
                                className={styles.loadingLogo}
                            />
                        )}
                        <span>Looking for your Artemis exercise…</span>
                        <span className={styles.loadingSpinner} aria-hidden="true" />
                    </div>
                ) : detectionUnavailable ? (
                    // Detection could not reach the server. Reuses the cold
                    // start's layout, but the primary action re-runs detection
                    // rather than opening the course chooser: there may be no
                    // course to choose. The second action escapes this screen
                    // even when detection cannot, so Retry failing forever is
                    // not a dead end.
                    <div className={styles.coldStart}>
                        <p className={styles.coldStartText}>
                            {/*
                              * Names the failure, not its cause: a dashboard or
                              * archive lookup that threw, an identity lookup the
                              * server could not answer, or a stored credential
                              * the keychain could not read (that one is local,
                              * so the wording must not blame the server). It
                              * must still differ from a `no-match`: the attempt
                              * failed, not "this folder is not an exercise".
                              */}
                            Detecting your Artemis exercise failed. This is usually temporary.
                        </p>
                        <button
                            className={styles.retryButton}
                            onClick={handleRetryStartupDetection}
                        >
                            Retry
                        </button>
                        <button
                            className={styles.disclaimerLink}
                            onClick={handleChooseCourseFromOutage}
                        >
                            Choose a course instead
                        </button>
                    </div>
                ) : store.disabledMessage ? null
                : messagesLoading ? (
                    <div className={styles.loadingState} role="status" aria-busy="true" aria-live="polite">
                        {irisLogoUri && (
                            <img
                                src={irisLogoUri}
                                alt=""
                                width="48"
                                height="48"
                                className={styles.loadingLogo}
                            />
                        )}
                        <span>Loading conversation…</span>
                        <span className={styles.loadingSpinner} aria-hidden="true" />
                    </div>
                ) : (
                    <ChatMessageList
                        messages={store.messages}
                        streaming={store.streaming}
                        activities={store.activities}
                        liveDraft={store.liveDraft}
                        runState={store.runState}
                        runError={store.runError}
                        onFeedback={handleFeedback}
                        onSendPrompt={handleSendMessage}
                        hasContext={hasConversation}
                        isChatDisabled={isChatDisabled}
                        sendDisabled={sendBlocked}
                        sendDisabledLabel={sendBlockedReason}
                        onRetry={handleRetry}
                        isRetryDisabled={isRetryDisabled}
                    />
                )}
            </div>

            <div className={styles.inputSection}>
                <ReferencedFiles
                    files={store.referencedFiles}
                    onOpenFile={handleOpenFile}
                />

                <ChatNotice
                    notice={store.notice}
                    currentSessionId={store.currentSessionId}
                    onExpire={() => useChatStore.setState({ notice: null })}
                />

                {/* The topic lives on the composer, not in the header: it is
                    what the next message is about, so it belongs beside the
                    thing that writes that message. Suppressed for the same
                    reason the header is: with no course open there is nothing
                    for it to name. */}
                {!isColdStart && !suppressOrdinaryShell && (
                    <div className={styles.topicRow}>
                        <button
                            className={styles.topicButton}
                            onClick={(e) => openPicker(e.currentTarget)}
                            disabled={!canChangeTopic}
                            aria-label="Choose topic"
                            title="Choose topic"
                        >
                            <Plus size={14} />
                        </button>
                        <ContextChip
                            context={topic}
                            contentState={store.contentState}
                            canChangeTopic={canChangeTopic}
                            courseTitle={store.courseTitle}
                            onOpenPicker={(e) => openPicker(e.currentTarget as HTMLElement)}
                            onRemove={() => {
                                // Dropping the topic IS selecting the course
                                // chat; on an empty conversation the host
                                // stages that in place, with no request.
                                if (store.courseId !== null) {
                                    selectTopic('COURSE_CHAT', store.courseId);
                                }
                            }}
                        />
                        {pickerOpen && store.courseId !== null && (
                            <ContextPicker
                                courseId={store.courseId}
                                exercises={store.exercises}
                                committedContext={store.committedContext ?? undefined}
                                pendingContext={store.pendingContext ?? undefined}
                                contentState={store.contentState}
                                sendInFlight={store.sendInFlight || store.navigationInFlight}
                                workspaceExerciseId={store.workspaceExerciseId}
                                onSelect={(picked) => selectTopic(picked.mode, picked.entityId, picked.name)}
                                onClose={closePopovers}
                            />
                        )}
                    </div>
                )}

                {/* Composing and sending are gated separately. The textarea is
                    disabled only while there is nothing to write into, e.g.
                    while the transcript is still hydrating, so a fast user
                    cannot race the load. Sending is refused separately while
                    the host would reject it. */}
                <ChatInput
                    onSend={handleSendMessage}
                    value={store.composerText}
                    onValueChange={store.setComposerText}
                    disabled={
                        isChatDisabled
                        || !hasConversation
                        || isChatUnavailable
                        || messagesLoading
                    }
                    sendDisabled={sendBlocked}
                    sendDisabledLabel={sendBlockedReason}
                    placeholder={sendBlocked ? 'Type your next message…' : undefined}
                    disabledPlaceholder={
                        disabledPlaceholder
                        ?? (messagesLoading ? 'Loading conversation…' : undefined)
                    }
                />

                <div className={styles.disclaimer}>
                    Iris has access to your uncommitted changes (
                    <button
                        className={styles.disclaimerLink}
                        onClick={() => handleOpenSettings('artemis.iris.sendUncommittedChanges')}
                    >
                        configurable
                    </button>
                    ). Iris can make mistakes.
                </div>
            </div>
        </div>
    );
}
