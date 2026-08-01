import Info from 'lucide-react/dist/esm/icons/info';
import Menu from 'lucide-react/dist/esm/icons/menu';
import Plus from 'lucide-react/dist/esm/icons/plus';
import { useEffect, useRef, useState } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { selectCanChangeTopic, useChatStore } from '@webview/stores/useChatStore';

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
    // True while the host is reading the dashboard course list. A fresh
    // installation tracks nothing, so an empty list is only meaningful once
    // that fetch has finished; without this the picker says "No courses
    // found" the instant it opens.
    const [coursesLoading, setCoursesLoading] = useState(false);
    /** Whether a `refreshCourses` is outstanding. See the snapshot handler. */
    const coursesRequested = useRef(false);
    const sideMenuRef = useRef<HTMLDivElement>(null);
    // Element that opened the currently-visible popover (context row or
    // history button), captured so focus can be restored to it on close.
    // A single shared ref instead of a `headerRef` because the two openers
    // are different elements and a click-outside close must return focus
    // to whichever one was actually clicked.
    const openerRef = useRef<HTMLElement | null>(null);
    // Close side menu when clicking outside
    useClickOutside(sideMenuRef, sideMenuOpen, () => setSideMenuOpen(false));

    // A navigation-initiating popover stays open until the navigation lands,
    // so a failure has somewhere to be read (see `openSessionError` below).
    // The success signal is the conversation differing from the one that was
    // open when the popover was opened, so the id is CAPTURED at open time
    // rather than tracked as "the previous value": `currentSessionId` is
    // legitimately `null` whenever nothing is open (a failed acquisition, Iris
    // unavailable), and the header and both popovers still render in that
    // state, so `null` cannot double as "no popover is open". `undefined` can:
    // it is not part of the field's type.
    const sessionWhenPopoverOpened = useRef<number | null | undefined>(undefined);
    useEffect(() => {
        if (sessionWhenPopoverOpened.current === undefined) { return; }
        if (store.currentSessionId !== sessionWhenPopoverOpened.current) {
            // Also clears `openSessionError`, so a failure the student has
            // since navigated past cannot sit on top of the conversation that
            // did load.
            closePopovers();
        }
    }, [store.currentSessionId]);

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

    // Message listener - handles messages from extension
    useExtensionMessage((msg) => {
        // Reads the store directly, not the render-time closure: messages
        // arrive between renders and the conversation must be the CURRENT one.
        const belongsHere = (m: { sessionId: number }): boolean =>
            m.sessionId === useChatStore.getState().currentSessionId;
        switch (msg.type) {
            case ExtensionMsg.UpdateIrisState: {
                setIrisState(msg.state);
                // The host answers a refresh with exactly one snapshot, so the
                // next one after the request ends the wait. Keyed on the
                // request being ANSWERED rather than on the list being
                // non-empty: a student whose dashboard genuinely has no courses
                // must reach "No courses found", not a permanent skeleton.
                if (coursesRequested.current) {
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
                // switched session — the corresponding optimistic message
                // would not exist in the active session anyway, and clearing
                // transient UI for an unrelated session is wrong.
                if (!belongsHere(msg)) {
                    break;
                }
                const matched = markMessageFailed(msg.localId, msg.errorMessage, msg.reason);
                // Only clear the indicator if we actually found and updated
                // the message. A non-match means the rejection is stale
                // (e.g. retry already removed the failed entry, or messages
                // were re-hydrated from server) and we must not touch the
                // current request's transient UI.
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

    const handleSendMessage = (text: string) => {
        const localId = crypto.randomUUID();
        // The conversation the bubble is drawn in travels WITH the send, so the
        // host can refuse it if a navigation completed in between rather than
        // posting the student's text into whatever is open by then.
        const sessionId = store.currentSessionId;
        if (sessionId === null) {
            // Nothing to address a rejection to. The composer is already
            // disabled in this state, so this is a defensive guard against a
            // programmer error.
            return;
        }

        // Clear any stale streaming state from the previous request
        resetTransientChatUi();

        // Add optimistic message
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
    };

    const handleRetry = (localId: string) => {
        const failed = useChatStore.getState().messages.find((m) => m.localId === localId);
        if (!failed || failed.role !== 'user' || failed.status !== 'error') {
            return;
        }
        // Remove the failed entry first so handleSendMessage's optimistic
        // add doesn't briefly produce two copies. Zustand+React batch the
        // two state updates in the same event tick, so there is no visible
        // flicker.
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

    // Nothing local owns conversations any more, so there is nothing to
    // reset: the command re-reads the open conversation from the server, and
    // `package.json` names it "Artemis: Reload Iris Chat".
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

    // Popover open/close helpers. The two popovers are mutually exclusive.
    // Opening one always closes the other. Closing restores focus to
    // whichever element opened it (captured in openerRef), then clears the
    // ref so a click-outside close doesn't refocus a stale element.
    const openPicker = (opener: HTMLElement) => {
        openerRef.current = opener;
        setHistoryOpen(false);
        setCoursePickerOpen(false);
        // Captured like the other two openers. Without it the effect above
        // never fires for the topic picker, so a navigation the student did
        // not start (an Ask-Iris command landing on another course) swaps the
        // rows under the cursor and the click stages a DIFFERENT course's
        // exercise. It also keeps the ref honest when this opener closes the
        // history: otherwise the ref stays live for a popover that is gone.
        sessionWhenPopoverOpened.current = useChatStore.getState().currentSessionId;
        setPickerOpen(true);
    };

    // Only when there is nothing to show: `status: 'loading'` hides the list,
    // so refreshing an already-populated picker would blank it under the
    // student's cursor.
    const requestCoursesIfEmpty = () => {
        if (useChatStore.getState().courses.length > 0) { return; }
        coursesRequested.current = true;
        setCoursesLoading(true);
        postCommand(vscodeApi, 'refreshCourses');
    };

    const openCoursePicker = (opener: HTMLElement) => {
        openerRef.current = opener;
        requestCoursesIfEmpty();
        setPickerOpen(false);
        setHistoryOpen(false);
        // Symmetric with `openHistory`: without this, a send-path error from
        // `reportError` (which names a send, not a course) renders as an alert
        // inside "Select course" arbitrarily long after the send that caused it.
        setOpenSessionError(null);
        sessionWhenPopoverOpened.current = useChatStore.getState().currentSessionId;
        setCoursePickerOpen(true);
    };

    const openHistory = (opener: HTMLElement) => {
        openerRef.current = opener;
        setPickerOpen(false);
        setCoursePickerOpen(false);
        setOpenSessionError(null);
        sessionWhenPopoverOpened.current = useChatStore.getState().currentSessionId;
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
        openerRef.current?.focus();
        openerRef.current = null;
    };

    // Check if chat is disabled
    const isChatDisabled = store.disabledMessage !== null || store.isNoAiDetected;

    /** "There is something to talk to", i.e. a conversation is open. */
    const hasConversation = store.currentSessionId !== null;

    // Decide whether the Retry button on a failed user message should be
    // active right now. Retry is meaningful only when the underlying cause
    // has plausibly cleared since the original send. Computed inline per
    // render because the message list is short and `messages.map` already
    // walks it; rebuilding a Map would be wasted work.
    const isRetryDisabled = (msg: { errorReason?: ChatMessage['errorReason'] }) => {
        switch (msg.errorReason) {
            case 'iris-disabled':
                // Persistent until the user navigates away from the
                // disabled exercise; the banner already states this.
                return true;
            case 'iris-unavailable':
                // Disabled while the unavailable banner is shown — the
                // banner's own Retry button is the right affordance to
                // reload the chat. Once that succeeds (banner clears), the
                // inline Retry on the failed message becomes active again
                // so the user can resend their original text.
                return store.unavailableMessage !== null;
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
    // put in a header, so the transcript offers the course list instead of an
    // empty conversation the student cannot act on.
    //
    // Gated on the first snapshot having arrived, for the same reason
    // `messagesHydrated` is: before it, "nothing is open" and "we have not
    // been told yet" are indistinguishable, and guessing the former flashes
    // the course chooser at every student who does have a conversation.
    const isColdStart = store.hasReceivedInitialIrisState
        && store.courseId === null
        && store.currentSessionId === null
        && store.workspaceExerciseId === null;

    // The cold start renders the course list as the whole screen, so it must
    // fetch on its own: there is no picker for the student to open first.
    const coldStartFetched = useRef(false);
    useEffect(() => {
        if (!isColdStart || coldStartFetched.current) { return; }
        coldStartFetched.current = true;
        requestCoursesIfEmpty();
        // Only the cold start can trigger it, and the ref makes it once-only.
        // `requestCoursesIfEmpty` is deliberately absent from the deps: it is a
        // new function on every render and reads the store, not the closure.
    }, [isColdStart]);

    const selectTopic = (mode: string, entityId: number, name?: string) => {
        postCommand(vscodeApi, 'selectTopic', { mode, entityId, name });
        closePopovers();
    };

    // Disabled banner = strictly off (instructor disabled, .noai). The
    // unavailable banner (yellow, retry-able) is rendered separately below.
    // When both states are non-null, the disabled banner wins — it carries
    // strictly more information.
    let disabledBannerText: string | null = null;
    if (store.disabledMessage) {
        disabledBannerText = store.disabledMessage;
    } else if (store.isNoAiDetected) {
        disabledBannerText = 'AI assistance is disabled. A .noai file was detected in your workspace.';
    }

    const showUnavailableBanner = store.unavailableMessage !== null && store.disabledMessage === null;

    // Compute disabled placeholder for input. Order matters: real
    // unavailability ('no context', '.noai', explicit disabled, transient
    // unavailable) wins over the 'loading' state — we only fall through to
    // 'Loading…' when the chat is otherwise usable but still waiting for
    // hydration.
    let disabledPlaceholder: string | undefined;
    if (!hasConversation) {
        disabledPlaceholder = 'Choose a course to start chatting';
    } else if (store.isNoAiDetected) {
        disabledPlaceholder = 'AI assistance is disabled (.noai detected)';
    } else if (store.disabledMessage) {
        disabledPlaceholder = 'Iris chat is not available for this exercise';
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
    // "history failed to load" — gate the loader on them so the spinner
    // does not spin forever next to a banner that already states the
    // problem. Fixes the #219 stuck-loader symptom.
    const isChatUnavailable = store.unavailableMessage !== null;
    const messagesLoading =
        !messagesHydrated
        && !store.disabledMessage
        && !isChatUnavailable;

    const irisLogoUri = document.getElementById('root')?.dataset.irisLogoUri;

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    {/* Iris logo */}
                    <img
                        src={irisLogoUri}
                        alt=""
                        width="24"
                        height="24"
                        className={styles.irisIcon}
                    />
                    <h1 className={styles.title}>Chat with Iris</h1>
                </div>

                {/* Hamburger menu */}
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

            {/* Header: course line + conversation line. The popovers are
                anchored to this section (position: relative) so they render
                directly beneath the header. */}
            {!isColdStart && (
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
                        status={coursesLoading ? 'loading' : 'ready'}
                        openError={store.openSessionError}
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
                            // Id-based, so it never consults the topic index:
                            // a lecture or text-exercise conversation is
                            // openable even though it can never be a topic.
                            //
                            // Deliberately does NOT close the popover: an open
                            // that fails posts `openSessionError`, which needs a
                            // visible destination. The effect above closes it
                            // once the conversation actually changes.
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

            {/* Disabled banner (Iris not available or .noai detected) */}
            {disabledBannerText && (
                <div className={styles.disabledBanner}>
                    <Info size={16} />
                    <span>{disabledBannerText}</span>
                </div>
            )}

            {/* Iris-availability transient banner: the chat couldn't reach
                Iris (network/5xx/timeout). The Retry button triggers
                ReloadChatSession on the extension side, which re-reads the
                open conversation from the server. It is the only path back:
                a websocket reconnect repairs the SUBSCRIPTION and reconciles
                the transcript, but it does not re-run the availability
                check. */}
            {showUnavailableBanner && (
                <div className={styles.unavailableBanner} role="alert">
                    <Info size={16} />
                    <span>{store.unavailableMessage}</span>
                    <button
                        className={styles.retryButton}
                        onClick={handleRetryChatLoad}
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* WebSocket status banner: shown when the connection is in a
                terminal state the user must act on (retries exhausted, or
                client torn down without a pending retry). Transient states
                ('connecting', 'reconnecting') and the pre-init 'unknown'
                state suppress the banner — the status bar already surfaces
                that detail. Also suppressed when the unavailable banner is
                shown: its Retry button is the right affordance and surfacing
                a second Reconnect button would give the user two competing
                recovery paths for the same underlying problem. */}
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

            {/* Message list with hydration loader. Hierarchy: availability
                banner state (disabled/unavailable already render their own
                banner above and gate everything else) > loader (pending
                hydration) > populated/welcome list. */}
            <div className={styles.messagesSection}>
                {isColdStart ? (
                    <div className={styles.coldStart}>
                        <p className={styles.coldStartText}>
                            No Artemis workspace detected. Choose a course to get started.
                        </p>
                        <CoursePicker
                            variant="inline"
                            courses={store.courses}
                            currentCourseId={store.courseId}
                            status={coursesLoading ? 'loading' : 'ready'}
                            openError={store.openSessionError}
                            onSelect={(courseId) => postCommand(vscodeApi, 'switchCourse', { courseId })}
                            onClose={closePopovers}
                        />
                    </div>
                ) : (store.disabledMessage || store.unavailableMessage) ? null
                : messagesLoading ? (
                    <div className={styles.loadingState} aria-busy="true" aria-live="polite">
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
                        onRetry={handleRetry}
                        isRetryDisabled={isRetryDisabled}
                    />
                )}
            </div>

            {/* Input section */}
            <div className={styles.inputSection}>
                {/* Referenced files */}
                <ReferencedFiles
                    files={store.referencedFiles}
                    onOpenFile={handleOpenFile}
                />

                {/* One muted line above the composer. Actionless in PR 1. */}
                <ChatNotice
                    notice={store.notice}
                    currentSessionId={store.currentSessionId}
                    onExpire={() => useChatStore.setState({ notice: null })}
                />

                {/* The topic lives here, on the composer, not in the header:
                    it is what the next message is about, so it belongs beside
                    the thing that writes that message. */}
                {!isColdStart && (
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

                {/* Chat input — disabled while we are still hydrating the
                    message list so a fast user does not race the load and
                    have their just-sent message swallowed when the server
                    snapshot arrives. */}
                <ChatInput
                    onSend={handleSendMessage}
                    value={store.composerText}
                    onValueChange={store.setComposerText}
                    disabled={
                        isChatDisabled
                        || !hasConversation
                        || isChatUnavailable
                        || messagesLoading
                        || store.streaming.isStreaming
                    }
                    disabledPlaceholder={
                        disabledPlaceholder
                        ?? (messagesLoading
                            ? 'Loading conversation…'
                            : store.streaming.isStreaming
                                ? 'Iris is responding…'
                                : undefined)
                    }
                />

                {/* Disclaimer */}
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
