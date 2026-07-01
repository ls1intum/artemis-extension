import clsx from 'clsx';
import Info from 'lucide-react/dist/esm/icons/info';
import Menu from 'lucide-react/dist/esm/icons/menu';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';
import { useChatStore } from '@webview/stores/useChatStore';

import { ChatInput } from './components/ChatInput';
import { ChatMessageList } from './components/ChatMessageList';
import { ContextSelector } from './components/ContextSelector';
import { ReferencedFiles } from './components/ReferencedFiles';
import styles from './IrisChatView.module.css';
import type { IrisStageDTO } from './types';

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
        setIrisStages, resetTransientChatUi,
        markMessageFailed, removeMessageById, attachStaleAsk, foldEpisode,
    } = store;
    const [sideMenuOpen, setSideMenuOpen] = useState(false);
    const [contextSwitching, setContextSwitching] = useState(false);
    const previousContextId = useRef<number | null>(null);
    const sideMenuRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputSectionRef = useRef<HTMLDivElement>(null);

    // Publish the input section's measured height as a CSS variable so the
    // ContextSelector dropdown can anchor its bottom edge to the actual layout
    // (instead of a viewport-relative magic number). Without this the dropdown
    // either falls short of the input or overshoots it depending on banner /
    // referenced-file visibility.
    useEffect(() => {
        const inputEl = inputSectionRef.current;
        const rootEl = containerRef.current;
        if (!inputEl || !rootEl) {
            return;
        }
        const update = () => {
            rootEl.style.setProperty('--iris-input-height', `${inputEl.offsetHeight}px`);
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(inputEl);
        return () => ro.disconnect();
    }, []);

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

    // Message listener - handles messages from extension
    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.UpdateIrisState: {
                setIrisState(msg.state);
                if (msg.showDiagnostics !== undefined) {
                    setShowDiagnostics(msg.showDiagnostics);
                }
                break;
            }

            case ExtensionMsg.AddMessage: {
                const m = msg.message;
                addMessage({
                    id: m.id,
                    localId: crypto.randomUUID(),
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp,
                    helpful: m.helpful ?? null,
                    origin: m.origin,
                    proactiveOutcome: m.proactiveOutcome,
                    proactiveEpisodeId: m.proactiveEpisodeId,
                    status: 'sent',
                });
                if (m.role === 'assistant') {
                    resetTransientChatUi();
                }
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
                        origin: m.origin,
                        proactiveOutcome: m.proactiveOutcome,
                        proactiveEpisodeId: m.proactiveEpisodeId,
                        // Route B: keep the re-attached stale-check kind/answer so a reloaded episode stays differentiated.
                        proactiveKind: m.proactiveKind,
                        staleAnswer: m.staleAnswer,
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

            case ExtensionMsg.HideUnavailableState:
                setUnavailableMessage(null);
                break;

            case ExtensionMsg.UpdateNoAiStatus: {
                setNoAiDetected(msg.isNoAiDetected);
                break;
            }

            case ExtensionMsg.UpdateIrisStages: {
                setIrisStages(msg.stages);
                break;
            }

            case ExtensionMsg.RemoveMessage:
                removeMessageById(msg.id);
                break;

            case ExtensionMsg.AddStaleAsk:
                attachStaleAsk(msg.messageId, msg.askId, msg.question);
                break;

            case ExtensionMsg.FoldEpisode:
                foldEpisode(msg.episodeId, msg.outcome, msg.praise);
                break;

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
        }
    }, [setIrisState, setShowDiagnostics, addMessage, applyLoadedMessages, setMessageLoadError, clearMessages, setReferencedFiles, setWebSocketStatus, setDisabledMessage, setUnavailableMessage, setNoAiDetected, setIrisStages, resetTransientChatUi, markMessageFailed, removeMessageById, attachStaleAsk, foldEpisode]);

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

        // Clear any stale stages/streaming from previous request
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

    const handleStaleAskButton = (askId: string, button: 'solved' | 'still-on-it' | 'something-else') => {
        // Optimistically record the answer so the live check-in node differentiates immediately
        // (the host also persists it via Route B for reload). Match the askId to its bound row.
        for (const [messageId, binding] of store.staleAskBindings) {
            if (binding.askId === askId) { store.setStaleAnswer(messageId, button); break; }
        }
        postCommand(vscodeApi, 'staleAskButton', { askId, button });
    };

    const handleDismissProactive = (messageId: number, proactiveEpisodeId?: string) => {
        const activeSession = store.sessions.find(s => s.id === store.activeSessionId);
        if (typeof activeSession?.artemisSessionId !== 'number') { return; }
        store.setProactiveOutcome(messageId, 'DISMISSED');
        postCommand(vscodeApi, 'messageProactiveOutcome', {
            sessionId: activeSession.artemisSessionId,
            messageId,
            outcome: 'DISMISSED',
            proactiveEpisodeId,
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

    // Check if chat is disabled
    const isChatDisabled = store.disabledMessage !== null || store.isNoAiDetected;

    // Decide whether the Retry button on a failed user message should be
    // active right now. Retry is meaningful only when the underlying cause
    // has plausibly cleared since the original send. Computed inline per
    // render because the message list is short and `messages.map` already
    // walks it; rebuilding a Map would be wasted work.
    const isRetryDisabled = (msg: { errorReason?: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable' }) => {
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

    // Derive active stage: first stage that is not DONE or SKIPPED.
    // NOT_STARTED is intentionally included: it shows dots immediately while
    // Artemis transitions the stage to IN_PROGRESS (provides instant feedback).
    const activeStage = useMemo<IrisStageDTO | null>(
        () => store.irisStages.find(s => s.state !== 'DONE' && s.state !== 'SKIPPED') ?? null,
        [store.irisStages],
    );

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
        <div className={styles.container} ref={containerRef}>
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

            {/* Context Selector */}
            <div className={styles.contextSection}>
                <ContextSelector
                    context={store.context}
                    sessions={store.sessions}
                    activeSessionId={store.activeSessionId}
                    exercises={store.exercises}
                    courses={store.courses}
                    onSelectContext={(type, id, title, shortName) => {
                        postCommand(vscodeApi, 'selectChatContext', { context: type, itemId: id, itemName: title, itemShortName: shortName });
                    }}
                    onSelectSession={(sessionId) => {
                        postCommand(vscodeApi, 'switchSession', { sessionId });
                    }}
                    onCreateNewSession={() => {
                        postCommand(vscodeApi, 'createNewSession');
                    }}
                    onSwitchToWorkspace={() => {
                        postCommand(vscodeApi, 'switchToWorkspaceContext');
                    }}
                />
            </div>

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
                {(store.disabledMessage || store.unavailableMessage) ? null
                : messagesErrored ? (
                    <div className={styles.loadingState}>
                        <div className={styles.loadError} role="alert">
                            Failed to load chat history. Try selecting the
                            session again or reconnecting.
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
                        streaming={store.streaming}
                        activeStage={activeStage}
                        onFeedback={handleFeedback}
                        onDismiss={handleDismissProactive}
                        onSendPrompt={handleSendMessage}
                        hasContext={store.context !== null}
                        isChatDisabled={isChatDisabled}
                        onRetry={handleRetry}
                        isRetryDisabled={isRetryDisabled}
                        onStaleAskButton={handleStaleAskButton}
                    />
                )}
            </div>

            {/* Input section */}
            <div className={styles.inputSection} ref={inputSectionRef}>
                {/* Referenced files */}
                <ReferencedFiles
                    files={store.referencedFiles}
                    onOpenFile={handleOpenFile}
                />

                {/* Chat input — disabled while we are still hydrating the
                    message list so a fast user does not race the load and
                    have their just-sent message swallowed when the server
                    snapshot arrives. */}
                <ChatInput
                    onSend={handleSendMessage}
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
