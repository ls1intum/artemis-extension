import clsx from 'clsx';
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
        applyLoadedMessages, setMessageLoadError,
        clearMessages, setReferencedFiles, setWebSocketStatus,
        setDisabledMessage, setUnavailableMessage, setNoAiDetected,
        resetTransientChatUi, applyRunUi, applyCommit,
        markMessageFailed, applyCourseHistory, setCourseHistoryError,
        setOpenSessionError, mergeLoadedMessages, confirmSentMessage,
        showNotice,
    } = store;
    const [sideMenuOpen, setSideMenuOpen] = useState(false);
    const [contextSwitching, setContextSwitching] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [coursePickerOpen, setCoursePickerOpen] = useState(false);
    // Whether the host DISPATCHES the conversation-first commands, which is
    // the only thing that makes this interface usable. It must come from the
    // host as its own flag: the presenter already mirrors every
    // conversation-first field whenever the conversation service exists (i.e.
    // in every logged-in session today), and all of those fields are
    // legitimately empty at cold start, so neither their values nor the
    // presence of a key can distinguish "answers this model" from "merely
    // mirrors it". Task 14 sets the flag on the commit that cuts the
    // dispatcher over; Task 15 deletes it with the old surfaces.
    const [conversationFirstActive, setConversationFirstActive] = useState(false);
    // True while the host is reading the dashboard course list. A fresh
    // installation tracks nothing, so an empty list is only meaningful once
    // that fetch has finished; without this the picker says "No courses
    // found" the instant it opens.
    const [coursesLoading, setCoursesLoading] = useState(false);
    const previousContextId = useRef<number | null>(null);
    const sideMenuRef = useRef<HTMLDivElement>(null);
    // Element that opened the currently-visible popover (context row or
    // history button), captured so focus can be restored to it on close.
    // A single shared ref instead of a `headerRef` because the two openers
    // are different elements and a click-outside close must return focus
    // to whichever one was actually clicked.
    const openerRef = useRef<HTMLElement | null>(null);
    // Monotonic id for `requestCourseHistory`, bumped on every history open
    // and Retry so the store can drop a response for a request that is no
    // longer the latest one.
    const historyRequestIdRef = useRef(0);

    // Close side menu when clicking outside
    useClickOutside(sideMenuRef, sideMenuOpen, () => setSideMenuOpen(false));

    // Detect context switches for animation
    useEffect(() => {
        const currentId = store.context?.id;

        if (previousContextId.current !== null && currentId !== previousContextId.current) {
            // Context changed - trigger fade out/in animation
            setContextSwitching(true);

            // Reset animation after messages load (500ms for fade out + load + fade in)
            const timer = setTimeout(() => {
                setContextSwitching(false);
            }, 500);

            return () => clearTimeout(timer);
        }

        previousContextId.current = currentId ?? null;
        return undefined;
    }, [store.context?.id]);

    // Close the history popover once the active session actually changes:
    // the success signal for a row click's `openArtemisSession` (which does
    // NOT close the popover itself, so a resulting inline openSessionError
    // stays visible). Guarded on the ref already having a value so this
    // never fires on the render that first opens the popover.
    const previousActiveSessionIdForHistory = useRef<string | null>(null);
    useEffect(() => {
        if (
            historyOpen
            && previousActiveSessionIdForHistory.current !== null
            && store.activeSessionId !== previousActiveSessionIdForHistory.current
        ) {
            closePopovers();
        }
        previousActiveSessionIdForHistory.current = store.activeSessionId;
    }, [store.activeSessionId, historyOpen]);

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
        switch (msg.type) {
            case ExtensionMsg.UpdateIrisState: {
                setIrisState(msg.state);
                setConversationFirstActive(msg.state.conversationFirst === true);
                // Any snapshot answers the refresh: the course list travels on
                // it, so there is nothing left to wait for.
                setCoursesLoading(false);
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
                // The projection now owns the transient run UI: applyCommit
                // clears the draft/waiting atomically with the committed
                // message when a runUi is attached, and leaves them untouched
                // for an intermediate (final:false) message so the waiting flag
                // survives until the run truly ends. Both producers always set
                // localSessionId (and drop the message when they have no
                // active session), so it is required on the wire contract.
                const activeLocalSessionId = useChatStore.getState().activeSessionId ?? '';
                applyCommit(
                    mapped,
                    msg.runUi,
                    msg.localSessionId,
                    activeLocalSessionId,
                );
                break;
            }

            case ExtensionMsg.UpdateIrisRunUi: {
                const activeLocalSessionId = useChatStore.getState().activeSessionId ?? '';
                applyRunUi(msg.projection, activeLocalSessionId);
                break;
            }

            case ExtensionMsg.LoadMessages: {
                // Discard any load that does not match the currently active
                // local session. This covers the obvious "user switched
                // sessions while a load was in flight" case AND the subtler
                // one where there is no active session at all (clearMessages,
                // never-selected, etc.) — in both we must not mutate the
                // store with a payload the user has navigated away from.
                const currentSessionId = useChatStore.getState().activeSessionId;
                if (currentSessionId !== msg.localSessionId) {
                    break;
                }
                resetTransientChatUi();
                applyLoadedMessages(
                    msg.localSessionId,
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

            case ExtensionMsg.LoadMessagesError: {
                const currentSessionId = useChatStore.getState().activeSessionId;
                if (currentSessionId !== msg.localSessionId) {
                    break;
                }
                setMessageLoadError(msg.localSessionId);
                break;
            }

            case ExtensionMsg.ClearChatMessages:
                clearMessages();
                break;

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

            case ExtensionMsg.UpdateCourseHistory: {
                applyCourseHistory(msg.requestId, msg.entries);
                break;
            }

            case ExtensionMsg.CourseHistoryError: {
                setCourseHistoryError(msg.requestId);
                break;
            }

            case ExtensionMsg.UpdateNoAiStatus: {
                setNoAiDetected(msg.isNoAiDetected);
                break;
            }

            case ExtensionMsg.SendRejected: {
                // Ignore stale rejections that arrive after the user already
                // switched session — the corresponding optimistic message
                // would not exist in the active session anyway, and clearing
                // transient UI for an unrelated session is wrong.
                const currentSessionId = useChatStore.getState().activeSessionId;
                if (currentSessionId !== msg.localSessionId) {
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
                if (msg.localSessionId !== useChatStore.getState().activeSessionId) { break; }
                // Deliberately NO resetTransientChatUi(): a merge must not wipe a live draft.
                // It only folds the persisted history into the list by id.
                mergeLoadedMessages(
                    msg.localSessionId,
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
                // looking at.
                showNotice({ text: msg.text });
                break;
            }

            case ExtensionMsg.ConfirmSentMessage: {
                if (msg.localSessionId !== useChatStore.getState().activeSessionId) { break; }
                confirmSentMessage(msg.localId, msg.id);
                break;
            }
        }
    }, [setIrisState, setShowDiagnostics, addMessage, applyLoadedMessages, setMessageLoadError, clearMessages, setReferencedFiles, setWebSocketStatus, setDisabledMessage, setUnavailableMessage, setNoAiDetected, resetTransientChatUi, applyRunUi, applyCommit, markMessageFailed, applyCourseHistory, setCourseHistoryError, setOpenSessionError, mergeLoadedMessages, confirmSentMessage, showNotice]);

    const handleSendMessage = (text: string) => {
        const localId = crypto.randomUUID();
        const localSessionId = store.activeSessionId;
        if (localSessionId === null) {
            // No active session — the extension host could not correlate
            // a SendRejected back to a message anyway. The ChatInput is
            // already disabled in this state, so this is just a defensive
            // guard against a programmer error.
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

        // Send to extension. localSessionId lets the host echo it back on
        // rejection so the webview can ignore stale responses after a
        // session switch.
        postCommand(vscodeApi, 'sendMessage', { text, localId, localSessionId });
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
        const activeSession = store.sessions.find(s => s.id === store.activeSessionId);
        if (typeof activeSession?.artemisSessionId !== 'number') {return;}
        postCommand(vscodeApi, 'messageFeedback', {
            sessionId: activeSession.artemisSessionId,
            messageId,
            feedback,
        });
    };

    const handleOpenFile = (path: string) => {
        postCommand(vscodeApi, 'openFile', { filePath: path });
    };

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

    const handleDebugSessions = () => {
        setSideMenuOpen(false);
        postCommand(vscodeApi, 'debugSessions');
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

    // Target-preserving retry for a failed message load: reload ONLY the
    // active session, without jumping back to the context's default session.
    const handleRetryActiveSession = () => {
        postCommand(vscodeApi, 'reloadActiveSession');
    };

    // Popover open/close helpers. The two popovers are mutually exclusive.
    // Opening one always closes the other. Closing restores focus to
    // whichever element opened it (captured in openerRef), then clears the
    // ref so a click-outside close doesn't refocus a stale element.
    const openPicker = (opener: HTMLElement) => {
        openerRef.current = opener;
        setHistoryOpen(false);
        setCoursePickerOpen(false);
        setPickerOpen(true);
    };

    // Only when there is nothing to show: `status: 'loading'` hides the list,
    // so refreshing an already-populated picker would blank it under the
    // student's cursor.
    const requestCoursesIfEmpty = () => {
        if (useChatStore.getState().courses.length > 0) { return; }
        setCoursesLoading(true);
        postCommand(vscodeApi, 'refreshCourses');
    };

    const openCoursePicker = (opener: HTMLElement) => {
        openerRef.current = opener;
        requestCoursesIfEmpty();
        setPickerOpen(false);
        setHistoryOpen(false);
        setCoursePickerOpen(true);
    };

    // Course-wide history is per-course, not per-exercise: an exercise
    // context resolves to its course, a course context resolves to itself.
    const resolveHistoryCourseId = (): number | undefined => {
        if (store.context === null) { return undefined; }
        return store.context.type === 'course' ? store.context.id : store.context.courseId;
    };

    // Shared by the initial open and the popover's own Retry button. With no
    // resolvable course (no context selected yet) there is nothing to fetch,
    // so the slice goes straight to `ready`/empty instead of round-tripping.
    const requestCourseHistoryFor = (requestId: number) => {
        const courseId = resolveHistoryCourseId();
        store.setCourseHistoryLoading(requestId);
        if (courseId === undefined) {
            store.applyCourseHistory(requestId, []);
            return;
        }
        postCommand(vscodeApi, 'requestCourseHistory', { courseId, requestId });
    };

    const openHistory = (opener: HTMLElement) => {
        openerRef.current = opener;
        setPickerOpen(false);
        setCoursePickerOpen(false);
        setOpenSessionError(null);
        // The conversation-first list comes with the snapshot, so opening it
        // costs no request; only the pre-Task-14 popover has to fetch.
        if (!conversationFirstActive) {
            historyRequestIdRef.current += 1;
            requestCourseHistoryFor(historyRequestIdRef.current);
        }
        setHistoryOpen(true);
    };

    const closePopovers = () => {
        setPickerOpen(false);
        setHistoryOpen(false);
        setCoursePickerOpen(false);
        setOpenSessionError(null);
        openerRef.current?.focus();
        openerRef.current = null;
    };

    // Check if chat is disabled
    const isChatDisabled = store.disabledMessage !== null || store.isNoAiDetected;

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
                return store.context === null;
            default:
                return false;
        }
    };

    // Header data. activeSession backs the conversation row (title, message
    // count, last-activity); courseName is the exercise-context subtitle
    // (course chat contexts show a fixed "Course chat" subtitle instead, see
    // ChatHeader).
    const activeSession = store.sessions.find(s => s.id === store.activeSessionId);
    const courseName = store.context?.type === 'exercise'
        ? store.courses.find(c => c.id === store.context?.courseId)?.title ?? null
        : null;
    // Mirrors the retired context dropdown's canCreateNewSession intent: a
    // brand new, still-empty active session should be reused rather than
    // spawning another empty one, and a create must not race an in-flight
    // send.
    const canCreateConversation =
        store.context !== null
        && (activeSession?.messageCount ?? 0) > 0
        && !store.streaming.isStreaming;

    // Run lock (see the effect above): navigation cannot abandon an
    // in-flight run, so the context row and both icon buttons go inert for
    // its duration.
    const disableNavigation = store.streaming.isStreaming;

    // ---- Conversation-first derivations (Task 12).
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
    const isColdStart = conversationFirstActive
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
    });

    // The conversation-first branches post ONLY conversation-first commands,
    // and Task 14 owns making the host answer them. Posting the old equivalent
    // beside each one cannot help: before Task 14 these branches are behind a
    // flag nothing sets, so it is unreachable, and after Task 14 it is either
    // dropped in a debug log or, if the flag and the removal of the old
    // handlers land in two commits, acted on as well, turning one click into
    // two context selections or two conversations. `_handleCommand` still has
    // live SelectChatContext, CreateNewSession and OpenArtemisSession cases,
    // and Task 15 is what deletes those contracts, so that window is real.
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
    if (store.context === null) {
        disabledPlaceholder = 'Select a course or exercise to start chatting';
    } else if (store.isNoAiDetected) {
        disabledPlaceholder = 'AI assistance is disabled (.noai detected)';
    } else if (store.disabledMessage) {
        disabledPlaceholder = 'Iris chat is not available for this exercise';
    } else if (showUnavailableBanner) {
        disabledPlaceholder = 'Iris is temporarily unavailable. Retry to reload.';
    }

    // Hydrated when either no context is selected (legit "Select a course"
    // steady state) or when the active session has a successful load. The
    // gap "context set + activeSessionId === null" is the cold-start window
    // and renders the loader. Keyed on local UUID, not Artemis id, because
    // brand-new sessions have a UUID before the server round-trip returns.
    const messagesHydrated =
        store.hasReceivedInitialIrisState
        && (
            store.context === null
            || (store.activeSessionId !== null
                && store.messageLoad !== null
                && store.messageLoad.localSessionId === store.activeSessionId
                && store.messageLoad.status === 'success')
        );
    const messagesErrored =
        store.activeSessionId !== null
        && store.messageLoad !== null
        && store.messageLoad.localSessionId === store.activeSessionId
        && store.messageLoad.status === 'error';
    // Availability failures (disabled / temporarily unavailable) are NOT
    // "history failed to load" — gate the loader on them so the spinner
    // does not spin forever next to a banner that already states the
    // problem. Fixes the #219 stuck-loader symptom.
    const isChatUnavailable = store.unavailableMessage !== null;
    const messagesLoading =
        !messagesHydrated
        && !messagesErrored
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
                                Reset & Sync Sessions
                            </button>
                            <button
                                className={styles.menuItem}
                                onClick={handleOpenHelp}
                            >
                                Chat Context Guide
                            </button>

                            {store.showDiagnostics && (
                                <>
                                    <button
                                        className={styles.menuItem}
                                        onClick={handleOpenDiagnostics}
                                    >
                                        Diagnostics
                                    </button>
                                    <button
                                        className={styles.menuItem}
                                        onClick={handleDebugSessions}
                                    >
                                        Debug Sessions (Raw)
                                    </button>
                                </>
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

            {/* Two-row header: context (course/exercise) + conversation.
                pickerOpen/historyOpen are mutually exclusive; both popovers
                are anchored to this section (position: relative) so they
                render directly beneath the header. */}
            {!isColdStart && (
            <div className={styles.contextSection}>
                <ChatHeader
                    context={store.context}
                    activeSession={activeSession}
                    courseName={courseName}
                    canCreateConversation={canCreateConversation}
                    disableNavigation={disableNavigation}
                    onOpenContextPicker={(e) => openPicker(e.currentTarget as HTMLElement)}
                    onNewConversation={() => {
                        if (conversationFirstActive) {
                            postCommand(vscodeApi, 'newConversation');
                        } else {
                            postCommand(vscodeApi, 'createNewSession');
                        }
                    }}
                    onOpenHistory={(e) => openHistory(e.currentTarget as HTMLElement)}
                    {...(conversationFirstActive ? {
                        courseTitle: store.courseTitle,
                        conversationTitle: store.conversationTitle,
                        displayMessageCount: store.displayMessageCount,
                        onOpenCoursePicker: (e: React.MouseEvent) => openCoursePicker(e.currentTarget as HTMLElement),
                    } : {})}
                />

                {coursePickerOpen && (
                    <CoursePicker
                        courses={store.courses}
                        currentCourseId={store.courseId}
                        status={coursesLoading ? 'loading' : 'ready'}
                        onSelect={(courseId) => {
                            postCommand(vscodeApi, 'switchCourse', { courseId });
                            closePopovers();
                        }}
                        onClose={closePopovers}
                    />
                )}

                {/* The topic picker hangs off the composer, so in the
                    conversation-first layout it is mounted down there. */}
                {pickerOpen && !conversationFirstActive && (
                    <ContextPicker
                        context={store.context}
                        exercises={store.exercises}
                        courses={store.courses}
                        onSelectContext={(type, id, title, shortName) => {
                            postCommand(vscodeApi, 'selectChatContext', { context: type, itemId: id, itemName: title, itemShortName: shortName });
                            closePopovers();
                        }}
                        onClose={closePopovers}
                    />
                )}

                {historyOpen && (conversationFirstActive ? (
                    <ConversationHistory
                        conversations={store.conversations}
                        currentSessionId={store.currentSessionId}
                        onOpen={(conversation) => {
                            // Id-based, so it never consults the topic index:
                            // a lecture or text-exercise conversation is
                            // openable even though it can never be a topic.
                            postCommand(vscodeApi, 'openConversation', {
                                courseId: conversation.courseId,
                                sessionId: conversation.sessionId,
                            });
                            closePopovers();
                        }}
                        onNewConversation={() => {
                            postCommand(vscodeApi, 'newConversation');
                            closePopovers();
                        }}
                        onClose={closePopovers}
                    />
                ) : (
                    <ConversationHistory
                        entries={store.courseHistory.entries}
                        status={store.courseHistory.status}
                        activeArtemisSessionId={activeSession?.artemisSessionId ?? null}
                        canCreateConversation={canCreateConversation}
                        openError={store.openSessionError}
                        onSelectEntry={(entry) => {
                            // Deliberately does NOT close the popover: a
                            // resulting openSessionError needs a visible
                            // destination. It closes once the active
                            // session actually changes (see the effect
                            // above) or on Escape/click-outside.
                            postCommand(vscodeApi, 'openArtemisSession', {
                                courseId: entry.courseId,
                                artemisSessionId: entry.artemisSessionId,
                            });
                        }}
                        onNewConversation={() => {
                            postCommand(vscodeApi, 'createNewSession');
                            closePopovers();
                        }}
                        onRetry={() => {
                            historyRequestIdRef.current += 1;
                            requestCourseHistoryFor(historyRequestIdRef.current);
                        }}
                        onClose={closePopovers}
                    />
                ))}
            </div>
            )}

            {/* Disabled banner (Iris not available or .noai detected) */}
            {disabledBannerText && (
                <div className={styles.disabledBanner}>
                    <Info size={16} />
                    <span>{disabledBannerText}</span>
                </div>
            )}

            {/* Iris-availability transient banner: chat-reload couldn't reach
                Iris (network/5xx/timeout). The Retry button triggers
                ReloadChatSession on the extension side, which is also fired
                automatically on websocket reconnect — so the user has both
                a manual and an automatic path back to a working chat. */}
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

            {/* Message list with context-switch animation and hydration loader.
                Hierarchy: availability banner state (disabled/unavailable
                already render their own banner above and gate everything
                else) > error UI > loader (context-switch animation OR
                pending hydration) > populated/welcome list.
                When disabled or unavailable is set, the central "Failed to
                load chat history" UI is suppressed — the banner above is the
                authoritative error surface. */}
            <div className={clsx(styles.messagesSection, {
                [styles.contextSwitching]: contextSwitching
            })}>
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
                            onSelect={(courseId) => postCommand(vscodeApi, 'switchCourse', { courseId })}
                            onClose={closePopovers}
                        />
                    </div>
                ) : (store.disabledMessage || store.unavailableMessage) ? null
                : messagesErrored ? (
                    <div className={styles.loadingState}>
                        <div className={styles.loadError} role="alert">
                            Failed to load chat history.
                            <button
                                className={styles.retryButton}
                                onClick={handleRetryActiveSession}
                            >
                                Retry
                            </button>
                        </div>
                    </div>
                ) : (contextSwitching || messagesLoading) ? (
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
                        committedContext={store.committedContext}
                        pendingContext={store.pendingContext}
                        streaming={store.streaming}
                        activities={store.activities}
                        liveDraft={store.liveDraft}
                        runState={store.runState}
                        runError={store.runError}
                        onFeedback={handleFeedback}
                        onSendPrompt={handleSendMessage}
                        hasContext={store.context !== null}
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
                {conversationFirstActive && (
                    <ChatNotice
                        notice={store.notice}
                        currentSessionId={store.currentSessionId}
                        onExpire={() => useChatStore.setState({ notice: null })}
                    />
                )}

                {/* The topic lives here, on the composer, not in the header:
                    it is what the next message is about, so it belongs beside
                    the thing that writes that message. */}
                {conversationFirstActive && !isColdStart && (
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
                                conversations={store.conversations}
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
                    {...(conversationFirstActive ? {
                        value: store.composerText,
                        onValueChange: store.setComposerText,
                    } : {})}
                    disabled={
                        isChatDisabled
                        || store.context === null
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
