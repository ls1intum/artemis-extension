import Info from 'lucide-react/dist/esm/icons/info';
import Menu from 'lucide-react/dist/esm/icons/menu';
import Plus from 'lucide-react/dist/esm/icons/plus';
import { useEffect, useRef, useState } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { postCommand } from '@shared/messageContracts';

import { selectCanChangeTopic, useChatStore } from '@webview/stores/useChatStore';

import {
    deriveComposerPlaceholder,
    deriveCoursePickerStatus,
    deriveDisabledBannerText,
    deriveStartupState,
    isTranscriptHydrated,
    showsUnavailableBanner,
} from './chatViewState';
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
import { useChatPopovers } from './useChatPopovers';
import { useChatSend } from './useChatSend';
import { useCourseList } from './useCourseList';
import { useIrisInboundMessages } from './useIrisInboundMessages';

interface IrisChatViewProps {
    vscodeApi: VsCodeApi;
}

export function IrisChatView({ vscodeApi }: IrisChatViewProps) {
    // The component's ONE store subscription. Every hook below takes what it
    // needs from here rather than subscribing again: a second whole-store
    // subscription in the same component costs an extra update notification
    // per store write and buys no reactivity.
    const store = useChatStore();

    const courseList = useCourseList(vscodeApi);
    // Hook order is effect order. The popovers' auto-close effects ran ahead of
    // the inbound listener before the split, and the pending-echo timer ahead
    // of the deferred resend; both orderings are preserved here and inside
    // `useChatSend`.
    const popovers = useChatPopovers({ store, requestCourses: courseList.request });
    useIrisInboundMessages({ onCourseRefreshAnswered: courseList.noteRefreshAnswered });
    const {
        sendBlocked, sendBlockedReason,
        handleSendMessage, handleRetry, handleRetryChatLoad, isRetryDisabled,
    } = useChatSend(vscodeApi, store);

    /**
     * The student asked to see the course list anyway, from the startup-outage
     * screen. Detection can fail identically on every retry (e.g. an
     * archived-courses lookup that keeps throwing), so Retry cannot be the ONLY
     * way off that screen. No reset needed: once a course is picked, `courseId`
     * stops being null and `detectionUnavailable` goes false on its own.
     */
    const [outageChooserRequested, setOutageChooserRequested] = useState(false);

    const startup = deriveStartupState(store, outageChooserRequested);
    const coursePickerStatus = deriveCoursePickerStatus(store, courseList.loading);
    const disabledBannerText = deriveDisabledBannerText(store);
    const showUnavailableBanner = showsUnavailableBanner(store);
    const disabledPlaceholder = deriveComposerPlaceholder(store, startup);

    // The cold start renders the course list as the whole screen, so it must
    // fetch on its own: there is no picker for the student to open first.
    const coldStartFetched = useRef(false);
    useEffect(() => {
        if (!startup.showCourseChooser || coldStartFetched.current) { return; }
        coldStartFetched.current = true;
        courseList.request();
        // Either precondition can trigger it, and the ref makes it once-only.
    }, [startup.showCourseChooser, courseList.request]);

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
        popovers.setSideMenuOpen(false);
        postCommand(vscodeApi, 'resetChatSessions');
    };

    const handleOpenHelp = () => {
        popovers.setSideMenuOpen(false);
        postCommand(vscodeApi, 'openHelpPopup');
    };

    const handleOpenDiagnostics = () => {
        popovers.setSideMenuOpen(false);
        postCommand(vscodeApi, 'openDiagnostics');
    };

    const handleOpenSettings = (setting?: string) => {
        postCommand(vscodeApi, 'openSettings', { setting: setting ?? 'Artemis' });
    };

    const selectTopic = (mode: string, entityId: number, name?: string) => {
        postCommand(vscodeApi, 'selectTopic', { mode, entityId, name });
        popovers.closePopovers();
    };

    /**
     * The startup-outage screen's second action. Only flips the flag: the
     * `coldStartFetched` effect above already watches `showCourseChooser`, so
     * requesting the courses here too would fetch twice for one click.
     */
    const handleChooseCourseFromOutage = () => {
        setOutageChooserRequested(true);
    };

    const isChatDisabled = store.disabledMessage !== null || store.isNoAiDetected;
    const hasConversation = store.currentSessionId !== null;

    // Run lock (see `useChatPopovers`): navigation cannot abandon an in-flight
    // run, so the header's course label and both icon buttons go inert for its
    // duration.
    const disableNavigation = store.streaming.isStreaming;

    // Always via the selector, never re-derived here: it is deliberately not a
    // stored field, and a second copy of its rule is exactly how the picker
    // and the chip would start disagreeing about whether a topic may change.
    const canChangeTopic = selectCanChangeTopic(store);
    // The chip and the picker's checkmark must never disagree about what the
    // topic currently is, so both read the same expression.
    const topic = store.pendingContext ?? store.committedContext;

    /**
     * A failed message whose own Retry covers the reload as well. ONLY the
     * transient reason qualifies: an `iris-disabled` or `no-ai` bubble keeps a
     * Retry that stays disabled, and hiding the banner's for its sake would
     * leave the student with no enabled way back at all.
     */
    const hasRetryableMessage = store.messages.some(
        (m) => m.role === 'user' && m.status === 'error' && m.errorReason === 'iris-unavailable',
    );

    // Availability failures (disabled / temporarily unavailable) are NOT
    // "history failed to load". Gate the loader on them so the spinner does not
    // spin forever next to a banner that already states the problem.
    const isChatUnavailable = store.unavailableMessage !== null;
    const messagesLoading =
        !isTranscriptHydrated(store)
        && !store.disabledMessage
        && !isChatUnavailable;

    const irisLogoUri = document.getElementById('root')?.dataset.irisLogoUri;

    /** The hydration spinner, reused verbatim by the pre-detection screen. */
    const loadingState = (label: string) => (
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
            <span>{label}</span>
            <span className={styles.loadingSpinner} aria-hidden="true" />
        </div>
    );

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

                <div className={styles.headerRight} ref={popovers.sideMenuRef}>
                    <button
                        className={styles.menuButton}
                        onClick={() => popovers.setSideMenuOpen(!popovers.sideMenuOpen)}
                        aria-label="Menu"
                    >
                        <Menu size={18} />
                    </button>

                    {popovers.sideMenuOpen && (
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
            {!startup.isColdStart && !startup.suppressOrdinaryShell && (
            <div className={styles.contextSection}>
                <ChatHeader
                    courseTitle={store.courseTitle}
                    conversationTitle={store.conversationTitle}
                    displayMessageCount={store.displayMessageCount}
                    disableNavigation={disableNavigation}
                    onOpenCoursePicker={(e) => popovers.openCoursePicker(e.currentTarget as HTMLElement)}
                    onNewConversation={() => postCommand(vscodeApi, 'newConversation')}
                    onOpenHistory={(e) => popovers.openHistory(e.currentTarget as HTMLElement)}
                />

                {popovers.coursePickerOpen && (
                    <CoursePicker
                        courses={store.courses}
                        currentCourseId={store.courseId}
                        status={coursePickerStatus}
                        openError={store.openSessionError}
                        onRetry={courseList.request}
                        onSelect={(courseId) => {
                            // Deliberately does NOT close: a course switch that
                            // fails posts `openSessionError`, which needs a
                            // visible destination. `useChatPopovers` closes it
                            // once the conversation actually changes.
                            postCommand(vscodeApi, 'switchCourse', { courseId });
                        }}
                        onClose={popovers.closePopovers}
                    />
                )}

                {/* The topic picker hangs off the composer, so it is
                    mounted down there rather than here. */}

                {popovers.historyOpen && (
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
                            popovers.closePopovers();
                        }}
                        onClose={popovers.closePopovers}
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
                        onClick={() => postCommand(vscodeApi, 'reconnectWebSocket')}
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
                {startup.showCourseChooser ? (
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
                            onRetry={courseList.request}
                            onSelect={(courseId) => postCommand(vscodeApi, 'switchCourse', { courseId })}
                            onClose={popovers.closePopovers}
                        />
                    </div>
                ) : startup.startupPending ? (
                    // Nothing open, and detection has not answered yet. Its own
                    // copy: "Loading conversation…" would claim one is open, and
                    // there may turn out to be none at all.
                    loadingState('Looking for your Artemis exercise…')
                ) : startup.detectionUnavailable ? (
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
                            onClick={() => postCommand(vscodeApi, 'retryStartupDetection')}
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
                    loadingState('Loading conversation…')
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
                {!startup.isColdStart && !startup.suppressOrdinaryShell && (
                    <div className={styles.topicRow}>
                        <button
                            className={styles.topicButton}
                            onClick={(e) => popovers.openPicker(e.currentTarget)}
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
                            onOpenPicker={(e) => popovers.openPicker(e.currentTarget as HTMLElement)}
                            onRemove={() => {
                                // Dropping the topic IS selecting the course
                                // chat; on an empty conversation the host
                                // stages that in place, with no request.
                                if (store.courseId !== null) {
                                    selectTopic('COURSE_CHAT', store.courseId);
                                }
                            }}
                        />
                        {popovers.pickerOpen && store.courseId !== null && (
                            <ContextPicker
                                courseId={store.courseId}
                                exercises={store.exercises}
                                committedContext={store.committedContext ?? undefined}
                                pendingContext={store.pendingContext ?? undefined}
                                contentState={store.contentState}
                                sendInFlight={store.sendInFlight || store.navigationInFlight}
                                workspaceExerciseId={store.workspaceExerciseId}
                                onSelect={(picked) => selectTopic(picked.mode, picked.entityId, picked.name)}
                                onClose={popovers.closePopovers}
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
